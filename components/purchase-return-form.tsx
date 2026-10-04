"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PackageSearch, Plus, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OptionCombobox } from "@/components/option-combobox";
import {
  EMPTY_ROUTE,
  PaymentRoute,
  usePaymentMethods,
  type PaymentRouteValue,
} from "@/components/payment-route";
import { createClient } from "@/utils/supabase/component";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/components/role-provider";
import { clearDrafts, useDraft } from "@/hooks/use-draft";
import { useBarcodeScanner } from "@/hooks/use-keyboard-flow";
import { NoBarcodePicker } from "@/components/no-barcode-picker";
import { money, outstandingOf, type VoucherRow } from "@/lib/purchase-voucher";

const supabase = createClient();

type Supplier = { id: string; name: string };

/** One unit type going back, gathered from a scan of the shelf. */
type ReturnLine = {
  id: string;
  barcode: string;
  productName: string;
  modelNumber: string;
  color: string;
  quantity: number;
  unitCost: number;
  /** How many the shop actually has, so a return cannot exceed it. */
  available: number;
};

/**
 * One product coming back IN from the supplier in place of what went
 * out. Exactly what the purchase voucher records, because it becomes
 * exactly the same thing: a purchase row and its units.
 */
type IncomingLine = {
  id: string;
  productName: string;
  brand: string;
  modelNumber: string;
  category: string;
  variant: string;
  color: string;
  costPrice: number;
  sellPrice: number;
  /** Counted stock — no barcodes, one row carrying the whole quantity. */
  noBarcode: boolean;
  quantity: number;
  barcodes: string[];
};

const EMPTY_INCOMING = {
  productName: "",
  brand: "",
  modelNumber: "",
  category: "",
  variant: "",
  color: "",
  costPrice: "",
  sellPrice: "",
  quantity: "",
};

const REASONS = [
  { value: "defective-batch", label: "Defective Batch" },
  { value: "wrong-specifications", label: "Wrong Specifications" },
  { value: "quality-issues", label: "Quality Issues" },
  { value: "damaged-shipment", label: "Damaged in Shipment" },
  { value: "overstock", label: "Overstock" },
  { value: "other", label: "Other" },
];

/**
 * The two the arithmetic depends on.
 *
 *   account_credit  takes the value off what the shop owes
 *   replacement     goods for goods, and the intake is recorded
 *
 * Anything else moves no money, so it is whatever the shop calls it —
 * written once and offered from then on, the same way brands and
 * models already work. Loaded from product_options; see script 77.
 */
const CREDIT_METHODS = [
  { value: "replacement", label: "Replacement Products" },
  { value: "account_credit", label: "Account Credit" },
];

const conditionFor = (reason: string) => {
  switch (reason) {
    case "defective-batch":
    case "quality-issues":
      return "defective";
    case "wrong-specifications":
      return "wrong_spec";
    case "damaged-shipment":
      return "damaged";
    case "overstock":
      return "overstock";
    default:
      return "other";
  }
};

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * A shipment going back to the supplier.
 *
 * WHY THIS REPLACED THE ONE-PRODUCT FORM
 *
 * A faulty batch goes back as a batch. The previous form took one
 * product at a time down a column of typed fields, so returning six
 * handsets meant six separate return records that nothing could show
 * as the one shipment they were — and the supplier's rep is standing
 * at the counter while it happens.
 *
 * Now it is scan, scan, scan: each unit is looked up on the shelf and
 * drops into the grid with its own cost, and the whole lot goes back
 * in one record.
 *
 * TWO THINGS THAT WERE MISSING
 *
 * The stock now actually leaves. It did not before — units were
 * recorded as returned and left sitting in inventory, so the stock
 * report counted phones that were in a courier bag.
 *
 * And an Account Credit return now reduces what the shop owes that
 * supplier, oldest voucher first. Returning 60 taka of goods against a
 * 100 taka balance leaves 40.
 *
 * onClose is optional: this form is used on its own page as well as
 * inside a dialog.
 */
