"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { PackageSearch, Save, X, Search } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
import { clearDrafts, useDraft } from "@/hooks/use-draft";
import { useBarcodeScanner, useFieldFlow } from "@/hooks/use-keyboard-flow";
import { NoBarcodePicker } from "@/components/no-barcode-picker";
import { openPrintableReceipt } from "@/lib/receipt";
import { Checkbox } from "@/components/ui/checkbox";
import {
  PaymentRoute,
  usePaymentMethods,
  toLegacyTotals,
  firstBankFor,
  describeRoute,
  EMPTY_ROUTE,
  type PaymentRouteValue,
  type PaymentLine,
} from "@/components/payment-route";

type SaleItem = {
  id: number;
  barcode: string | null;
  product_name: string;
  model_number: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  sales_id: number;
};

type SaleInfo = {
  sale_id: number;
  invoice_number?: string | null;
  sale_date: string;
  total_amount: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
};

const supabase = createClient();

/**
 * onClose is optional because this form is also used on its own page,
 * not only inside a dialog. The Returns screen was already passing it —
 * the prop simply was not declared, so it was silently dropped and the
 * dialog stayed open after a return was processed.
 */
export function SalesReturnForm({ onClose }: { onClose?: () => void } = {}) {
  const { toast } = useToast();
  const { currentShopId, shops } = useRole();

  // IMEI load state
  const [imeiNumber, setImeiNumber] = useState("");
  const [loading, setLoading] = useState(false);
  // Cables, covers and neck bands have nothing to scan. Both sides of
  // an exchange need finding that way: what is coming back, and what
  // is going out in its place.
  const [pickingReturned, setPickingReturned] = useState(false);
  const [pickingReplacement, setPickingReplacement] = useState(false);

  // loaded sale & item
  const [saleInfo, setSaleInfo] = useState<SaleInfo | null>(null);
  const [selectedItem, setSelectedItem] = useState<SaleItem | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);

  // form fields
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [productName, setProductName] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [reason, setReason] = useDraft("sr.reason", "", currentShopId);
  const [returnDate, setReturnDate] = useState<string>("");
  const [notes, setNotes] = useDraft("sr.notes", "", currentShopId);
  const [refundMethod, setRefundMethod] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ---- Exchange (the normal path) vs money back (the exception)
  const [moneyBack, setMoneyBack] = useState(false);
  const [replacementBarcode, setReplacementBarcode] = useDraft(
    "sr.replacementBarcode",
    "",
    currentShopId,
  );
  const [replacement, setReplacement] = useState<any>(null);
  const [loadingReplacement, setLoadingReplacement] = useState(false);
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods();
  const [exchangeRoute, setExchangeRoute] =
    useState<PaymentRouteValue>(EMPTY_ROUTE);

  /**
   * What the returned handset is worth TODAY.
   *
   * A phone brought back a month after it was sold is not worth what
   * was paid for it, and the shop is the only thing that can say what
   * it is worth — there is no depreciation rule a till could apply.
   * So this box is left blank and the manager fills it in: sold at
   * 34,999, taken back at 30,000, and the customer pays the 4,999
   * difference to swap it for the same model.
   *
   * Blank means no reduction, so a same-day return behaves exactly as
   * it always has. Kept as text for the usual reason: `Number("") || 0`
   * cannot tell an empty box from a deliberate zero.
   *
   * Deliberately NOT the Unit Price box, which stays as what the
   * customer actually paid. Overwriting that would falsify the record
   * of the sale to record a fact about the return.
   */
  const [returnValueText, setReturnValueText] = useDraft(
    "sr.returnValue",
    "",
    currentShopId,
  );

  const returnValue =
    returnValueText.trim() === "" ? unitPrice : Number(returnValueText) || 0;

  const valueReduced = returnValueText.trim() !== "" && returnValue !== unitPrice;

  /** How much the handset lost in value, as the shop assessed it. */
  const reduction = Number(Math.max(0, unitPrice - returnValue).toFixed(2));

  /**
   * What the customer owes on the swap.
   *
   * Two parts, on the shop's instruction:
   *
   *   the swap itself   replacement - what the old handset is taken at
   *   the reduction     what it lost in value, charged to the customer
   *
   * Worth being plain about: the reduction is borne twice. Taking the
   * handset at 10,000 rather than 16,999 already costs the customer
   * 6,999, and this adds the same 6,999 again. That is the shop's
   * call, not an accident of the arithmetic — so both lines are shown
   * separately on screen rather than folded into one figure nobody at
   * the counter could explain to the customer.
   *
   * With the box left blank the reduction is zero and this is the
   * ordinary replacement-minus-trade-in it has always been.
   *
   * Negative means the replacement is cheaper, which this shop does
   * not allow.
   */
  const priceDifference = Number(
    (
      Number(replacement?.price ?? 0) - returnValue + reduction || 0
    ).toFixed(2),
  );

  // What the customer actually handed over.
  //
  // Text rather than a number so the box can be cleared and retyped —
  // `Number("") || 0` turns an empty field into a deliberate zero.
  // Empty means "the exact difference", which is what every exchange
  // did before this box existed.
  const [receivedText, setReceivedText] = useDraft("sr.received", "", currentShopId);

  const received =
    receivedText.trim() === "" ? priceDifference : Number(receivedText) || 0;

  const changeDue = Number((received - priceDifference).toFixed(2));

  // Change is a cash-drawer idea. bKash and card are sent for an exact
  // amount, so more than the difference there is a typo, not a tender.
  const takesChange = exchangeRoute.method === "cash";

  // The refund, on the money-back path. Based on what the handset is
  // worth today, not on what was paid for it a month ago.
  const totalAmount = useMemo(
    () => Number((quantity * returnValue || 0).toFixed(2)),
    [quantity, returnValue],
  );

  /**
   * Put the form back to a clean slate.
   *
   * Everything is cleared, including the loaded sale and item — not
   * only the fields the cashier typed. A half-cleared form is the
   * dangerous state: the previous handset stays loaded, and re-filling
   * the reason and refund method is enough to return the same item
   * twice, refunding twice and adding the stock back twice.
   */
  const resetForm = () => {
    setImeiNumber("");
    setSaleInfo(null);
    setSelectedItem(null);
    setCustomerId(null);
    setCustomerName("");
    setCustomerPhone("");
    setProductName("");
    setModelNumber("");
    setColor("");
    setQuantity(1);
    setUnitPrice(0);
    // A reduction agreed for the last handset must not carry over and
    // quietly discount the next customer's return.
    setReturnValueText("");
    setReason("");
    setNotes("");
    setRefundMethod("");
    setReturnDate(new Date().toISOString().split("T")[0]);
    // The exchange side too, for the same reason: a replacement left
    // loaded would be taken out of stock again on the next submit.
    setReplacementBarcode("");
    setReplacement(null);
    setExchangeRoute(EMPTY_ROUTE);
    // Left behind, the previous customer's tender would be applied to
    // the next swap and hand out change nobody asked for.
    setReceivedText("");
    scanFoundRef.current = false;
    // The stored copies too, or the previous customer's return
    // reappears behind the next one.
    clearDrafts(currentShopId, [
      "sr.returnValue",
      "sr.reason",
      "sr.notes",
      "sr.replacementBarcode",
      "sr.received",
    ]);
    lookupRef.current?.focus();
  };

  /**
   * Look up the handset the customer is taking away.
   *
   * Stock is checked here so the cashier finds out at the counter, not
   * after the customer has left — though the database refuses it again
   * on submit, which is the check that actually counts.
   */
  async function loadReplacement(code: string) {
    const barcode = code.trim();
    if (!barcode || !currentShopId) return;

    setLoadingReplacement(true);
    try {
      const { data, error } = await supabase.rpc("get_product_by_barcode", {
        p_barcode: barcode,
        p_organization_id: currentShopId,
      });
      if (error) throw error;

      if (!data?.success) {
        setReplacement(null);
        toast({
          title: "Not found",
          description: data?.message ?? `No product with barcode ${barcode}.`,
          variant: "destructive",
        });
        return;
      }

      if ((data.available_quantity ?? 0) < 1) {
        setReplacement(data);
        toast({
          title: "Out of stock",
          description: `${data.name} has none left — the exchange will be refused.`,
          variant: "destructive",
        });
        return;
      }

      setReplacement(data);
    } catch (err: any) {
      toast({
        title: "Lookup failed",
        description: err?.message ?? "Could not load that product.",
        variant: "destructive",
      });
    } finally {
      setLoadingReplacement(false);
    }
  }

  // Set today's date as default return date
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    setReturnDate(today);
  }, []);

  // `code` lets a scan hand its value straight in: React state is not
  // readable in the same tick it is set, so the scanner path passes the
  // raw code. Called with no argument — as the Load button does — it
  // reads the IMEI box exactly as before.
  async function loadByImei(code?: string) {
    const imei = (code ?? imeiNumber).trim();
    if (!imei) {
      toast({
        title: "Enter IMEI",
        description: "Please enter an IMEI number.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      console.log("Searching for IMEI:", imei);

      // Find the sold product by IMEI (barcode)
      let productData = null;

      // Try exact match first
      const { data: exactMatch } = await supabase
        .from("sold_products")
        .select(
          "id, sales_id, barcode, product_name, model_number, color, quantity, unit_price, total_price",
        )
        .eq("organization_id", currentShopId)
        .eq("barcode", imei)
        .maybeSingle();

      if (exactMatch) {
        productData = exactMatch;
      } else {
        // Try case-insensitive match
        const { data: caseMatch } = await supabase
          .from("sold_products")
          .select(
            "id, sales_id, barcode, product_name, model_number, color, quantity, unit_price, total_price",
          )
          .eq("organization_id", currentShopId)
          .ilike("barcode", imei)
          .maybeSingle();

        if (caseMatch) {
          productData = caseMatch;
        } else {
          // Try partial match (handles extra characters)
          const { data: partialMatch } = await supabase
            .from("sold_products")
            .select(
              "id, sales_id, barcode, product_name, model_number, color, quantity, unit_price, total_price",
            )
            .eq("organization_id", currentShopId)
            .ilike("barcode", `%${imei}%`)
            .maybeSingle();

          if (partialMatch) {
            productData = partialMatch;
          }
        }
      }

      if (!productData) {
        toast({
          title: "Not found",
          description: `No product found with IMEI"${imei}".`,
          variant: "destructive",
        });
        return;
      }

      await populateFromSoldRow(productData);
    } catch (e: any) {
      console.error("Load error:", e);
      toast({
        title: "Error",
        description: e?.message || "Failed to load product.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Fill the form from one sold line.
   *
   * Split out of loadByImei so the same work serves both ways in: a
   * scanned serial, and a counted-stock line picked from the list.
   * Counted stock has no barcode to scan but is otherwise an ordinary
   * sale, so from here on the two are the same thing.
   */
  async function populateFromSoldRow(productData: any) {
    // Get sales data separately to avoid JOIN issues
    let saleData = null;
    if (productData.sales_id) {
      const { data: salesData, error: salesError } = await supabase
        .from("sales")
        .select("*")
        .eq("organization_id", currentShopId)
        .eq("id", productData.sales_id)
        .maybeSingle();

      if (!salesError && salesData) {
        saleData = salesData;
      }
    }

    // Get customer info from sale_customers table
    let customerName = "";
    let customerPhone = "";
    let customerEmail = "";
    let foundCustomerId = null;

    if (productData.sales_id) {
      const { data: saleCustomer, error: customerError } = await supabase
        .from("sale_customers")
        .select("customer_id, customer_name, customer_phone, customer_email")
        .eq("organization_id", currentShopId)
        .eq("sales_id", productData.sales_id)
        .maybeSingle();

      if (!customerError && saleCustomer) {
        customerName = saleCustomer.customer_name || "";
        customerPhone = saleCustomer.customer_phone || "";
        customerEmail = saleCustomer.customer_email || "";
        foundCustomerId = saleCustomer.customer_id;
        console.log("Found customer from sale_customers:", saleCustomer);
      } else {
        console.log(
          "No customer found in sale_customers table for sales_id:",
          productData.sales_id,
        );
      }
    }

    setCustomerName(customerName);
    setCustomerPhone(customerPhone);

    // Use customer ID from sale_customers if available, otherwise try to find by phone
    if (foundCustomerId) {
      setCustomerId(foundCustomerId);
    } else if (customerPhone) {
      const { data: found } = await supabase
        .from("customers")
        .select("id")
        .eq("organization_id", currentShopId)
        .eq("phone_number", customerPhone)
        .limit(1)
        .maybeSingle();
      setCustomerId(found?.id ?? null);
    } else {
      setCustomerId(null);
    }

    // Set product info
    setSelectedItem(productData);
    scanFoundRef.current = true;
    setProductName(productData.product_name || "");
    setModelNumber(productData.model_number || "");
    setColor(productData.color || "");
    setUnitPrice(productData.unit_price || 0);
    setQuantity(1);

    // Set sale info
    setSaleInfo({
      sale_id: productData.sales_id || 0,
      invoice_number:
        saleData?.invoice_number || saleData?.invoicenumber || "",
      sale_date: saleData?.sale_date || saleData?.saledate || "",
      total_amount: saleData?.total_amount || saleData?.totalamount || 0,
      customer_name: customerName,
      customer_phone: customerPhone,
    });

    const displayId =
      saleData?.invoice_number ||
      (productData.sales_id ? `#${productData.sales_id}` : "Unknown");
    toast({
      title: "Product loaded successfully",
      description: `Loaded ${productData.product_name} from sale ${displayId}`,
    });
  }

  /**
   * Load one sold line that was picked from the list rather than
   * scanned.
   *
   * Fetched by ROW ID, not by key. A counted-stock key belongs to every
   * sale of that cable, so asking for it by key returns several rows
   * and .maybeSingle() fails with PGRST116 — which is why typing the
   * internal key by hand would not have worked either.
   */
  async function loadPickedSoldItem(id: number) {
    if (!currentShopId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sold_products")
        .select(
          "id, sales_id, barcode, product_name, model_number, color, quantity, unit_price, total_price",
        )
        .eq("organization_id", currentShopId)
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast({
          title: "Not found",
          description: "That sold item could not be loaded again.",
          variant: "destructive",
        });
        return;
      }

      setImeiNumber(data.barcode ?? "");
      await populateFromSoldRow(data);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "Failed to load that item.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  // ---- Keyboard-first entry
  //
  // Returns are taken at the counter with the customer waiting, so the
  // form has to run off the scanner and the Enter key alone. Enter walks
  // the fields instead of firing the form, and a scan loads the sold
  // item automatically — no"Load" click.

  const flow = useFieldFlow();
  // Index of the Quantity input in the field flow below.
  const QUANTITY_FIELD = 5;

  // A scan (or Enter in the IMEI box) loads the sale line and parks the
  // cursor on Quantity, so the rest of the return is a few Enters away.
  // Set by loadByImei when it actually finds the item, so a failed
  // scan doesn't move the cursor away from the lookup box.
  const scanFoundRef = useRef(false);
  const lookupRef = useRef<HTMLInputElement>(null);
  const focusLookup = () => {
    lookupRef.current?.focus();
    lookupRef.current?.select?.();
  };

  // Not memoised on purpose: useBarcodeScanner keeps the latest callback
  // in a ref, so a fresh closure each render avoids a stale loadByImei.
  const handleScan = async (code: string) => {
    setImeiNumber(code);
    scanFoundRef.current = false;
    await loadByImei(code);
    // Only advance on a hit. A miss keeps the cursor in the lookup box
    // with the text selected, so the next scan just overwrites it —
    // mis-scans are routine and shouldn't cost a mouse trip.
    if (scanFoundRef.current) flow.focusIndex(QUANTITY_FIELD);
    else focusLookup();
  };

  const scanner = useBarcodeScanner({ onScan: handleScan, enabled: !loading });

  // A stray Enter in a text input submits the surrounding <form>. In the
  // IMEI box it must run the lookup instead.
  const imeiKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
    scanner.onKeyDown(e);
  };

  /**
   * Swap the handset.
   *
   * Everything of consequence happens inside `process_exchange`: the
   * stock moves under a row lock, the returned unit comes back marked
   * defective, and any difference is written as an ordinary completed
   * sale so Day Cashbook, Ledger and Bank Info report it without
   * knowing an exchange happened at all. This function's whole job is
   * to refuse what the counter can already see is wrong, and to send
   * one idempotent call.
   */
  async function processExchange() {
    // Not about scannable barcodes. Counted stock carries an internal
    // key and exchanges perfectly well; this only catches a sold row
    // with no key at all, which the exchange has nothing to work with.
    if (!selectedItem?.barcode) {
      toast({
        title: "Cannot exchange this item",
        description:
          "This sale line has no product key recorded, so there is nothing to take back into stock.",
        variant: "destructive",
      });
      return;
    }
    if (!replacement?.barcode) {
      toast({
        title: "No replacement loaded",
        description: "Scan the handset the customer is taking away.",
        variant: "destructive",
      });
      return;
    }
    if (replacement.barcode === selectedItem.barcode) {
      toast({
        title: "Same item",
        description: "The replacement must be a different unit.",
        variant: "destructive",
      });
      return;
    }
    // The database caps this too — this is so the counter is told
    // before the customer has been promised anything.
    if (returnValue > unitPrice) {
      toast({
        title: "More than they paid",
        description: `The handset was sold for ৳${unitPrice.toFixed(2)}. It cannot be taken back for more.`,
        variant: "destructive",
      });
      return;
    }
    if (priceDifference < 0) {
      toast({
        title: "Cheaper replacement",
        description: "An exchange must be for the same price or higher.",
        variant: "destructive",
      });
      return;
    }

    // Money to collect means the route has to be complete, or it lands
    // in the wrong column on Bank Info and nobody notices for a month.
    if (priceDifference > 0) {
      if (exchangeRoute.method === "bank_transfer" && !exchangeRoute.bankName) {
        toast({
          title: "Choose a bank",
          description: "Select which bank the money came through.",
          variant: "destructive",
        });
        return;
      }
      if (exchangeRoute.method !== "cash" && !exchangeRoute.channel) {
        toast({
          title: "Choose a method",
          description: "Select how the customer paid the difference.",
          variant: "destructive",
        });
        return;
      }

      // The database refuses this too — this is so the cashier finds
      // out before the customer has been handed anything.
      if (changeDue < 0) {
        toast({
          title: "Not enough",
          description: `৳${Math.abs(changeDue).toFixed(2)} short. An exchange must be settled in full.`,
          variant: "destructive",
        });
        return;
      }

      if (changeDue > 0 && !takesChange) {
        toast({
          title: "Check the amount",
          description: `${describeRoute(exchangeRoute)} is sent for an exact amount, so there is no change to give back.`,
          variant: "destructive",
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      const clientTxnId =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      // Only build a payment when there is something to pay. A
      // like-for-like swap costs nothing and must not create a sale.
      // The line is what the shop KEPT, not what was tendered. Day
      // Cashbook sums the method columns and does not subtract change,
      // so putting the tender here would overstate the day's cash by
      // whatever was handed back.
      const lines: PaymentLine[] =
        priceDifference > 0
          ? [{ ...exchangeRoute, amount: priceDifference }]
          : [];

      const payments =
        lines.length > 0
          ? {
              ...toLegacyTotals(lines),
              method: lines[0].channel || lines[0].method || "cash",
              card_bank: firstBankFor(lines, "card"),
              bank_transfer_bank: firstBankFor(lines, "transfer"),
              // What the customer actually handed over, so the sale
              // can work out the change and the receipt can show it.
              received,
              lines: lines.map((l) => ({
                method: l.method,
                bank: l.bankName || null,
                channel: l.channel || null,
                amount: l.amount,
              })),
            }
          : null;

      const { data, error } = await supabase.rpc("process_exchange", {
        p_organization_id: currentShopId,
        p_client_txn_id: clientTxnId,
        p_returned_barcode: selectedItem.barcode,
        p_replacement_barcode: replacement.barcode,
        p_reason: reason || null,
        p_notes: notes || null,
        p_payments: payments,
        // What the shop is allowing for the handset coming back. Null
        // when the box was left blank, which means "full price" and is
        // how every same-day swap behaves. The database caps it at the
        // original price, so this cannot be used to hand out money.
        p_returned_value: returnValueText.trim() === "" ? null : returnValue,
      });

      if (error) throw error;

      // The function reports refusals in its result rather than by
      // raising, so a `data.success` of false is a real failure — not
      // treating it as one would tell the cashier a swap happened that
      // did not.
      if (!data?.success) {
        toast({
          title: "Exchange refused",
          description: data?.message ?? "The exchange could not be recorded.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: data.duplicate ? "Already recorded" : "Exchange completed",
        description:
          priceDifference > 0
            ? `${replacement.name} given out • customer paid ৳${priceDifference.toFixed(2)} by ${describeRoute(exchangeRoute)}${
                changeDue > 0 ? ` • ৳${changeDue.toFixed(2)} change` : ""
              }${data.invoice_number ? ` • ${data.invoice_number}` : ""}`
            : `${replacement.name} given out • no money changed hands`,
      });

      // Money changed hands, so the customer gets an invoice — the same
      // document the till prints, because it IS an ordinary sale. A
      // like-for-like swap has no sale and nothing to invoice.
      if (data.sale_id) {
        const printed = await openPrintableReceipt({
          supabase,
          saleId: Number(data.sale_id),
          organizationId: currentShopId,
          shop: shops.find((s) => s.id === currentShopId),
        });

        if (!printed.ok) {
          toast({
            title: "Invoice did not open",
            description:
              printed.reason === "popup-blocked"
                ? "The exchange is saved — nothing was lost. Print the invoice from the Sales page. If it still will not open, allow pop-ups for this application."
                : "The exchange is saved. Print the invoice from the Sales page.",
            variant: "destructive",
          });
        }
      }

      resetForm();
      onClose?.();
    } catch (err: any) {
      console.error("Process exchange error:", err);
      toast({
        title: "Error",
        description: err?.message ?? "Unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function processReturn(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Validation
    if (!selectedItem) {
      toast({
        title: "No product loaded",
        description: "Load a product first using IMEI.",
        variant: "destructive",
      });
      return;
    }

    // An exchange swaps stock and takes the difference; a refund gives
    // money back. Entirely different work, so they part company here.
    if (!moneyBack) {
      await processExchange();
      return;
    }

    if (!reason || !refundMethod) {
      toast({
        title: "Missing fields",
        description: "Return reason and refund method are required.",
        variant: "destructive",
      });
      return;
    }
    if (quantity <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Quantity must be at least 1.",
        variant: "destructive",
      });
      return;
    }
    if (!returnDate) {
      toast({
        title: "Missing return date",
        description: "Please select a return date.",
        variant: "destructive",
      });
      return;
    }
    if (!customerName.trim()) {
      toast({
        title: "Missing customer name",
        description: "Customer name is required.",
        variant: "destructive",
      });
      return;
    }
    // A refund for more than the customer paid is a mistyped figure,
    // not a decision anyone makes on purpose.
    if (returnValue > unitPrice) {
      toast({
        title: "More than they paid",
        description: `The handset was sold for ৳${unitPrice.toFixed(2)}. It cannot be refunded for more.`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // Calculate total refund
      // What the shop is giving back, which is what the handset is
      // worth today — not what was paid for it however long ago.
      const totalRefund = quantity * returnValue;

      // Create return record
      const { data: returnRecord, error: returnError } = await supabase
        .from("sales_returns")
        .insert({
          original_sale_id: saleInfo?.sale_id || selectedItem.sales_id,
          return_date: returnDate,
          return_reason: reason,
          refund_method: refundMethod,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim() || null,
          notes: notes || null,
          total_refund_amount: totalRefund,
          status: "completed",
          organization_id: currentShopId,
        })
        .select()
        .single();

      if (returnError) throw returnError;

      // Create return item record
      const { error: returnItemError } = await supabase
        .from("sales_return_items")
        .insert({
          return_id: returnRecord.id,
          product_name: productName,
          original_sold_product_id: selectedItem.id,
          quantity: quantity,
          // The rate it was taken back at, so this and the refund
          // agree. What the customer originally paid is still on the
          // sold_products row this points at.
          unit_price: returnValue,
          total_refund_amount: totalRefund,
          condition: "good",
          organization_id: currentShopId,
        });

      if (returnItemError) throw returnItemError;

      // Restock to inventory
      if (selectedItem.barcode) {
        // Check if product exists in inventory
        // inventory has no `id` column — it is keyed by
        // (organization_id, barcode). Asking for `id` made this lookup
        // fail with 42703, and because only `data` was read the error
        // was thrown away: the code concluded the product was missing
        // and tried to INSERT, which then collided with the existing
        // row on inventory_pkey.
        const { data: existingInventory, error: lookupError } = await supabase
          .from("inventory")
          .select("barcode, quantity")
          .eq("organization_id", currentShopId)
          .eq("barcode", selectedItem.barcode)
          .maybeSingle();

        if (lookupError) throw lookupError;

        if (existingInventory) {
          // Update existing inventory
          const { error: updateError } = await supabase
            .from("inventory")
            .update({
              quantity: (existingInventory.quantity ?? 0) + quantity,
              updated_at: new Date().toISOString(),
            })
            .eq("barcode", existingInventory.barcode)
            .eq("organization_id", currentShopId);

          if (updateError) throw updateError;
        } else {
          // Create new inventory record
          const { error: insertError } = await supabase
            .from("inventory")
            .insert({
              barcode: selectedItem.barcode,
              product_name: selectedItem.product_name,
              model_number: selectedItem.model_number,
              color: selectedItem.color,
              quantity: quantity,
              unit_price: unitPrice,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              organization_id: currentShopId,
            });

          if (insertError) throw insertError;
        }
      }

      toast({
        title: "Return processed successfully",
        description: `Refund ৳${totalRefund.toFixed(2)} • Return #${returnRecord.id} • Item added back to inventory`,
      });

      // Full reset for the next return. This previously cleared only
      // the typed fields, leaving the returned handset still loaded —
      // so re-entering a reason and refund method would return the very
      // same item again, refunding twice and restocking twice.
      resetForm();

      // Close the dialog when there is one.
      onClose?.();
    } catch (err: any) {
      console.error("Process return error:", err);
      toast({
        title: "Error",
        description: err?.message ?? "Unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-6 h-[calc(100vh-8rem)] overflow-y-auto pr-1"
      onSubmit={processReturn}
    >
      {/* Customer Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Customer Information</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="imei">IMEI Number</Label>
            <div className="flex gap-2">
              <Input
                id="imei"
                placeholder="Scan or type IMEI, then press Enter"
                value={imeiNumber}
                onChange={(e) => {
                  setImeiNumber(e.target.value);
                  // Fires the lookup once a scanner burst goes quiet, for
                  // scanners that send no trailing Enter.
                  scanner.onChange(e.target.value);
                }}
                onKeyDown={imeiKeyDown}
                ref={lookupRef}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => loadByImei()}
                disabled={loading}
              >
                <Search className="mr-2 h-4 w-4" />
                {loading ? "Loading..." : "Load"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPickingReturned(true)}
                disabled={loading}
                className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900"
              >
                <PackageSearch className="mr-2 h-4 w-4" />
                No barcode
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Scan the IMEI or type it and press Enter. For a cable, cover or
              anything else with nothing to scan, use No barcode.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="customer-name">Customer Name*</Label>
            <Input
              id="customer-name"
              {...flow.field(0)}
              placeholder="Auto-filled from sale record"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="customer-phone">Phone Number</Label>
            <Input
              id="customer-phone"
              {...flow.field(1)}
              placeholder="Auto-filled from sale record"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Product Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Product Information</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="product-name">Product Name*</Label>
            <Input
              id="product-name"
              {...flow.field(2)}
              placeholder="Auto-filled from IMEI lookup"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="model">Model Number</Label>
            <Input
              id="model"
              {...flow.field(3)}
              placeholder="Auto-filled from IMEI lookup"
              value={modelNumber}
              onChange={(e) => setModelNumber(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              {...flow.field(4)}
              placeholder="Auto-filled from IMEI lookup"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="quantity">Quantity*</Label>
            <Input
              id="quantity"
              {...flow.field(QUANTITY_FIELD)}
              type="number"
              min={1}
              max={selectedItem?.quantity || 999}
              value={quantity}
              onChange={(e) =>
                setQuantity(
                  Math.max(
                    1,
                    Math.min(
                      selectedItem?.quantity || 999,
                      Number(e.target.value) || 1,
                    ),
                  ),
                )
              }
              required
            />
            {selectedItem && (
              <p className="text-xs text-gray-500 mt-1">
                Max available: {selectedItem.quantity}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="unit-price">Unit Price*</Label>
            <Input
              id="unit-price"
              {...flow.field(6)}
              type="number"
              value={unitPrice || ""}
              onChange={(e) => setUnitPrice(Number(e.target.value) || 0)}
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              What the customer paid
            </p>
          </div>
        </div>

        {/* Left blank on purpose. A handset brought back weeks later is
            not worth what was paid for it, and only the shop can say
            what it is worth now — so nothing is filled in and nothing
            is assumed. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="return-value">Return Value (per unit)</Label>
            <Input
              id="return-value"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder={`Leave blank for full price (৳${unitPrice.toFixed(2)})`}
              value={returnValueText}
              onChange={(e) => setReturnValueText(e.target.value)}
              className={returnValue > unitPrice ? "border-destructive" : ""}
            />
            {returnValue > unitPrice ? (
              <p className="mt-1 text-xs text-destructive">
                More than the ৳{unitPrice.toFixed(2)} they paid. It cannot be
                taken back for more than it was sold for.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {valueReduced
                  ? `Taken back at ৳${returnValue.toFixed(2)} — ৳${(
                      unitPrice - returnValue
                    ).toFixed(2)} less than paid.`
                  : "What it is worth today. Blank means no reduction."}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="total-amount">Total Amount</Label>
            <Input
              id="total-amount"
              type="number"
              value={totalAmount}
              readOnly
              className="bg-gray-50"
            />
          </div>
        </div>
      </div>

      {/* Exchange is the normal path. A customer bringing something
          back walks out with another handset; money back is the
          exception and has to be asked for. */}
      {selectedItem && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">
              {moneyBack ? "Refund" : "Exchange For"}
            </h3>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                id="money-back"
                checked={moneyBack}
                onCheckedChange={(v) => {
                  setMoneyBack(v === true);
                  // The two paths do not share fields, and a
                  // replacement left selected while refunding would be
                  // taken out of stock for nothing.
                  setReplacementBarcode("");
                  setReplacement(null);
                  setExchangeRoute(EMPTY_ROUTE);
                }}
              />
              <span className="text-sm font-medium">
                Give money back instead
              </span>
            </label>
          </div>

          {!moneyBack && (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="replacement-barcode">
                    Replacement barcode*
                  </Label>
                  <Input
                    id="replacement-barcode"
                    placeholder="Scan the handset the customer is taking"
                    value={replacementBarcode}
                    onChange={(e) => setReplacementBarcode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      loadReplacement(replacementBarcode);
                    }}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => loadReplacement(replacementBarcode)}
                    disabled={!replacementBarcode.trim() || loadingReplacement}
                  >
                    {loadingReplacement ? "Loading…" : "Load"}
                  </Button>
                  {/* The customer can walk out with a cable just as
                      easily as with a handset. */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPickingReplacement(true)}
                    disabled={loadingReplacement}
                    className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900"
                  >
                    <PackageSearch className="mr-2 h-4 w-4" />
                    No barcode
                  </Button>
                </div>
              </div>

              {replacement && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{replacement.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[replacement.variant, replacement.color]
                          .filter(Boolean)
                          .join(" ·") || "—"}
                        {` · ${replacement.available_quantity ?? 0} in stock`}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold">
                      ৳{Number(replacement.price ?? 0).toFixed(2)}
                    </p>
                  </div>

                  <div className="space-y-1 border-t pt-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Returned item
                      </span>
                      <span>৳{returnValue.toFixed(2)}</span>
                    </div>
                    {/* Both parts, itemised. Shown only when there is
                        a reduction, so an ordinary same-day swap reads
                        exactly as it did before — and when there is
                        one, whoever is at the counter can say where
                        every taka of the total came from. */}
                    {reduction > 0 && (
                      <>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Swap difference</span>
                          <span>
                            ৳
                            {(
                              Number(replacement.price ?? 0) - returnValue
                            ).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Reduction in value (sold at ৳{unitPrice.toFixed(2)})</span>
                          <span>+ ৳{reduction.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between font-medium">
                      <span>Customer pays</span>
                      <span
                        className={
                          priceDifference < 0
                            ? "text-destructive"
                            : "text-green-600"
                        }
                      >
                        ৳{priceDifference.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {priceDifference < 0 && (
                    <p className="text-xs text-destructive">
                      The replacement is cheaper than the returned item. An
                      exchange must be for the same price or more.
                    </p>
                  )}
                </div>
              )}

              {/* Only when there is something to collect. Same picker as
                  the till, so the money lands on the right bank line. */}
              {replacement && priceDifference > 0 && (
                <>
                  <PaymentRoute
                    idPrefix="exchange"
                    value={exchangeRoute}
                    methods={payMethods}
                    reloadMethods={reloadPayMethods}
                    onChange={setExchangeRoute}
                  />

                  {/* What was handed over, and what goes back. Left
                      empty it means the exact difference, so an
                      exchange settled precisely needs no typing. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="exchange-received">Amount received</Label>
                      <Input
                        id="exchange-received"
                        inputMode="decimal"
                        placeholder={priceDifference.toFixed(2)}
                        value={receivedText}
                        onChange={(e) => setReceivedText(e.target.value)}
                        className={changeDue < 0 ? "border-destructive" : ""}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Change to give</Label>
                      <div
                        className={`flex h-10 items-center justify-end rounded-md px-3 text-sm font-semibold tabular-nums ${
                          changeDue > 0
                            ? "bg-amber-100 text-amber-900"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        ৳{Math.max(0, changeDue).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {changeDue < 0 && (
                    <p className="text-xs text-destructive">
                      ৳{Math.abs(changeDue).toFixed(2)} short. An exchange must
                      be settled in full.
                    </p>
                  )}

                  {changeDue > 0 && !takesChange && (
                    <p className="text-xs text-destructive">
                      {describeRoute(exchangeRoute)} is sent for an exact
                      amount — there is no change to give back.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Return Details */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Return Details</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="return-reason">Return Reason*</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="defective">Defective Product</SelectItem>
                <SelectItem value="wrong_item">Wrong Item</SelectItem>
                <SelectItem value="not_satisfied">
                  Customer Not Satisfied
                </SelectItem>
                <SelectItem value="damaged">Damaged in Transit</SelectItem>
                <SelectItem value="warranty_claim">Warranty Claim</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="return-date">Return Date*</Label>
            <Input
              id="return-date"
              {...flow.field(7)}
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Defaults to today, can be changed if needed
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            {...flow.field(8)}
            placeholder="Additional notes about the return (optional)"
            className="h-20"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Only when money is actually going back. On an exchange there
          is nothing to refund, and a required"Refund Method*" sitting
          there is a field the cashier cannot satisfy. */}
      {moneyBack && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Refund Information</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="refund-method">Refund Method*</Label>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select refund method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Credit/Debit Card</SelectItem>
                  <SelectItem value="mobile_banking">
                    Mobile Banking (bKash/Nagad)
                  </SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="store_credit">Store Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="refund-amount">Refund Amount*</Label>
              <Input
                id="refund-amount"
                type="number"
                value={totalAmount}
                readOnly
                className="bg-gray-50"
              />
            </div>
          </div>
        </div>
      )}

      {/* Form Actions */}
      <div className="flex justify-end space-x-2 pt-4 sticky bottom-0 bg-card/80 backdrop-blur border-t">
        {/* Clears the form's own state. This used to reload the whole
            page, which inside a dialog tore down the entire app —
            re-authenticating, re-fetching every screen, and discarding
            anything else in progress — just to blank a few inputs. */}
        <Button
          type="button"
          variant="outline"
          onClick={resetForm}
          disabled={submitting}
        >
          <X className="mr-2 h-4 w-4" />
          Reset Form
        </Button>
        <Button type="submit" disabled={submitting || !selectedItem}>
          <Save className="mr-2 h-4 w-4" />
          {submitting
            ? "Processing..."
            : moneyBack
              ? "Process Refund"
              : "Process Exchange"}
        </Button>
      </div>

      {/* Both pickers only produce what the scan path already expects:
          the sold line to bring back, and the internal key of the
          replacement. Nothing downstream knows the difference, which is
          what makes a cable return exactly like a handset return. */}
      <NoBarcodePicker
        open={pickingReturned}
        onOpenChange={setPickingReturned}
        source="sold"
        title="Return something without a barcode"
        description="Search what has been sold, then pick the line the customer is bringing back."
        onPick={(row) => loadPickedSoldItem(row.id)}
      />

      <NoBarcodePicker
        open={pickingReplacement}
        onOpenChange={setPickingReplacement}
        source="inventory"
        title="Give something without a barcode"
        description="Search what is in stock, then pick what the customer is taking instead."
        onPick={(row) => {
          setReplacementBarcode(row.barcode);
          loadReplacement(row.barcode);
        }}
      />
    </form>
  );
}
