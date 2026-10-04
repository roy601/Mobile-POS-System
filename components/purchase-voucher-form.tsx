"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";

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
import { SupplierEditButton } from "@/components/supplier-edit-button";
import { useToast } from "@/hooks/use-toast";
import { useBarcodeScanner } from "@/hooks/use-keyboard-flow";
import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
import { clearDrafts, useDraft } from "@/hooks/use-draft";

const supabase = createClient();

type Supplier = { id: string; name: string };

/**
 * One product on the voucher, exactly as it will be saved: a purchase
 * row plus the units underneath it.
 */
type VoucherLine = {
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

const EMPTY_DRAFT = {
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

/**
 * The product hierarchy, widest cut first.
 *
 * Category decides which brands are offered, the brand decides which
 * product names, and so on down. The lists themselves are narrowed by
 * OptionCombobox; this order is the other half — what happens to fields
 * already filled in when something above them changes. See pickField.
 */
const CASCADE = ["category", "brand", "productName", "modelNumber", "variant"] as const;

const money = (n: number) =>
  `৳${n.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Today, as the shop sees it.
 *
 * Not toISOString().slice(0, 10) — that is UTC, and Bangladesh is six
 * hours ahead of it, so a delivery entered before six in the morning
 * would be dated yesterday.
 */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * A delivery, entered the way it arrives.
 *
 * WHY THIS REPLACED THE ONE-PRODUCT FORM
 *
 * A delivery is a list. The previous form took one product at a time
 * down a column of stacked fields, so entering the twelve lines of a
 * supplier's invoice meant twelve rounds of filling and saving with
 * nothing on screen to check against the paper in the manager's hand.
 *
 * Here the fields sit in a row, each completed item drops into a grid
 * below, and the totals add up as it goes — so the screen can be
 * compared line for line with the supplier's invoice before anything
 * is written.
 *
 * WHAT IS UNCHANGED
 *
 * Every field, every validation, and the save itself. A voucher line
 * becomes exactly the purchase row and color_variants rows the old
 * form produced; several lines simply produce several of them. Nothing
 * about inventory, stock or reporting sees a difference.
 */
export function PurchaseVoucherForm() {
  const { currentShopId } = useRole();
  const { toast } = useToast();

  // ---- The voucher: what is true of the whole delivery
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Kept if the manager steps away mid-delivery. Nine handsets scanned
  // onto a voucher used to be lost by a trip to Inventory.
  const [supplierId, setSupplierId] = useDraft("pv.supplierId", "", currentShopId);
  const [description, setDescription] = useDraft("pv.description", "", currentShopId);
  const [lines, setLines] = useDraft<VoucherLine[]>("pv.lines", [], currentShopId);
  const [saving, setSaving] = useState(false);
  const [voucherDate, setVoucherDate] = useDraft(
    "pv.voucherDate",
    todayLocal(),
    currentShopId,
  );

  // ---- The settlement, filled in before the voucher is saved
  //
  // Text rather than numbers, for the same reason the POS holds its
  // Sale Price as text: `Number("") || 0` turns a deliberate 0 and an
  // empty box into the same thing, and the manager cannot clear a
  // field to retype it.
  const [discountText, setDiscountText] = useDraft("pv.discount", "", currentShopId);
  const [adjustmentText, setAdjustmentText] = useDraft("pv.adjustment", "", currentShopId);
  const [paidText, setPaidText] = useDraft("pv.paid", "", currentShopId);

  // What the last save produced, so the manager can read the voucher
  // number off the screen instead of going looking for it.
  const [lastSaved, setLastSaved] = useState<{
    voucherNo: string;
    due: number;
    /** What the supplier's advance covered on this voucher (script 97). */
    fromAdvance: number;
  } | null>(null);

  // Scanned units or counted units. A product-level choice, as before:
  // a shop either identifies each unit or it counts them, and mixing
  // the two within one product gives a stock figure nobody can
  // reconcile.
  const [mode, setMode] = useState<"scan" | "count">("scan");

  // ---- The item being typed
  const [draft, setDraft] = useDraft("pv.draft", { ...EMPTY_DRAFT }, currentShopId);
  const [scanned, setScanned] = useDraft<string[]>("pv.scanned", [], currentShopId);
  const [scanCode, setScanCode] = useState("");
  const scanRef = useRef<HTMLInputElement | null>(null);

  // ---- Adding a supplier without leaving the voucher
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    name: "",
    contact: "",
    phone: "",
    email: "",
    address: "",
  });
  const [addingSupplier, setAddingSupplier] = useState(false);

  const supplierName = useMemo(
    () => suppliers.find((s) => s.id === supplierId)?.name ?? "",
    [suppliers, supplierId],
  );

  const loadSuppliers = async () => {
    if (!currentShopId) return;
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
  };

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return;
    loadSuppliers();
    loadPriceBook();
    loadStockBarcodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  // ------------------------------------------------------------------
  // The price book
  //
  // What this shop last paid for a given product, and what it sold it
  // for. Typing both prices again for every lot of a handset the shop
  // has stocked for a year is the slowest part of entering a delivery,
  // and the numbers are almost always the same as last time.
  //
  // Read from stock that already exists rather than kept as a separate
  // price list, so there is nothing to maintain and nothing to go
  // stale on its own: the prices offered are the prices actually used.
  // ------------------------------------------------------------------
  type PriceEntry = { cost: number; sell: number; variant: string };

  /** Keyed name|model|variant — the exact thing that was bought. */
  const [priceBook, setPriceBook] = useState<Map<string, PriceEntry>>(new Map());

  /**
   * Keyed name|model, ignoring variant.
   *
   * A shop stocking a Camon 50 in 8/128 and then in 8/256 for the
   * first time has no exact match, and leaving both boxes empty is
   * what "it is not auto-filling" actually looked like. The other
   * configuration's price is the right place to start from — it is
   * usually within a few hundred taka — so it is offered, with a note
   * saying where it came from so nobody takes it on trust.
   */
  const [modelBook, setModelBook] = useState<Map<string, PriceEntry>>(new Map());

  /** Where the prices on screen came from, if not typed. */
  const [priceNote, setPriceNote] = useState("");

  const priceKey = (name: string, model: string, variant: string) =>
    `${name.trim().toLowerCase()}|${model.trim().toLowerCase()}|${variant.trim().toLowerCase()}`;

  const modelKey = (name: string, model: string) =>
    `${name.trim().toLowerCase()}|${model.trim().toLowerCase()}`;

  const loadPriceBook = async () => {
    if (!currentShopId) return;

    let source: any[] = [];

    // PAGINATED, and that is not a detail.
    //
    // PostgREST caps a request at 1000 rows. A shop past that gets an
    // arbitrary thousand back with no error and no sign anything is
    // missing — and since stock is returned in no particular order,
    // the products missing from the price book are effectively random.
    // A manager watching one handset fill and the next not had no way
    // to know why.
    const PAGE = 1000;
    let from = 0;
    let viewFailed = false;

    while (true) {
      const { data, error } = await supabase
        .from("inventory")
        .select("product_name, model_number, variant, cost_price, sale_price")
        .eq("organization_id", currentShopId)
        .range(from, from + PAGE - 1);

      if (error) {
        // The inventory view is not guaranteed to exist — the Inventory
        // screen carries the same fallback. Built from the underlying
        // tables instead, so a shop without the view still gets its
        // prices remembered rather than silently typing them forever.
        console.warn("Price book: inventory unavailable, using tables:", error.message);
        viewFailed = true;
        source = [];
        break;
      }

      source = source.concat(data ?? []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    if (viewFailed) {
      from = 0;
      while (true) {
        const { data: raw, error: rawError } = await supabase
          .from("color_variants")
          .select("variant, purchases!inner(product_name, model_number, cost_price, sale_price)")
          .eq("organization_id", currentShopId)
          .range(from, from + PAGE - 1);

        if (rawError) {
          // A missing price book costs the manager some typing; it must
          // not stop them entering a delivery.
          console.warn("Price book unavailable:", rawError.message);
          return;
        }

        source = source.concat(
          (raw ?? []).map((r: any) => {
            const p = Array.isArray(r.purchases) ? r.purchases[0] : r.purchases;
            return {
              product_name: p?.product_name,
              model_number: p?.model_number,
              variant: r.variant,
              cost_price: p?.cost_price,
              sale_price: p?.sale_price,
            };
          }),
        );

        if (!raw || raw.length < PAGE) break;
        from += PAGE;
      }
    }

    const book = new Map<string, PriceEntry>();
    const byModel = new Map<string, PriceEntry>();

    for (const row of source) {
      const cost = Number(row.cost_price) || 0;
      const sell = Number(row.sale_price) || 0;
      if (cost <= 0 && sell <= 0) continue;

      const entry: PriceEntry = { cost, sell, variant: (row.variant ?? "").trim() };
      book.set(priceKey(row.product_name ?? "", row.model_number ?? "", row.variant ?? ""), entry);
      byModel.set(modelKey(row.product_name ?? "", row.model_number ?? ""), entry);
    }

    setPriceBook(book);
    setModelBook(byModel);
  };

  // ------------------------------------------------------------------
  // What is already in stock
  //
  // Every barcode this shop has ever taken in — sold ones included,
  // because color_variants is unique on (organization_id, barcode) and
  // a sold handset's serial stays spoken for.
  //
  // Held as a set so a scan can be refused the instant it happens.
  // Finding out at save time, after a box of twenty is scanned, told
  // the manager only that "one or more" was a duplicate and left them
  // to work out which — which is the thing the shop asked us to stop.
  // ------------------------------------------------------------------
  const [stockBarcodes, setStockBarcodes] = useState<Set<string>>(new Set());

  const loadStockBarcodes = async () => {
    if (!currentShopId) return;

    // Paged: PostgREST caps a request at 1000 rows and says nothing,
    // so a shop past that would get an arbitrary thousand and let real
    // duplicates through.
    const PAGE = 1000;
    let from = 0;
    const set = new Set<string>();

    while (true) {
      const { data, error } = await supabase
        .from("color_variants")
        .select("barcode")
        .eq("organization_id", currentShopId)
        .not("barcode", "is", null)
        .range(from, from + PAGE - 1);

      if (error) {
        // Without the list the scan check is skipped, not wrong: the
        // save still refuses duplicates, as it always did.
        console.warn("Could not load existing barcodes:", error.message);
        return;
      }

      for (const row of data ?? []) {
        const b = (row as any).barcode;
        if (b) set.add(String(b).trim());
      }

      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    setStockBarcodes(set);
  };

  /**
   * Is this serial already taken, according to the database right now?
   *
   * The preloaded set answers almost every scan without a round trip.
   * This catches the rest — a unit entered on another till since this
   * page was opened.
   */
  const barcodeInStock = async (code: string) => {
    if (!currentShopId) return false;
    const { data, error } = await supabase
      .from("color_variants")
      .select("barcode")
      .eq("organization_id", currentShopId)
      .eq("barcode", code)
      .limit(1);

    if (error) {
      console.warn("Barcode check failed:", error.message);
      return false;
    }
    return (data ?? []).length > 0;
  };

  // Fills both prices the moment the product is identified.
  //
  // Keyed on the combination, so it fires once when a different
  // product is chosen and never again — anything typed afterwards is
  // the manager correcting the price for this lot, and must stand.
  const lastPriceKey = useRef("");

  useEffect(() => {
    // Nothing to match against yet.
    //
    // Returning WITHOUT recording the key is the whole point: the book
    // is fetched asynchronously, and the manager fills the boxes long
    // before it lands. Recording the key here — which the first
    // version did — meant that by the time the prices were available
    // the key already looked "already tried", and the fill was skipped
    // for good. That is why nothing was auto-filling.
    if (priceBook.size === 0 && modelBook.size === 0) return;
    if (!draft.productName.trim()) return;

    const key = priceKey(draft.productName, draft.modelNumber, draft.variant);
    if (key === lastPriceKey.current) return;

    // Recorded on a miss as well as a hit, so a product the shop has
    // never bought does not re-trigger on every keystroke.
    lastPriceKey.current = key;

    // Exact first: this product, this model, this configuration.
    let known = priceBook.get(key);
    let note = "";

    if (known) {
      note = "Filled from the last time this was bought.";
    } else if (draft.modelNumber.trim()) {
      // Then the same handset in a different configuration, which is
      // a starting point rather than an answer — so it says so.
      const near = modelBook.get(modelKey(draft.productName, draft.modelNumber));
      if (near) {
        known = near;
        note = near.variant
          ? `Filled from ${near.variant} — check the price for this one.`
          : "Filled from the last lot of this model — check the price.";
      }
    }

    if (!known) {
      setPriceNote("");
      return;
    }

    setPriceNote(note);
    setDraft((d) => ({
      ...d,
      costPrice: known!.cost > 0 ? String(known!.cost) : d.costPrice,
      sellPrice: known!.sell > 0 ? String(known!.sell) : d.sellPrice,
    }));
  }, [draft.productName, draft.modelNumber, draft.variant, priceBook, modelBook]);

  // ------------------------------------------------------------------
  // Rapid scan
  // ------------------------------------------------------------------

  /** Every barcode already spoken for, on this line or any other. */
  const takenBarcodes = useMemo(() => {
    const set = new Set<string>(scanned);
    for (const line of lines) for (const b of line.barcodes) set.add(b);
    return set;
  }, [scanned, lines]);

  /**
   * The same set, as a ref.
   *
   * A scanner can fire twice inside one React tick, and both scans
   * would then read the same stale memo and both be accepted. The ref
   * is claimed synchronously, before anything is awaited, so the
   * second one loses.
   */
  const takenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    takenRef.current = new Set(takenBarcodes);
  }, [takenBarcodes]);

  /** Serials refused because they are already in stock, newest first. */
  const [rejected, setRejected] = useState<string[]>([]);

  /**
   * One unit, scanned.
   *
   * Checked against stock AS IT IS SCANNED, not at save time. The save
   * refuses duplicates too — the database will not have two units on
   * one serial — but by then a whole box has been scanned and all the
   * manager is told is that one of them is a repeat, with no way to
   * tell which. Refusing at the trigger pull names the offending
   * handset while it is still in their hand.
   *
   * A repeat within this voucher is refused for the same reason.
   */
  const addScan = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;

    setScanCode("");

    // Claimed synchronously so two fast pulls of the same trigger
    // cannot both get through.
    if (takenRef.current.has(code)) {
      toast({
        title: "Already scanned",
        description: `${code} is already on this voucher.`,
        variant: "destructive",
      });
      scanRef.current?.focus();
      return;
    }
    takenRef.current.add(code);

    // Known from the preloaded list — no round trip, no delay.
    if (stockBarcodes.has(code)) {
      takenRef.current.delete(code);
      setRejected((prev) => [code, ...prev.filter((c) => c !== code)].slice(0, 8));
      toast({
        title: "Already in inventory",
        description: `${code} is already in stock. It has not been added.`,
        variant: "destructive",
      });
      scanRef.current?.focus();
      return;
    }

    // Accepted, and straight back to the field: a box of twenty
    // handsets should be twenty trigger pulls and nothing else.
    setScanned((prev) => [...prev, code]);
    scanRef.current?.focus();

    // Then confirm against the database, which catches a unit entered
    // on another till since this page was opened. Not awaited before
    // accepting, because making every scan wait on the network to
    // catch a rare case would slow down every ordinary one.
    if (await barcodeInStock(code)) {
      takenRef.current.delete(code);
      setScanned((prev) => prev.filter((c) => c !== code));
      setRejected((prev) => [code, ...prev.filter((c) => c !== code)].slice(0, 8));
      setStockBarcodes((prev) => new Set(prev).add(code));
      toast({
        title: "Already in inventory",
        description: `${code} was entered elsewhere. It has been taken off the list.`,
        variant: "destructive",
      });
    }
  };

  // Reads the live input value rather than state, and fires on its own
  // for scanners that send no trailing Enter — the same handling the
  // POS counter uses.
  const scanner = useBarcodeScanner({
    onScan: addScan,
    enabled: mode === "scan" && !saving,
  });

  // ------------------------------------------------------------------
  // Adding an item to the voucher
  // ------------------------------------------------------------------

  const draftQty = mode === "scan" ? scanned.length : Number(draft.quantity) || 0;
  const draftCost = Number(draft.costPrice) || 0;
  const draftAmount = draftQty * draftCost;

  const addLine = () => {
    const cost = Number(draft.costPrice);
    const sell = Number(draft.sellPrice);

    if (!draft.productName.trim()) {
      toast({ title: "Product name is required", variant: "destructive" });
      return;
    }

    // Counted stock asks for less, exactly as before: an accessory has
    // no model number and often no colour worth recording.
    if (mode === "scan" && !draft.modelNumber.trim()) {
      toast({ title: "Model number is required", variant: "destructive" });
      return;
    }

    if (!draft.category.trim()) {
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

    if (mode === "scan") {
      if (!draft.color.trim()) {
        toast({
          title: "Colour is required",
          description: "It is what tells two otherwise identical units apart.",
          variant: "destructive",
        });
        return;
      }
      if (scanned.length === 0) {
        toast({
          title: "Nothing scanned",
          description: "Scan at least one unit before adding the item.",
          variant: "destructive",
        });
        return;
      }
    } else if (draftQty <= 0) {
      toast({
        title: "Enter how many",
        description: "Counted stock needs a quantity of 1 or more.",
        variant: "destructive",
      });
      return;
    }

    setLines((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        productName: draft.productName.trim(),
        brand: draft.brand.trim(),
        modelNumber: draft.modelNumber.trim(),
        category: draft.category.trim(),
        variant: draft.variant.trim(),
        color: draft.color.trim(),
        costPrice: cost,
        sellPrice: sell,
        noBarcode: mode === "count",
        quantity: draftQty,
        barcodes: mode === "scan" ? [...scanned] : [],
      },
    ]);

    // The row stays exactly as it is.
    //
    // A delivery is lots of the same thing: twenty of one handset, then
    // twenty more of the next colour. Clearing the product details
    // after every Add meant retyping all eight boxes to change one of
    // them. They now persist until the cross button clears them, so
    // adding the next lot is a colour change and a scan.
    //
    // The scanned units are the exception and MUST clear: those serials
    // are now on a line, and leaving them would put the same handset on
    // the voucher twice.
    setScanned([]);
    setScanCode("");
    setRejected([]);
    if (mode === "scan") scanRef.current?.focus();
  };

  const clearDraft = () => {
    setDraft({ ...EMPTY_DRAFT });
    setScanned([]);
    setScanCode("");
    setRejected([]);
    setPriceNote("");
    // So the next time the same product is picked, it fills again
    // rather than being treated as already tried.
    lastPriceKey.current = "";
  };

  /**
   * Set one of those fields, clearing the ones below it.
   *
   * Only when a real value is REPLACED by a different one. Filling an
   * empty category leaves everything alone, because a manager who types
   * the model number first and the category second should not watch
   * their work disappear — nothing they entered has been contradicted.
   * Changing "Phone" to "Accessories" is different: the model below it
   * now belongs to a product that is not being entered any more.
   */
  const pickField = (field: (typeof CASCADE)[number], value: string) => {
    setDraft((d) => {
      const previous = d[field];
      if (previous === value) return d;

      const next = { ...d, [field]: value };
      if (previous.trim() && value.trim()) {
        for (const below of CASCADE.slice(CASCADE.indexOf(field) + 1)) {
          next[below] = "";
        }
      }
      return next;
    });
  };

  /**
   * What the dropdowns below need in order to narrow themselves. Every
   * field is handed the whole selection and works out for itself which
   * parts of it sit above it.
   */
  const productContext = {
    category: draft.category,
    brand: draft.brand,
    product_name: draft.productName,
    model_number: draft.modelNumber,
  };

  // Colour and the prices narrow by the variant as well: an 8+256 comes
  // in different colours and at a different price from a 4/128.
  const stockedContext = { ...productContext, variant: draft.variant };

  /**
   * Switching between scanned and counted stock empties the tray.
   *
   * Without this, units scanned and then abandoned stay in
   * takenBarcodes and quietly refuse themselves as duplicates when the
   * manager scans them again for real.
   */
  const switchMode = (next: "scan" | "count") => {
    if (next === mode) return;
    setMode(next);
    setScanned([]);
    setScanCode("");
    setRejected([]);
    setDraft((d) => ({ ...d, quantity: "" }));
  };

  // ------------------------------------------------------------------
  // Totals
  // ------------------------------------------------------------------

  /**
   * The voucher, in the order the shop states it.
   *
   *   net     what the goods came to      = sum(qty x cost)
   *   party   what is actually owed       = net - discount + adjustment
   *   due     left owing on the day       = party - paid
   *
   * "Party" is the supplier: it is the word on the paper voucher the
   * manager is copying from, so it is the word on the screen.
   */
  const totals = useMemo(() => {
    let cost = 0;
    let units = 0;
    for (const l of lines) {
      cost += l.quantity * l.costPrice;
      units += l.quantity;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const net = round2(cost);
    const discount = Math.max(0, Number(discountText) || 0);
    const adjustment = Number(adjustmentText) || 0;
    const party = round2(net - discount + adjustment);
    const paid = Math.max(0, Number(paidText) || 0);
    const due = round2(party - paid);

    return {
      units,
      net,
      discount,
      adjustment,
      party,
      paid,
      due,
      // Flagged rather than blocked as it is typed — a half-typed
      // figure is briefly wrong and should not make the screen shout.
      overpaid: paid > party,
      negativeParty: party < 0,
    };
  }, [lines, discountText, adjustmentText, paidText]);

  // ------------------------------------------------------------------
  // Saving
  //
  // The whole delivery goes to the database in one call, and either
  // all of it is written or none of it is.
  //
  // It used to save line by line from here, and a failure half way
  // through left some products in stock and some not. That was
  // survivable while a purchase was only a stock record. It is not
  // survivable now the voucher carries a debt: a half-saved voucher
  // states an amount owed to the supplier for goods that never
  // arrived, and that figure then goes on the Expenses screen for
  // someone to pay.
  //
  // save_purchase_voucher (script 66) does exactly what this loop did
  // — the same purchase rows, the same color_variants rows, the same
  // inventory trigger behind them — inside one transaction.
  // ------------------------------------------------------------------

  const saveVoucher = async () => {
    if (!currentShopId) return;

    if (!supplierId) {
      toast({ title: "Select a supplier", variant: "destructive" });
      return;
    }

    if (lines.length === 0) {
      toast({
        title: "Nothing to save",
        description: "Add at least one item to the voucher.",
        variant: "destructive",
      });
      return;
    }

    if (totals.negativeParty) {
      toast({
        title: "Check the discount",
        description: "It is more than the voucher comes to.",
        variant: "destructive",
      });
      return;
    }

    if (totals.overpaid) {
      toast({
        title: "Check the paid amount",
        description: `It is more than the ${money(totals.party)} owed on this voucher.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // A last look before writing, and the ONLY place that can still
      // name the offender.
      //
      // Scanning refuses duplicates as they happen, so this should
      // never fire — but a unit entered on another till a minute ago
      // would slip past it, and the RPC rolls the whole voucher back
      // without saying which serial was at fault. One query buys the
      // manager the barcode instead of "one or more".
      const allBarcodes = lines.flatMap((l) => l.barcodes);
      if (allBarcodes.length > 0) {
        const { data: clash } = await supabase
          .from("color_variants")
          .select("barcode")
          .eq("organization_id", currentShopId)
          .in("barcode", allBarcodes);

        if (clash && clash.length > 0) {
          const taken = clash.map((r: any) => r.barcode);
          setRejected((prev) => [...taken, ...prev.filter((c) => !taken.includes(c))].slice(0, 8));
          toast({
            title: "Already in inventory",
            description: `${taken.join(", ")} — take ${
              taken.length === 1 ? "it" : "them"
            } off the voucher and save again. Nothing has been written.`,
            variant: "destructive",
          });
          return;
        }
      }

      const { data, error } = await supabase.rpc("save_purchase_voucher", {
        p_organization_id: currentShopId,
        // A retry after the network drops on the way back must not put
        // the delivery in twice. Generated per attempt, so a genuine
        // second voucher is still a second voucher.
        p_client_txn_id: crypto.randomUUID(),
        p_voucher: {
          supplier_id: supplierId,
          supplier: supplierName,
          voucher_date: voucherDate,
          discount: totals.discount,
          adjustment: totals.adjustment,
          paid_amount: totals.paid,
          remarks: description.trim() || null,
        },
        p_lines: lines.map((l) => ({
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
        })),
      });

      if (error) {
        console.error("save_purchase_voucher failed:", error);
        toast({
          title: "Could not save the voucher",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      const result = data as {
        success: boolean;
        message?: string;
        voucher_no?: string;
        // Net of anything the supplier's advance covered.
        due_amount?: number;
        // Script 97. Absent on a database that has not run it, where
        // due_amount is the whole due and this reads as zero.
        advance_applied?: number;
      } | null;

      if (!result?.success) {
        toast({
          title: "Could not save the voucher",
          description: result?.message ?? "Nothing was written. Nothing has changed.",
          variant: "destructive",
        });
        return;
      }

      const due = Number(result.due_amount ?? 0);
      // Money this supplier was already holding, spent on this
      // delivery. Worth saying out loud: nothing was handed over at
      // the counter, so without it the voucher looks paid by magic.
      const fromAdvance = Number(result.advance_applied ?? 0);
      setLastSaved({ voucherNo: result.voucher_no ?? "", due, fromAdvance });

      const stock = `${lines.length} item${lines.length === 1 ? "" : "s"} added to stock`;
      const advanceBit =
        fromAdvance > 0 ? ` ${money(fromAdvance)} came off the advance with ${supplierName}.` : "";

      toast({
        title: `Voucher ${result.voucher_no} saved`,
        description:
          due > 0
            ? `${stock}.${advanceBit} ${money(due)} left owing to ${supplierName}.`
            : `${stock}, paid in full.${advanceBit}`,
      });

      // Clear the voucher, keeping the supplier and the date: a
      // manager entering three of one supplier's invoices should not
      // reselect them each time.
      setLines([]);
      setDescription("");
      setDiscountText("");
      setAdjustmentText("");
      setPaidText("");
      clearDraft();

      // The stored copies too. Clearing the screen alone would let the
      // whole voucher reappear on the next visit to this page.
      clearDrafts(currentShopId, [
        "pv.lines",
        "pv.description",
        "pv.discount",
        "pv.adjustment",
        "pv.paid",
        "pv.draft",
        "pv.scanned",
      ]);

      // What was just bought in is what the next lot should offer —
      // and its serials are now taken.
      loadPriceBook();
      loadStockBarcodes();
    } catch (err: any) {
      console.error("Unexpected error:", err);
      toast({
        title: "Error",
        description: "An unexpected error occurred while saving.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------------
  // Supplier dialog
  // ------------------------------------------------------------------

  const addSupplier = async () => {
    if (!newSupplier.name.trim()) {
      toast({ title: "Supplier name is required", variant: "destructive" });
      return;
    }

    setAddingSupplier(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user?.id) {
        toast({
          title: "Not authenticated",
          description: "Please sign in before adding a supplier.",
          variant: "destructive",
        });
        return;
      }

      const { data, error } = await supabase
        .from("suppliers")
        .insert([
          {
            name: newSupplier.name.trim(),
            contact_person: newSupplier.contact || null,
            phone: newSupplier.phone || null,
            email: newSupplier.email || null,
            address: newSupplier.address || null,
            owner: user.id,
            organization_id: currentShopId,
          },
        ])
        .select("id, name")
        .single();

      if (error) {
        console.error("Supplier insert error:", error);
        toast({
          title: "Could not add supplier",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      await loadSuppliers();
      setSupplierId(data.id);
      setShowAddSupplier(false);
      setNewSupplier({ name: "", contact: "", phone: "", email: "", address: "" });
      toast({ title: "Supplier added", description: data.name });
    } finally {
      setAddingSupplier(false);
    }
  };

  // ------------------------------------------------------------------

  /**
   * Commit the item being typed.
   *
   * Defined once and placed twice: with the fields for counted stock,
   * and at the foot of the scan box when scanning, where the lot is
   * actually finished.
   */
  const actions = (
    <div className="flex gap-2">
      <Button type="button" className="flex-1" onClick={addLine} disabled={saving}>
        <Plus className="mr-1.5 h-4 w-4" />
        {mode === "scan" && scanned.length > 0
          ? `Add ${scanned.length} unit${scanned.length === 1 ? "" : "s"}`
          : "Add"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={clearDraft}
        disabled={saving}
        title="Clear these fields"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ---- The voucher: true of the whole delivery ---- */}
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="pv-date">Voucher date</Label>
          {/* A delivery is often entered the morning after it lands,
              and the supplier's invoice carries its own date. Defaults
              to today, so nothing changes for anyone who ignores it. */}
          <Input
            id="pv-date"
            type="date"
            className="w-[170px]"
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value || todayLocal())}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pv-supplier">Supplier*</Label>
          <div className="flex gap-2">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="pv-supplier">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Add a supplier"
              onClick={() => setShowAddSupplier(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <SupplierEditButton
              supplier={suppliers.find((s) => s.id === supplierId) ?? null}
              onRenamed={loadSuppliers}
              onRemoved={async () => {
                setSupplierId("");
                await loadSuppliers();
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pv-description">Description (optional)</Label>
          <Input
            id="pv-description"
            placeholder="Delivery note, lot number…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Entry mode</Label>
          {/* Scanned units or counted units. Accessories — cables,
              covers, glass — have no barcode worth scanning; the shop
              counts them. */}
          <div className="flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => switchMode("scan")}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "scan"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Scan each unit
            </button>
            <button
              type="button"
              onClick={() => switchMode("count")}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "count"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Count quantity
            </button>
          </div>
        </div>
      </div>

      {/* ---- The item being typed ---- */}
      <div className="space-y-3 rounded-lg border p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {/* Left to right IS the hierarchy: each field narrows the one
              after it, so the row reads in the order the manager fills
              it. Category first, because it is the widest cut. */}
          <OptionCombobox
            kind="category"
            label="Category*"
            value={draft.category}
            onChange={(v) => pickField("category", v)}
            context={productContext}
            placeholder="Select or type category"
          />
          <OptionCombobox
            kind="brand"
            label="Brand"
            value={draft.brand}
            onChange={(v) => pickField("brand", v)}
            context={productContext}
            placeholder="Select or type brand"
          />
          <OptionCombobox
            kind="product_name"
            label="Product Name*"
            value={draft.productName}
            onChange={(v) => pickField("productName", v)}
            context={productContext}
            placeholder="Select or type product name"
          />
          <OptionCombobox
            kind="model_number"
            label={mode === "scan" ? "Model Number*" : "Model Number"}
            value={draft.modelNumber}
            onChange={(v) => pickField("modelNumber", v)}
            context={productContext}
            placeholder="Select or type model number"
          />
          <OptionCombobox
            kind="variant"
            label="Variant"
            value={draft.variant}
            onChange={(v) => pickField("variant", v)}
            // Not narrowed: the shop wants every variant offered, since
            // a model often arrives in one it has not bought before.
            placeholder="e.g. 4/64, 6/128"
          />
        </div>

        <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
          <OptionCombobox
            kind="color"
            label={mode === "scan" ? "Colour*" : "Colour"}
            value={draft.color}
            onChange={(v) => setDraft((d) => ({ ...d, color: v }))}
            // Not narrowed, for the same reason as the variant.
            placeholder="Select or type colour"
          />

          {mode === "count" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pv-qty">Quantity*</Label>
              <Input
                id="pv-qty"
                type="number"
                min={1}
                placeholder="0"
                value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Units scanned</Label>
              <div className="flex h-10 items-center rounded-md border bg-background px-3 text-sm font-semibold tabular-nums">
                {scanned.length}
              </div>
            </div>
          )}

          {/* Prices are chosen the same way as model and variant: type
              one once, and it is offered from then on. They still
              auto-fill from the last purchase of this exact product —
              this is for the first time, and for correcting. */}
          <OptionCombobox
            kind="cost_price"
            label="Cost Price*"
            value={draft.costPrice}
            onChange={(v) => setDraft((d) => ({ ...d, costPrice: v }))}
            context={stockedContext}
            placeholder="Select or type cost"
          />

          <OptionCombobox
            kind="sale_price"
            label="Selling Price*"
            value={draft.sellPrice}
            onChange={(v) => setDraft((d) => ({ ...d, sellPrice: v }))}
            context={stockedContext}
            placeholder="Select or type price"
          />

          <div className="space-y-1.5">
            <Label>Amount</Label>
            <div className="flex h-10 items-center justify-end rounded-md bg-primary/10 px-3 text-sm font-semibold tabular-nums">
              {money(draftAmount)}
            </div>
          </div>

          {/* Counted stock has no scan box to put these in, so they
              stay with the fields. Scanning moves them down beside the
              serials — see below. */}
          {mode === "count" && actions}
        </div>

        {/* Where the prices came from. Silent when they were typed. */}
        {priceNote && (
          <p className="text-xs text-muted-foreground">{priceNote}</p>
        )}

        {/* ---- Rapid scan ---- */}
        {mode === "scan" && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <Label htmlFor="pv-scan">Scan IMEI / barcode — stays ready for the next one</Label>
                <Input
                  id="pv-scan"
                  ref={scanRef}
                  autoComplete="off"
                  placeholder="Scan or type, then Enter"
                  value={scanCode}
                  onChange={(e) => {
                    setScanCode(e.target.value);
                    scanner.onChange(e.target.value);
                  }}
                  onKeyDown={scanner.onKeyDown}
                  disabled={saving}
                />
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {scanned.length}
                </span>{" "}
                scanned ·{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {money(scanned.length * draftCost)}
                </span>
              </div>
            </div>

            {/* Refused because they are already in stock. Kept on
                screen as well as in the toast: a toast is gone in
                seconds, and the manager needs to know which handset to
                put back in the box. */}
            {rejected.length > 0 && (
              <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-destructive">
                  Already in inventory — not added
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {rejected.map((code) => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1.5 rounded border border-destructive/40 bg-background px-2 py-0.5 font-mono text-xs"
                    >
                      {code}
                      <button
                        type="button"
                        title="Dismiss"
                        className="text-muted-foreground"
                        onClick={() =>
                          setRejected((prev) => prev.filter((c) => c !== code))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* The serials, and the button that commits them. Adding
                is the last thing that happens to a scanned lot, so it
                belongs at the end of the box the scanning happens in
                rather than back up among the fields. */}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-[200px] flex-1 flex-wrap gap-1.5">
                {scanned.map((code, i) => (
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
                        setScanned((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="shrink-0">{actions}</div>
            </div>
          </div>
        )}
      </div>

      {/* ---- What is on the voucher so far ---- */}
      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Variant / Colour</TableHead>
                {/* Wide enough that a full list of serials wraps into
                    a readable block rather than a single column. */}
                <TableHead className="min-w-[280px]">Units</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Sell</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                    Nothing on this voucher yet. Fill the row above and press Add.
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((line, idx) => (
                  <TableRow key={line.id}>
                    <TableCell className="tabular-nums">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{line.productName}</TableCell>
                    <TableCell>{line.brand || "—"}</TableCell>
                    <TableCell>{line.modelNumber || "—"}</TableCell>
                    <TableCell>{line.category}</TableCell>
                    <TableCell>
                      {[line.variant, line.color].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell>
                      {line.noBarcode ? (
                        <span className="text-xs text-muted-foreground">Counted</span>
                      ) : (
                        /* Every unit, numbered, not "+7 more".
                           This is the column the manager checks the
                           delivery against — a hidden serial is one
                           that cannot be verified against the box. */
                        <ol className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {line.barcodes.map((code, i) => (
                            <li key={code} className="font-mono text-xs tabular-nums">
                              <span className="text-muted-foreground">{i + 1}.</span> {code}
                            </li>
                          ))}
                        </ol>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
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
                        title="Take this item off the voucher"
                        disabled={saving}
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

      {/* ---- Settlement: what is owed, and what is being paid now ----

          Filled in before the voucher is saved, in the order the paper
          voucher states it. Whatever is left over becomes the debt on
          the Expenses screen; leave Paid empty and the whole voucher
          is owed, type the full amount and nothing is. */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="space-y-1.5">
            <Label htmlFor="pv-qty">Total qty</Label>
            <Input
              id="pv-qty"
              readOnly
              tabIndex={-1}
              value={String(totals.units)}
              className="bg-muted font-semibold tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pv-net">Net amount</Label>
            <Input
              id="pv-net"
              readOnly
              tabIndex={-1}
              value={money(totals.net)}
              className="bg-muted font-semibold tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pv-discount">Discount (৳)</Label>
            <Input
              id="pv-discount"
              inputMode="decimal"
              placeholder="0.00"
              value={discountText}
              onChange={(e) => setDiscountText(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pv-adjustment">Adjustment (৳)</Label>
            {/* Carriage, a correction, a credit note. Added on, so a
                negative figure takes it back off. */}
            <Input
              id="pv-adjustment"
              inputMode="decimal"
              placeholder="0.00"
              value={adjustmentText}
              onChange={(e) => setAdjustmentText(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pv-party">Party amount</Label>
            <Input
              id="pv-party"
              readOnly
              tabIndex={-1}
              value={money(totals.party)}
              className={`bg-muted font-semibold tabular-nums ${
                totals.negativeParty ? "text-destructive" : ""
              }`}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pv-paid">Paid amount (৳)</Label>
            <Input
              id="pv-paid"
              inputMode="decimal"
              placeholder="0.00"
              value={paidText}
              onChange={(e) => setPaidText(e.target.value)}
              className={totals.overpaid ? "border-destructive" : ""}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div
            className={`rounded-lg border px-4 py-2 ${
              totals.due > 0
                ? "border-destructive/40 bg-destructive/10"
                : "bg-background"
            }`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Dues amount
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                totals.due > 0 ? "text-destructive" : ""
              }`}
            >
              {money(Math.max(0, totals.due))}
            </div>
            {totals.overpaid && (
              <div className="text-xs text-destructive">
                Paid is more than the {money(totals.party)} owed.
              </div>
            )}
            {totals.negativeParty && (
              <div className="text-xs text-destructive">
                The discount is more than the voucher comes to.
              </div>
            )}
            {!totals.overpaid && !totals.negativeParty && totals.due > 0 && supplierName && (
              <div className="text-xs text-muted-foreground">
                Will be owed to {supplierName}. Pay it from Expenses → Supplier Payment.
              </div>
            )}
          </div>

          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving || lines.length === 0}
              onClick={() => setLines([])}
            >
              Clear
            </Button>
            <Button type="button" onClick={saveVoucher} disabled={saving || lines.length === 0}>
              <Save className="mr-1.5 h-4 w-4" />
              {saving ? "Saving…" : "Save voucher"}
            </Button>
          </div>
        </div>

        {/* The voucher number, which only exists once it is saved. */}
        {lastSaved && (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            Saved as <span className="font-semibold">{lastSaved.voucherNo}</span>
            {lastSaved.fromAdvance > 0
              ? ` — ${money(lastSaved.fromAdvance)} taken from the advance`
              : ""}
            {lastSaved.due > 0
              ? ` — ${money(lastSaved.due)} left owing.`
              : " — paid in full."}{" "}
            <span className="text-muted-foreground">
              Find it again under Purchases → Vouchers.
            </span>
          </div>
        )}
      </div>

      {/* ---- Add supplier ---- */}
      <Dialog open={showAddSupplier} onOpenChange={setShowAddSupplier}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Add supplier</DialogTitle>
            <DialogDescription>
              They will be offered on every purchase from now on.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ns-name">Name*</Label>
              <Input
                id="ns-name"
                value={newSupplier.name}
                onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ns-contact">Contact person</Label>
                <Input
                  id="ns-contact"
                  value={newSupplier.contact}
                  onChange={(e) => setNewSupplier((s) => ({ ...s, contact: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ns-phone">Phone</Label>
                <Input
                  id="ns-phone"
                  value={newSupplier.phone}
                  onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ns-email">Email</Label>
              <Input
                id="ns-email"
                type="email"
                value={newSupplier.email}
                onChange={(e) => setNewSupplier((s) => ({ ...s, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ns-address">Address</Label>
              <Textarea
                id="ns-address"
                rows={2}
                value={newSupplier.address}
                onChange={(e) => setNewSupplier((s) => ({ ...s, address: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddSupplier(false)}
              disabled={addingSupplier}
            >
              Cancel
            </Button>
            <Button type="button" onClick={addSupplier} disabled={addingSupplier}>
              {addingSupplier ? "Adding…" : "Add supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