export function PurchaseReturnForm({ onClose }: { onClose?: () => void } = {}) {
  const { toast } = useToast();
  const { currentShopId } = useRole();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Kept if the manager steps away mid-shipment.
  const [supplierId, setSupplierId] = useDraft("pr.supplierId", "", currentShopId);

  const [lines, setLines] = useDraft<ReturnLine[]>("pr.lines", [], currentShopId);
  const [scanCode, setScanCode] = useState("");
  const [looking, setLooking] = useState(false);
  // Cables, covers and neck bands have nothing to scan. They still
  // carry an internal key, so this only has to find it — everything
  // after that is the scan path above, untouched.
  const [pickingOut, setPickingOut] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const [returnReason, setReturnReason] = useDraft("pr.reason", "", currentShopId);
  const [returnDate, setReturnDate] = useDraft("pr.date", todayLocal(), currentShopId);
  const [notes, setNotes] = useDraft("pr.notes", "", currentShopId);
  const [creditMethod, setCreditMethod] = useDraft("pr.creditMethod", "", currentShopId);

  const [submitting, setSubmitting] = useState(false);

  // ---- What the supplier is sending back in its place
  //
  // A faulty batch usually comes back as goods rather than money, and
  // often not the same goods — six of one model out, four of another
  // and two of a third in. Those are new stock and are entered here in
  // full, so they reach the shelf with their own barcodes, variant,
  // colour and cost instead of being retyped on another screen later.
  const [incoming, setIncoming] = useDraft<IncomingLine[]>(
    "pr.incoming",
    [],
    currentShopId,
  );
  const [inDraft, setInDraft] = useDraft("pr.inDraft", { ...EMPTY_INCOMING }, currentShopId);
  const [inMode, setInMode] = useState<"scan" | "count">("scan");
  const [inScanned, setInScanned] = useState<string[]>([]);
  const [inScanCode, setInScanCode] = useState("");
  const inScanRef = useRef<HTMLInputElement>(null);

  // ---- Money handed over on the spot
  //
  // An exchange that takes in more than it sends back leaves a debt,
  // and the owner standing at the counter with the supplier's rep
  // usually settles some of it there and then. Making him close this,
  // open Expenses and find the supplier again is how it ends up not
  // being recorded at all.
  //
  // Text, so the box can be cleared and retyped: `Number("") || 0`
  // cannot tell an empty field from a deliberate zero.
  // ---- The shop's own ways of settling
  const [customMethods, setCustomMethods] = useState<string[]>([]);
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [newMethodName, setNewMethodName] = useState("");
  const [addingMethod, setAddingMethod] = useState(false);

  const [payText, setPayText] = useDraft("pr.pay", "", currentShopId);
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods();
  const [payRoute, setPayRoute] = useState<PaymentRouteValue>(EMPTY_ROUTE);

  // What this supplier is currently owed, so the counter can see what
  // the credit will actually clear before it commits to anything.
  const [outstanding, setOutstanding] = useState<number | null>(null);

  const supplierName = useMemo(
    () => suppliers.find((s) => s.id === supplierId)?.name ?? "",
    [suppliers, supplierId],
  );

  useEffect(() => {
    if (!currentShopId) return;
    (async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        // Removed by the owner (script 92): kept for history, not offered.
        .is("deleted_at", null)
        .eq("organization_id", currentShopId)
        .order("name", { ascending: true });

      if (error) {
        console.error("Failed to load suppliers:", error);
        toast({
          title: "Error",
          description: "Could not load suppliers from database.",
          variant: "destructive",
        });
        return;
      }
      setSuppliers((data as Supplier[]) ?? []);
    })();
  }, [currentShopId, toast]);

  const loadCustomMethods = useCallback(async () => {
    if (!currentShopId) return;
    const { data, error } = await supabase
      .from("product_options")
      .select("value")
      .eq("organization_id", currentShopId)
      .eq("kind", "credit_method")
      .order("value");

    if (error) {
      // A missing list costs the shop its own wording; it must not
      // stop a return being recorded at all.
      console.warn("Could not load credit methods:", error.message);
      return;
    }
    setCustomMethods((data ?? []).map((r: any) => r.value));
  }, [currentShopId]);

  useEffect(() => {
    loadCustomMethods();
  }, [loadCustomMethods]);

  const addCustomMethod = async () => {
    const name = newMethodName.trim();
    if (!name || !currentShopId) return;

    setAddingMethod(true);
    try {
      const { error } = await supabase
        .from("product_options")
        .insert({ organization_id: currentShopId, kind: "credit_method", value: name });

      // Someone else adding the same wording first is a success from
      // the user's point of view, not an error.
      if (error && error.code !== "23505") {
        toast({
          title: "Could not save that method",
          description:
            error.code === "23514"
              ? "This shop's database has not been updated for custom credit methods yet. Ask your administrator to run script 77."
              : error.message,
          variant: "destructive",
        });
        return;
      }

      await loadCustomMethods();
      setCreditMethod(name);
      setShowAddMethod(false);
      setNewMethodName("");
      toast({ title: `"${name}" added` });
    } finally {
      setAddingMethod(false);
    }
  };

  /** Every choice the dropdown offers, the two built-ins first. */
  const allCreditMethods = useMemo(
    () => [
      ...CREDIT_METHODS,
      ...customMethods.map((m) => ({ value: m, label: m })),
    ],
    [customMethods],
  );

  const loadOutstanding = useCallback(async () => {
    if (!currentShopId || !supplierId) {
      setOutstanding(null);
      return;
    }
    const { data, error } = await supabase
      .from("purchase_vouchers")
      .select("due_amount, due_settled")
      .eq("organization_id", currentShopId)
      .eq("supplier_id", supplierId)
      .is("deleted_at", null);

    if (error) {
      // Not knowing the balance costs a line of context, not the
      // return itself.
      console.warn("Could not read supplier balance:", error.message);
      setOutstanding(null);
      return;
    }
    setOutstanding(
      (data ?? []).reduce(
        (sum: number, v: any) => sum + outstandingOf(v as VoucherRow),
        0,
      ),
    );
  }, [currentShopId, supplierId]);

  useEffect(() => {
    loadOutstanding();
  }, [loadOutstanding]);

  // Straight to the scanner once the supplier is set, so making it
  // compulsory costs a click rather than a click and a hunt.
  useEffect(() => {
    if (supplierId) scanRef.current?.focus();
  }, [supplierId]);

  // ------------------------------------------------------------------
  // Scanning
  // ------------------------------------------------------------------

  /**
   * One unit, scanned off the shelf.
   *
   * Looks the barcode up in stock rather than asking anyone to type
   * what it is: the shop already knows the product, the colour and
   * what it paid, and re-typing all three is where the mistakes come
   * from. Scanning the same code again adds another of it, up to what
   * is actually in stock.
   */
  const addScan = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;

    setScanCode("");

    // Already on the return: one more of it, if there is one more to
    // send back.
    const existing = lines.find((l) => l.barcode === code);
    if (existing) {
      if (existing.quantity >= existing.available) {
        toast({
          title: "That is all of them",
          description: `Only ${existing.available} of ${existing.productName} in stock.`,
          variant: "destructive",
        });
      } else {
        setLines((prev) =>
          prev.map((l) =>
            l.barcode === code ? { ...l, quantity: l.quantity + 1 } : l,
          ),
        );
      }
      scanRef.current?.focus();
      return;
    }

    setLooking(true);
    try {
      const { data, error } = await supabase
        .from("inventory")
        .select("barcode, product_name, model_number, color, quantity, cost_price, supplier")
        .eq("organization_id", currentShopId)
        .eq("barcode", code)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        toast({
          title: "Not in stock",
          description: `${code} is not a product of this shop.`,
          variant: "destructive",
        });
        return;
      }

      if ((data.quantity ?? 0) <= 0) {
        toast({
          title: "None left",
          description: `${data.product_name ?? code} is already out of stock — there is nothing to send back.`,
          variant: "destructive",
        });
        return;
      }

      setLines((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          barcode: code,
          productName: data.product_name ?? "Unknown Product",
          modelNumber: data.model_number ?? "",
          color: data.color ?? "",
          quantity: 1,
          unitCost: Number(data.cost_price) || 0,
          available: Number(data.quantity) || 0,
        },
      ]);
    } catch (err: any) {
      toast({
        title: "Could not look that up",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLooking(false);
      scanRef.current?.focus();
    }
  };

  const scanner = useBarcodeScanner({
    onScan: addScan,
    // A scanner fires on its own when the burst goes quiet, so a
    // disabled input alone would not stop one reaching addScan.
    enabled: !submitting && !!supplierId,
  });

  // A stray Enter in a text input would submit the surrounding form.
  const scanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
    scanner.onKeyDown(e);
  };

  // ------------------------------------------------------------------
  // Scanning the units coming IN
  // ------------------------------------------------------------------

  /** Every incoming barcode already spoken for, on this line or another. */
  const inTaken = useMemo(() => {
    const set = new Set<string>(inScanned);
    for (const l of incoming) for (const b of l.barcodes) set.add(b);
    return set;
  }, [inScanned, incoming]);

  const addInScan = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setInScanCode("");

    if (inTaken.has(code)) {
      toast({
        title: "Already scanned",
        description: `${code} is already on this return.`,
        variant: "destructive",
      });
      inScanRef.current?.focus();
      return;
    }

    // Checked against stock as it is scanned, exactly as the purchase
    // voucher does. Finding out at save time that one unit of thirty
    // is already in stock tells the manager nothing they can act on.
    const { data } = await supabase
      .from("color_variants")
      .select("barcode")
      .eq("organization_id", currentShopId)
      .eq("barcode", code)
      .limit(1);

    if ((data ?? []).length > 0) {
      toast({
        title: "Already in inventory",
        description: `${code} is already in stock. It has not been added.`,
        variant: "destructive",
      });
      inScanRef.current?.focus();
      return;
    }

    setInScanned((prev) => [...prev, code]);
    inScanRef.current?.focus();
  };

  const inScanner = useBarcodeScanner({
    onScan: addInScan,
    enabled: !submitting,
  });

  const inScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
    inScanner.onKeyDown(e);
  };

  const inDraftQty =
    inMode === "scan" ? inScanned.length : Number(inDraft.quantity) || 0;

  const addIncoming = () => {
    const cost = Number(inDraft.costPrice);
    const sell = Number(inDraft.sellPrice);

    if (!inDraft.productName.trim()) {
      toast({ title: "Product name is required", variant: "destructive" });
      return;
    }
    if (!inDraft.category.trim()) {
      toast({ title: "Category is required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(sell) || sell <= 0) {
      toast({
        title: "Check the prices",
        description: "Cost price and selling price are both required.",
        variant: "destructive",
      });
      return;
    }
    if (inMode === "scan" && inScanned.length === 0) {
      toast({
        title: "Nothing scanned",
        description: "Scan at least one unit before adding the item.",
        variant: "destructive",
      });
      return;
    }
    if (inMode === "count" && inDraftQty <= 0) {
      toast({
        title: "Enter how many",
        description: "Counted stock needs a quantity of 1 or more.",
        variant: "destructive",
      });
      return;
    }

    setIncoming((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        productName: inDraft.productName.trim(),
        brand: inDraft.brand.trim(),
        modelNumber: inDraft.modelNumber.trim(),
        category: inDraft.category.trim(),
        variant: inDraft.variant.trim(),
        color: inDraft.color.trim(),
        costPrice: cost,
        sellPrice: sell,
        noBarcode: inMode === "count",
        quantity: inDraftQty,
        barcodes: inMode === "scan" ? [...inScanned] : [],
      },
    ]);

    // The details stay, the serials clear — a delivery is lots of the
    // same thing in different colours, and those serials are now on a
    // line.
    setInScanned([]);
    setInScanCode("");
    if (inMode === "scan") inScanRef.current?.focus();
  };

  const clearInDraft = () => {
    setInDraft({ ...EMPTY_INCOMING });
    setInScanned([]);
    setInScanCode("");
  };

  // ------------------------------------------------------------------
  // Totals
  // ------------------------------------------------------------------

  const totals = useMemo(() => {
    let units = 0;
    let credit = 0;
    for (const l of lines) {
      units += l.quantity;
      credit += l.quantity * l.unitCost;
    }
    let inUnits = 0;
    let inValue = 0;
    for (const l of incoming) {
      inUnits += l.quantity;
      inValue += l.quantity * l.costPrice;
    }
    return {
      units,
      credit: Math.round(credit * 100) / 100,
      inUnits,
      inValue: Math.round(inValue * 100) / 100,
    };
  }, [lines, incoming]);

  const creditsAccount = creditMethod === "account_credit";
  const takesGoodsBack = creditMethod === "replacement";

  /**
   * Where this return leaves the supplier's balance.
   *
   * On an exchange the goods sent back pay for the goods coming in, as
   * far as they go. Whichever way it falls out, only one of the two can
   * happen:
   *
   *   intake worth more   -> the shop OWES the rest, payable later
   *   return worth more   -> the surplus CREDITS the open balance
   *
   * The same arithmetic the database does, so the screen cannot
   * promise one thing and the books record another.
   */
  const settlement = useMemo(() => {
    const round2 = (n: number) => Math.round(n * 100) / 100;

    if (takesGoodsBack) {
      const settled = Math.min(totals.credit, totals.inValue);
      return {
        newDue: round2(totals.inValue - settled),
        credit: round2(totals.credit - settled),
      };
    }
    if (creditsAccount) {
      return { newDue: 0, credit: totals.credit };
    }
    return { newDue: 0, credit: 0 };
  }, [takesGoodsBack, creditsAccount, totals.credit, totals.inValue]);

  /** Handed over now. Never more than the return leaves owing. */
  const payNow = Math.max(0, Number(payText) || 0);

  /** What the supplier is owed once the return has done its work. */
  const owedBeforePayment =
    outstanding == null
      ? null
      : Math.max(0, outstanding - settlement.credit) + settlement.newDue;

  /** And after whatever is handed over at the counter. */
  const owedAfter =
    owedBeforePayment == null ? null : Math.max(0, owedBeforePayment - payNow);

  const overpaying =
    owedBeforePayment != null && payNow > owedBeforePayment + 0.005;

  // ------------------------------------------------------------------
  // Saving
  // ------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const missing: string[] = [];
    if (!supplierId) missing.push("Supplier");
    if (lines.length === 0) missing.push("At least one product");
    if (!returnReason) missing.push("Return Reason");
    if (!creditMethod) missing.push("Credit Method");
    if (!returnDate) missing.push("Return Date");

    if (missing.length > 0) {
      toast({
        title: "Missing fields",
        description: `Please fill: ${missing.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    if (overpaying) {
      toast({
        title: "More than is owed",
        description: `Only ${money(owedBeforePayment ?? 0)} is owed after this return.`,
        variant: "destructive",
      });
      return;
    }

    // Money out has to land on a named account, or it reaches Bank Info
    // as "Not specified" and nobody notices for a month.
    if (payNow > 0) {
      if (payRoute.method === "bank_transfer" && !payRoute.bankName) {
        toast({
          title: "Choose a bank",
          description: "Select which account the payment came from.",
          variant: "destructive",
        });
        return;
      }
      if (payRoute.method !== "cash" && !payRoute.channel) {
        toast({
          title: "Choose a method",
          description: "Select how the supplier was paid.",
          variant: "destructive",
        });
        return;
      }
    }

    const over = lines.find((l) => l.quantity > l.available);
    if (over) {
      toast({
        title: "More than there is",
        description: `${over.productName}: only ${over.available} in stock.`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // One call, one transaction. The header, every line, the stock
      // coming off the shelf and the credit against what is owed all
      // land together or not at all — a half-done return is stock gone
      // with no record of where it went.
      const { data, error } = await supabase.rpc("process_purchase_return", {
        p_organization_id: currentShopId,
        p_client_txn_id: crypto.randomUUID(),
        p_supplier_id: supplierId,
        p_return_date: returnDate,
        p_reason: returnReason.replace("-", "_"),
        p_credit_method: creditMethod,
        p_notes: notes.trim() || null,
        p_lines: lines.map((l) => ({
          barcode: l.barcode,
          product_name: l.productName,
          model_number: l.modelNumber || null,
          color: l.color || null,
          quantity: l.quantity,
          unit_cost: l.unitCost,
          condition: conditionFor(returnReason),
        })),
        // What the supplier sent back in its place. Null unless goods
        // came in, which is every ordinary return — the database
        // treats a missing list as "nothing came back".
        p_incoming:
          incoming.length > 0
            ? incoming.map((l) => ({
                product_name: l.productName,
                brand: l.brand,
                model_number: l.modelNumber || null,
                category: l.category,
                variant: l.variant || null,
                color: l.color,
                cost_price: l.costPrice,
                sale_price: l.sellPrice,
                no_barcode: l.noBarcode,
                quantity: l.quantity,
                barcodes: l.barcodes,
              }))
            : null,
        // Handed over at the counter. Null unless something was, which
        // is every ordinary return — "pay later" is simply not filling
        // this in.
        p_payment:
          payNow > 0
            ? {
                amount: payNow,
                payment_method: payRoute.method || "cash",
                bank_name:
                  payRoute.method === "cash" ? null : payRoute.bankName || null,
                payment_channel:
                  payRoute.method === "cash" ? null : payRoute.channel || null,
                notes: notes.trim() || null,
              }
            : null,
      });

      if (error) {
        console.error("process_purchase_return failed:", error);
        toast({
          title: "Could not process the return",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      const result = data as {
        success: boolean;
        message?: string;
        return_no?: string;
        total_credit?: number;
        credited?: number;
        uncredited?: number;
        received_units?: number;
        received_voucher_no?: string;
        new_due?: number;
        paid_now?: number;
      } | null;

      if (!result?.success) {
        toast({
          title: "Could not process the return",
          description: result?.message ?? "Nothing was written. Nothing has changed.",
          variant: "destructive",
        });
        return;
      }

      const credited = Number(result.credited ?? 0);
      const uncredited = Number(result.uncredited ?? 0);
      const receivedUnits = Number(result.received_units ?? 0);

      const newDue = Number(result.new_due ?? 0);
      const paidNow = Number(result.paid_now ?? 0);

      const moneyPart =
        newDue > 0
          ? `${money(newDue)} now owed to ${supplierName} for the extra goods — pay it from Expenses → Supplier Payment.`
          : credited > 0
            ? uncredited > 0
              ? `${money(credited)} credited against ${supplierName}. ${money(
                  uncredited,
                )} more than was owed — settle that with them directly.`
              : `${money(credited)} credited against ${supplierName}.`
            : takesGoodsBack
              ? `An even swap — nothing owed either way.`
              : `${money(Number(result.total_credit ?? 0))} returned. The balance is unchanged — the supplier is settling by ${
                  allCreditMethods.find((m) => m.value === creditMethod)?.label ??
                  creditMethod
                }.`;

      const goodsPart =
        receivedUnits > 0
          ? ` ${receivedUnits} unit${receivedUnits === 1 ? "" : "s"} received into stock as ${result.received_voucher_no}.`
          : "";

      const paidPart =
        paidNow > 0 ? ` ${money(paidNow)} paid at the counter.` : "";

      toast({
        title: `Return ${result.return_no} processed`,
        description: moneyPart + goodsPart + paidPart,
      });

      setLines([]);
      setScanCode("");
      setReturnReason("");
      setNotes("");
      setCreditMethod("");
      setIncoming([]);
      clearInDraft();
      // The stored copies too, or the whole return reappears on the
      // next visit to this screen.
      clearDrafts(currentShopId, [
        "pr.lines",
        "pr.reason",
        "pr.notes",
        "pr.creditMethod",
        "pr.incoming",
        "pr.inDraft",
        "pr.pay",
      ]);
      // A tender left behind would be applied to the next supplier's
      // return and pay a balance nobody agreed to.
      setPayText("");
      setPayRoute(EMPTY_ROUTE);
      loadOutstanding();

      onClose?.();
    } catch (err: any) {
      console.error("[handleSubmit] unexpected error:", err);
      toast({
        title: "Error",
        description: err?.message || "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="h-[calc(100vh-8rem)] space-y-5 overflow-y-auto pr-1"
      onSubmit={handleSubmit}
    >
      {/* ---- What is true of the whole shipment ---- */}
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2 xl:grid-cols-4">
        {/* First, and it has to be: everything below is looked up
            against this supplier and the balance shown is theirs.
            Scanning a shelf full of units and only then discovering
            nobody chose a supplier is the mistake this screen kept
            inviting, so the scan box stays shut until it is set. */}
        <div className="space-y-1.5">
          <Label htmlFor="pr-supplier">
            Supplier*
            {!supplierId && (
              <span className="ml-1.5 font-normal text-destructive">
                — choose this first
              </span>
            )}
          </Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger
              id="pr-supplier"
              autoFocus
              className={
                supplierId ? undefined : "border-destructive ring-2 ring-destructive/25"
              }
            >
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.length === 0 ? (
                <SelectItem value="none" disabled>
                  No suppliers found
                </SelectItem>
              ) : (
                suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pr-date">Return date*</Label>
          <Input
            id="pr-date"
            type="date"
            required
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value || todayLocal())}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pr-reason">Return reason*</Label>
          <Select value={returnReason} onValueChange={setReturnReason}>
            <SelectTrigger id="pr-reason">
              <SelectValue placeholder="Select reason" />
            </SelectTrigger>
            <SelectContent>
              {REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pr-credit">Credit method*</Label>
          <div className="flex gap-2">
            <Select value={creditMethod} onValueChange={setCreditMethod}>
              <SelectTrigger id="pr-credit">
                <SelectValue placeholder="Select credit method" />
              </SelectTrigger>
              <SelectContent>
                {allCreditMethods.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Write a new way of settling once; it is offered from
                then on. It moves no money — only the two built-in
                methods do. */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Add a credit method"
              onClick={() => setShowAddMethod(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Scan the units going back ---- */}
      <div
        className={`space-y-2 rounded-md border p-3 ${
          supplierId
            ? "border-primary/40 bg-primary/5"
            : "border-dashed bg-muted/30 opacity-60"
        }`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1 space-y-1.5">
            <Label htmlFor="pr-scan">
              {supplierId
                ? "Scan IMEI / barcode — stays ready for the next one"
                : "Choose a supplier above before scanning"}
            </Label>
            <Input
              id="pr-scan"
              ref={scanRef}
              autoComplete="off"
              placeholder={
                supplierId ? "Scan or type, then Enter" : "Supplier first"
              }
              value={scanCode}
              onChange={(e) => {
                setScanCode(e.target.value);
                scanner.onChange(e.target.value);
              }}
              onKeyDown={scanKeyDown}
              disabled={submitting || !supplierId}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPickingOut(true)}
            disabled={submitting || !supplierId}
            className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900"
          >
            <PackageSearch className="mr-2 h-4 w-4" />
            No barcode
          </Button>
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">
              {totals.units}
            </span>{" "}
            unit{totals.units === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {money(totals.credit)}
            </span>
          </div>
        </div>
        {looking && (
          <p className="text-xs text-muted-foreground">Looking it up…</p>
        )}
      </div>

      {/* The picker's only job is to produce the code addScan already
          understands, so counted stock goes back to a supplier through
          exactly the same path as a scanned handset. */}
      <NoBarcodePicker
        open={pickingOut}
        onOpenChange={setPickingOut}
        source="inventory"
        title="Send back something without a barcode"
        description="Search what is in stock, then pick what is going back to the supplier."
        onPick={(row) => addScan(row.barcode)}
      />

      {/* ---- What is on the return so far ---- */}
      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>IME No</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Colour</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Nothing on this return yet. Scan the units going back.
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((line, idx) => (
                  <TableRow key={line.id}>
                    <TableCell className="tabular-nums">{idx + 1}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {line.barcode}
                    </TableCell>
                    <TableCell className="font-medium">{line.productName}</TableCell>
                    <TableCell>{line.modelNumber || "—"}</TableCell>
                    <TableCell>{line.color || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={1}
                        max={line.available}
                        className="ml-auto h-8 w-20 text-right tabular-nums"
                        value={line.quantity}
                        onChange={(e) => {
                          const n = Number(e.target.value) || 0;
                          setLines((prev) =>
                            prev.map((l) =>
                              l.id === line.id
                                ? {
                                    ...l,
                                    // Capped at what is on the shelf.
                                    // The database refuses the rest,
                                    // but not after the rep has left.
                                    quantity: Math.max(
                                      1,
                                      Math.min(n, l.available),
                                    ),
                                  }
                                : l,
                            ),
                          );
                        }}
                      />
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        of {line.available}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.unitCost.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {(line.quantity * line.unitCost).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        title="Take this off the return"
                        disabled={submitting}
                        onClick={() =>
                          setLines((prev) => prev.filter((l) => l.id !== line.id))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ---- What the supplier sent back in its place ----

          Shown for Replacement Products, which is what that credit
          method means: goods for goods. Everything typed here becomes
          ordinary stock — the same purchase and unit records the
          Add Product page writes — so it reaches the shelf with its own
          barcodes, variant, colour and cost instead of being entered
          again on another screen afterwards. */}
      {takesGoodsBack && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Received in exchange</h3>
              <p className="text-xs text-muted-foreground">
                What the supplier sent back. Added straight into stock.
              </p>
            </div>
            <div className="flex rounded-md border bg-background p-0.5">
              <button
                type="button"
                onClick={() => {
                  setInMode("scan");
                  setInScanned([]);
                  setInScanCode("");
                }}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  inMode === "scan"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Scan each unit
              </button>
              <button
                type="button"
                onClick={() => {
                  setInMode("count");
                  setInScanned([]);
                  setInScanCode("");
                }}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  inMode === "count"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Count quantity
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <OptionCombobox
              kind="product_name"
              label="Product Name*"
              value={inDraft.productName}
              onChange={(v) => setInDraft((d) => ({ ...d, productName: v }))}
              placeholder="Select or type"
            />
            <OptionCombobox
              kind="brand"
              label="Brand"
              value={inDraft.brand}
              onChange={(v) => setInDraft((d) => ({ ...d, brand: v }))}
              placeholder="Select or type"
            />
            <OptionCombobox
              kind="model_number"
              label={inMode === "scan" ? "Model Number*" : "Model Number"}
              value={inDraft.modelNumber}
              onChange={(v) => setInDraft((d) => ({ ...d, modelNumber: v }))}
              placeholder="Select or type"
            />
            <OptionCombobox
              kind="category"
              label="Category*"
              value={inDraft.category}
              onChange={(v) => setInDraft((d) => ({ ...d, category: v }))}
              placeholder="Select or type"
            />
            <OptionCombobox
              kind="variant"
              label="Variant"
              value={inDraft.variant}
              onChange={(v) => setInDraft((d) => ({ ...d, variant: v }))}
              placeholder="e.g. 8/256"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <OptionCombobox
              kind="color"
              label={inMode === "scan" ? "Colour*" : "Colour"}
              value={inDraft.color}
              onChange={(v) => setInDraft((d) => ({ ...d, color: v }))}
              placeholder="Select or type"
            />

            {inMode === "scan" ? (
              <div className="space-y-1.5">
                <Label>Units scanned</Label>
                <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm tabular-nums">
                  {inScanned.length}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="pr-in-qty">Quantity*</Label>
                <Input
                  id="pr-in-qty"
                  inputMode="numeric"
                  placeholder="0"
                  value={inDraft.quantity}
                  onChange={(e) =>
                    setInDraft((d) => ({ ...d, quantity: e.target.value }))
                  }
                />
              </div>
            )}

            <OptionCombobox
              kind="cost_price"
              label="Cost Price*"
              value={inDraft.costPrice}
              onChange={(v) => setInDraft((d) => ({ ...d, costPrice: v }))}
              placeholder="Select or type cost"
            />
            <OptionCombobox
              kind="sale_price"
              label="Selling Price*"
              value={inDraft.sellPrice}
              onChange={(v) => setInDraft((d) => ({ ...d, sellPrice: v }))}
              placeholder="Select or type price"
            />

            <div className="space-y-1.5">
              <Label>Amount</Label>
              <div className="flex h-10 items-center justify-end rounded-md bg-primary/10 px-3 text-sm font-semibold tabular-nums">
                {money(inDraftQty * (Number(inDraft.costPrice) || 0))}
              </div>
            </div>
          </div>

          {inMode === "scan" && (
            <div className="space-y-2 rounded-md border bg-background p-3">
              <Label htmlFor="pr-in-scan">
                Scan IMEI / barcode of the units coming IN
              </Label>
              <Input
                id="pr-in-scan"
                ref={inScanRef}
                autoComplete="off"
                placeholder="Scan or type, then Enter"
                value={inScanCode}
                onChange={(e) => {
                  setInScanCode(e.target.value);
                  inScanner.onChange(e.target.value);
                }}
                onKeyDown={inScanKeyDown}
                disabled={submitting}
              />
              {inScanned.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {inScanned.map((code, i) => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-0.5 font-mono text-xs"
                    >
                      {code}
                      <button
                        type="button"
                        title="Remove this unit"
                        className="text-destructive"
                        onClick={() =>
                          setInScanned((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={clearInDraft}
              disabled={submitting}
              title="Clear these fields"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button type="button" onClick={addIncoming} disabled={submitting}>
              <Plus className="mr-1.5 h-4 w-4" />
              {inMode === "scan" && inScanned.length > 0
                ? `Add ${inScanned.length} unit${inScanned.length === 1 ? "" : "s"}`
                : "Add"}
            </Button>
          </div>

          {incoming.length > 0 && (
            <div className="overflow-x-auto rounded-md border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Variant / Colour</TableHead>
                    <TableHead className="min-w-[220px]">Units</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Sell</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incoming.map((line, idx) => (
                    <TableRow key={line.id}>
                      <TableCell className="tabular-nums">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{line.productName}</TableCell>
                      <TableCell>{line.brand || "—"}</TableCell>
                      <TableCell>{line.modelNumber || "—"}</TableCell>
                      <TableCell>
                        {[line.variant, line.color].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                      <TableCell>
                        {line.noBarcode ? (
                          <span className="text-xs text-muted-foreground">Counted</span>
                        ) : (
                          <ol className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {line.barcodes.map((code, i) => (
                              <li key={code} className="font-mono text-xs tabular-nums">
                                <span className="text-muted-foreground">{i + 1}.</span>{" "}
                                {code}
                              </li>
                            ))}
                          </ol>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.costPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.sellPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {(line.quantity * line.costPrice).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Take this off the exchange"
                          disabled={submitting}
                          onClick={() =>
                            setIncoming((prev) => prev.filter((l) => l.id !== line.id))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ---- Notes ---- */}
      <div className="space-y-1.5">
        <Label htmlFor="pr-notes">Notes</Label>
        <Textarea
          id="pr-notes"
          rows={1}
          className="min-h-9 resize-y"
          placeholder="Anything the supplier should know about this shipment"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* ---- What it comes to, and where it leaves the balance ---- */}
      <div className="rounded-lg border bg-muted/30 p-3">
        {/* The two sides of the swap, so the counter can see before
            saving whether the shop ends up owing or being owed. */}
        {takesGoodsBack && (
          <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="pr-out-units">Sent back — qty</Label>
              <Input
                id="pr-out-units"
                readOnly
                tabIndex={-1}
                value={String(totals.units)}
                className="bg-muted tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-out-value">Sent back — value</Label>
              <Input
                id="pr-out-value"
                readOnly
                tabIndex={-1}
                value={money(totals.credit)}
                className="bg-muted tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-in-units">Received — qty</Label>
              <Input
                id="pr-in-units"
                readOnly
                tabIndex={-1}
                value={String(totals.inUnits)}
                className="bg-muted font-semibold tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-in-value">Received — value</Label>
              <Input
                id="pr-in-value"
                readOnly
                tabIndex={-1}
                value={money(totals.inValue)}
                className="bg-muted font-semibold tabular-nums"
              />
            </div>
          </div>
        )}

        {/* Sent back / Received above already say the quantities and
            the values, so these two only carry the balance. Repeating
            them under different names was two boxes saying the same
            thing, which is two chances to read the wrong one. */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {!takesGoodsBack && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pr-qty">Total qty</Label>
                <Input
                  id="pr-qty"
                  readOnly
                  tabIndex={-1}
                  value={String(totals.units)}
                  className="bg-muted font-semibold tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-total">Credit amount</Label>
                <Input
                  id="pr-total"
                  readOnly
                  tabIndex={-1}
                  value={money(totals.credit)}
                  className="bg-muted font-semibold tabular-nums"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pr-owed">Currently owed</Label>
            <Input
              id="pr-owed"
              readOnly
              tabIndex={-1}
              value={outstanding == null ? "—" : money(outstanding)}
              className="bg-muted tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-after">After this return</Label>
            <Input
              id="pr-after"
              readOnly
              tabIndex={-1}
              value={owedAfter == null ? "—" : money(owedAfter)}
              className={`bg-muted font-semibold tabular-nums ${
                owedAfter != null && outstanding != null && owedAfter > outstanding
                  ? "text-destructive"
                  : ""
              }`}
            />
          </div>
        </div>

        {/* What the balance is about to do, and why. Spelled out
            because a figure that moves for two different reasons is
            a figure nobody trusts. */}
        {settlement.newDue > 0 && (
          <p className="mt-2 text-xs text-destructive">
            The goods coming in are worth {money(settlement.newDue)} more than
            the ones going back. That becomes a due on this supplier — pay some
            or all of it below, or later from Expenses → Supplier Payment.
          </p>
        )}
        {settlement.credit > 0 && takesGoodsBack && (
          <p className="mt-2 text-xs text-muted-foreground">
            The goods going back are worth {money(settlement.credit)} more than
            the ones coming in. That much comes off the balance, oldest
            voucher first.
          </p>
        )}

        {/* ---- Pay the supplier now, if he is paying now ----

            Optional. Left blank the balance simply stands, which is
            what "pay later" means. It becomes an ordinary supplier
            payment on the same route the till uses, so the cashbook
            and Bank Info see it like any other. */}
        {owedBeforePayment != null && owedBeforePayment > 0 && (
          <div className="mt-3 space-y-3 rounded-md border bg-background p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-medium">Pay now (optional)</h4>
              <span className="text-xs text-muted-foreground">
                {money(owedBeforePayment)} owed after this return
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pr-pay">Amount (৳)</Label>
                <Input
                  id="pr-pay"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={payText}
                  onChange={(e) => setPayText(e.target.value)}
                  className={overpaying ? "border-destructive" : ""}
                />
              </div>
              <div className="md:col-span-2">
                <PaymentRoute
                  idPrefix="pr-pay"
                  value={payRoute}
                  methods={payMethods}
                  reloadMethods={reloadPayMethods}
                  onChange={setPayRoute}
                />
              </div>
            </div>

            {overpaying && (
              <p className="text-xs text-destructive">
                That is more than the {money(owedBeforePayment)} owed after this
                return.
              </p>
            )}
          </div>
        )}

        {/* Bank Transfer and Check move nothing: the supplier sends the
            money back instead. Said plainly, because the difference is
            invisible otherwise and the figures above would look wrong
            to anyone expecting the balance to drop. */}
        {creditMethod && !creditsAccount && !takesGoodsBack && (
          <p className="mt-2 text-xs text-muted-foreground">
            The balance is unchanged — on{" "}
            {allCreditMethods.find((m) => m.value === creditMethod)?.label ??
              creditMethod}{" "}
            the
            supplier settles it separately.
          </p>
        )}
        {creditsAccount && outstanding != null && totals.credit > outstanding && (
          <p className="mt-2 text-xs text-destructive">
            {money(totals.credit - outstanding)} more than is owed. The balance
            will clear to zero and the rest is for you to settle with them.
          </p>
        )}
      </div>

      {/* ---- Name a new way of settling ----

          Saved to the shop's own list, so it is offered from here on
          rather than retyped. It moves no money: only Account Credit
          and Replacement Products do, and those are built in. */}
      <Dialog open={showAddMethod} onOpenChange={setShowAddMethod}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add a credit method</DialogTitle>
            <DialogDescription>
              How the supplier settled this return. Offered on every return
              from now on.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="pr-new-method">Name*</Label>
            <Input
              id="pr-new-method"
              autoFocus
              placeholder="bKash refund, Cash back, Adjusted next order…"
              value={newMethodName}
              onChange={(e) => setNewMethodName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (newMethodName.trim()) addCustomMethod();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              This records how it was settled. It does not move the balance —
              use Account Credit for that.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddMethod(false)}
              disabled={addingMethod}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={addCustomMethod}
              disabled={addingMethod || !newMethodName.trim()}
            >
              {addingMethod ? "Adding…" : "Add method"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Actions (sticky) ---- */}
      <div className="sticky bottom-0 flex justify-end gap-2 bg-card/80 py-3 pt-4 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={() => onClose?.()}
        >
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || lines.length === 0}>
          <Save className="mr-2 h-4 w-4" />
          {submitting ? "Processing…" : "Process Return"}
        </Button>
      </div>
    </form>
  );
}
