"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Calculator,
  CreditCard,
  Receipt,
  QrCode,
  PauseCircle,
  Wallet,
  Store,
  X,
  User,
  Trash2,
  Plus,
  Minus,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { POSCalculator } from "@/components/pos-calculator";
import {
  isMissingPromoVariant,
  PROMO_COLUMNS,
  PROMO_COLUMNS_WITHOUT_VARIANT,
  promoForItem,
  promoLabel,
  round2,
  type SupplierPromo,
} from "@/lib/promo";
import { shopToday } from "@/lib/shop-date";
import { CustomerSearch } from "@/components/customer-search";
import { ProductScanner } from "@/components/product-scanner";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
import { useSubscription } from "@/components/subscription-provider";
import { useBarcodeScanner, useHotkeys } from "@/hooks/use-keyboard-flow";
import { clearDrafts, useDraft } from "@/hooks/use-draft";
import { BANK_ACCOUNTS } from "@/lib/utils/bank-accounts";
import { ShopTransferDialog } from "@/components/shop-transfer-dialog";
import { openPrintableReceipt as printReceiptDocument } from "@/lib/receipt";
import {
  PaymentRoute,
  usePaymentMethods,
  ADDED_ROUTE,
  leftToPay,
  revealNewPaymentLine,
  paymentLineTint,
  EMPTY_ROUTE,
  toLegacyTotals,
  firstBankFor,
  type PaymentRouteValue,
  type PaymentLine,
} from "@/components/payment-route";

// supabase-js reports an unreachable server as an ordinary error rather
// than throwing, so the message text is all there is to go on. Getting
// this wrong in either direction is costly: treat a real refusal as an
// outage and the sale is queued when it should have been shown to the
// cashier; treat an outage as a refusal and a paid-for sale is thrown
// away. Match only on transport-level wording, never on anything the
// database itself would say.
const looksLikeNetworkFailure = (message?: string) =>
  !!message &&
  /fetch failed|failed to fetch|networkerror|network request failed|load failed|econnrefused|enotfound|etimedout|ehostunreach|socket hang up/i.test(
    message,
  );

// How far back a sale may be dated. The shop sells on days it is
// closed and those get entered the next morning, but only within this
// window — the owner's rule. Offered as three fixed choices rather
// than a calendar, so there is no such thing as typing a date that is
// then refused.
const BACKDATE_DAYS = 3;

// The shop's own calendar day, not UTC. toISOString() would put a sale
// rung up after 6pm in Dhaka on the following date, which is exactly
// the mistake this feature exists to prevent.
const localDateString = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const todayLocal = () => localDateString(new Date());

/**
 * The days a sale can be backdated to: yesterday, the day before, and
 * the day before that.
 *
 * Today is deliberately absent — it is what the unticked checkbox
 * already means, and offering it twice invites the cashier to pick the
 * wrong one.
 */
const previousDateChoices = () => {
  const out: { value: string; label: string; weekday: string }[] = [];

  for (let back = 1; back <= BACKDATE_DAYS; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    out.push({
      value: localDateString(d),
      label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      weekday:
        back === 1
          ? "Yesterday"
          : d.toLocaleDateString("en-GB", { weekday: "long" }),
    });
  }

  return out;
};

type CartItem = {
  id: string;
  name: string;
  model: string;
  // RAM/ROM configuration — 4/64, 6/128. Carried through the cart onto
  // the receipt, so the customer has a record of exactly which
  // configuration they bought.
  variant: string;
  color: string;
  quantity: number;
  price: number;
  discount: number;
  /** Given away free. Amount is already 0 via discount == price; this
      is what tells the printed invoice to treat the row as a footnote
      rather than a markdown — see the note above the invoice totals. */
  isGift: boolean;
  /** The supplier promo this line was sold on, if the cashier ticked
      one. promoAmount is PART OF `discount`, not on top of it: the
      customer sees one price off, and this says how much of it the
      supplier owes back. */
  promoId?: number;
  promoAmount?: number;
  promoLabel?: string;
  barcode: string;
  cost_price?: number;
};

type Customer = {
  id?: number;
  name: string;
  phone: string;
  email: string;
  dues: number;
};

type ProductResponse = {
  success: boolean;
  barcode?: string;
  name?: string;
  model?: string;
  variant?: string;
  color?: string;
  no_barcode?: boolean;
  /** Came back on an exchange. Still sellable — the cashier is told. */
  defective?: boolean;
  price?: number;
  available_quantity?: number;
  category?: string;
  brand?: string;
  message?: string;
};

export function POSClient() {
  const supabase = createClient();
  const { toast } = useToast();
  const { currentShopId, shops } = useRole();
  const { canWrite } = useSubscription();

  // The half-rung sale, kept if the cashier walks off to another
  // screen. Checking a price in Inventory used to cost the whole cart;
  // see hooks/use-draft.ts for what keeps that safe.
  const [cartItems, setCartItems, clearCartDraft] = useDraft<CartItem[]>(
    "pos.cart",
    [],
    currentShopId,
  );
  const [customer, setCustomer, clearCustomerDraft] = useDraft<Customer | null>(
    "pos.customer",
    null,
    currentShopId,
  );

  // NOT drafted. These name a row the database has already opened for
  // this sale; restoring them from storage could attach the next
  // customer's cart to a sale that has since been completed or
  // cancelled elsewhere.
  const [currentSaleId, setCurrentSaleId] = useState<number | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);

  // ---- The day the sale actually happened
  //
  // Off by default: an ordinary sale is today's, and nothing about it
  // changes. Ticked, the cashier picks one of the last three days —
  // that is the date the sale lands on in the Day Cashbook, not the
  // day it was typed in.
  const [useBackdate, setUseBackdate] = useDraft<boolean>(
    "pos.useBackdate",
    false,
    currentShopId,
  );
  const [backdateChoice, setBackdateChoice] = useDraft<string | null>(
    "pos.backdateChoice",
    null,
    currentShopId,
  );

  // Rebuilt on each render so a till left running overnight offers
  // yesterday's real yesterday, not the one it started with.
  const dateChoices = previousDateChoices();
  const saleDate = useBackdate ? backdateChoice : todayLocal();

  // Asking before booking an entire sale as debt. The ref carries the
  // cashier's answer across the second call to completeSale, where a
  // state flag would still be reading its previous value.
  // Accessories are found by name, not scanned.
  const [posNoBarcode, setPosNoBarcode] = useState(false);

  type NameSuggestion = {
    barcode: string;
    product_name: string;
    color: string | null;
    variant: string | null;
    model_number: string | null;
    sale_price: number | null;
    quantity: number;
    no_barcode: boolean;
    /** Script 104. Absent on an older database -- treated as blank. */
    brand?: string | null;
    supplier?: string | null;
    /**
     * Every delivery of this product with stock, fullest first, and
     * what they add up to. Set when the list is built; a sale bigger
     * than one delivery is taken from the next ones.
     */
    batches?: { barcode: string; quantity: number }[];
    total?: number;
  };
  const [nameHits, setNameHits] = useState<NameSuggestion[]>([]);
  const [showNameHits, setShowNameHits] = useState(false);
  /**
   * The name a suggestion just filled in. Filling the box looks like
   * typing to the search below, which ran again and opened the list a
   * second time over the product already chosen.
   */
  const chosenNameRef = useRef<string | null>(null);
  const [nameHighlight, setNameHighlight] = useState(0);
  const [showZeroPaymentConfirm, setShowZeroPaymentConfirm] = useState(false);
  const zeroPaymentAckRef = useRef(false);

  // ---- Dues: which PURCHASE is unpaid, and taking payment against it
  //
  // Per purchase, not per customer. A customer with two handsets on
  // credit has two debts, and the shop — and the customer's receipt —
  // needs to say which one the money paid off.
  type DuePurchase = {
    saleId: number;
    invoiceNumber: string | null;
    saleDate: string;
    customerId: number;
    name: string;
    phone_number: string | null;
    total: number;
    outstanding: number;
    items: Array<{
      product_name: string;
      variant: string | null;
      color: string | null;
      quantity: number;
      unit_price: number;
    }>;
  };
  const [showDues, setShowDues] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [duesList, setDuesList] = useState<DuePurchase[]>([]);
  const [duesLoading, setDuesLoading] = useState(false);
  const [duesSearch, setDuesSearch] = useState("");
  const [duePayee, setDuePayee] = useState<DuePurchase | null>(null);
  const [duePaying, setDuePaying] = useState(false);

  const [dueSingle, setDueSingle] = useState("");
  const [dueRoute, setDueRoute] = useState<PaymentRouteValue>(EMPTY_ROUTE);
  const [dueLines, setDueLines] = useState<PaymentLine[]>([]);

  /**
   * The lines as they will be stored, whichever way they were entered.
   *
   * Both entry styles collapse to one shape, so the payload sent to the
   * database and the running total on screen are computed from the same
   * place — they cannot disagree.
   */
  const duePaymentLines: PaymentLine[] =
    dueRoute.method === "split"
      ? dueLines.filter((l) => (Number(l.amount) || 0) > 0)
      : (Number(dueSingle) || 0) > 0
        ? [{ ...dueRoute, amount: Number(dueSingle) }]
        : [];

  const dueEntered = duePaymentLines.reduce(
    (sum, l) => sum + (Number(l.amount) || 0),
    0,
  );

  const [productForm, setProductForm] = useDraft(
    "pos.productForm",
    {
    barcode: "",
    name: "",
    model: "",
    variant: "",
    color: "",
    // Carried only so a supplier promo can be matched to the handset;
    // the sale itself reads the brand off the stock row.
    brand: "",
    quantity: 1,
    price: 0,
    discount: 0,
    isGift: false,
    /** Whether the cashier ticked the promo offered for this item. */
    promoOn: false,
    },
    currentShopId,
  );

  // ---- Supplier promos
  //
  // A supplier funds a discount on one model and pays the shop back
  // later. The promos are few and change rarely, so they are read
  // once per shop and matched in the till rather than asked for on
  // every scan — a lookup between scanning and adding would be felt
  // at the counter.
  //
  // A shop whose database has not run script 98 has no table here.
  // That is not an error worth showing anyone: it means no promos,
  // the tick never appears, and every other part of the till carries
  // on exactly as before.
  const [promos, setPromos] = useState<SupplierPromo[]>([]);

  useEffect(() => {
    if (!currentShopId) {
      setPromos([]);
      return;
    }
    let cancelled = false;

    const read = async () => {
      const query = (columns: string) =>
        supabase
          .from("supplier_promos")
          .select(columns)
          .eq("organization_id", currentShopId)
          .is("deleted_at", null);

      let { data, error } = await query(PROMO_COLUMNS);
      // Before script 100 there is no variant column. Asking again
      // without it keeps every promo on the till, covering every
      // variant as it always did, rather than offering none.
      if (isMissingPromoVariant(error)) {
        ({ data, error } = await query(PROMO_COLUMNS_WITHOUT_VARIANT));
      }
      if (cancelled) return;
      setPromos(error ? [] : ((data ?? []) as unknown as SupplierPromo[]));
    };

    read();

    // A promo is set up on the Purchases page, often in another window
    // while the till sits open. Read once on mount and the cashier is
    // told there is no promo on a handset that has one — so the list
    // is refreshed whenever the till comes back to the front.
    const refresh = () => {
      if (document.visibilityState === "visible") read();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [currentShopId, supabase]);

  /**
   * The promo on offer for whatever is in the form, today.
   *
   * Never on a gift: a giveaway has no price for the discount to come
   * off, and claiming a promo for one would be asking the supplier to
   * fund a handset the customer was not charged for.
   */
  const offeredPromo = useMemo(() => {
    if (productForm.isGift) return null;
    if (!productForm.name) return null;
    return promoForItem(promos, productForm, shopToday());
  }, [
    promos,
    productForm.name,
    productForm.model,
    productForm.variant,
    productForm.brand,
    productForm.isGift,
  ]);

  /** What the ticked promo takes off each unit, in taka. */
  const promoOffPerUnit =
    offeredPromo && productForm.promoOn ? Number(offeredPromo.amount) || 0 : 0;

  // A promo the item no longer qualifies for must not stay ticked:
  // the cashier changes the model in the form, or ticks Gift, and the
  // 200 would otherwise still be coming off a handset nobody is
  // funding.
  useEffect(() => {
    if (!offeredPromo && productForm.promoOn) {
      setProductForm((prev) => ({ ...prev, promoOn: false }));
    }
  }, [offeredPromo, productForm.promoOn]);

  /**
   * The Sale Price box keeps its own text.
   *
   * Bound straight to the number it could not hold a zero: `0 || ""`
   * is `""`, so typing 0 emptied the box and the price sprang back to
   * the auto-filled figure. A half-typed `0.` did the same, which made
   * `12.50` a fight. The manager could auto-fill a price but never
   * actually set one.
   *
   * The number is still what the sale uses; this is only what the box
   * shows while it is being typed into.
   */
  const [priceText, setPriceText] = useDraft<string>(
    "pos.priceText",
    "",
    currentShopId,
  );

  // Re-synced when a product is loaded, or the form is cleared. Syncing
  // on the price itself would overwrite the text mid-keystroke, since
  // typing sets the price too.
  //
  // The barcode alone is not enough: it is typed into its box BEFORE
  // Load is pressed, so loading fills in the same barcode, nothing
  // changes, and the box stayed empty over a price that had loaded. So
  // every load also bumps this.
  const [productLoads, setProductLoads] = useState(0);
  useEffect(() => {
    setPriceText(productForm.price ? String(productForm.price) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productForm.barcode, productLoads]);

  // Keeps the discount equal to the price for as long as Gift is
  // ticked, so an item stays free even if the price is corrected
  // afterwards. Off does nothing here — the manager is back to typing
  // an ordinary discount, and this effect has no business touching it.
  useEffect(() => {
    if (!productForm.isGift) return;
    if (productForm.discount === productForm.price) return;
    setProductForm((prev) => ({ ...prev, discount: prev.price }));
  }, [productForm.isGift, productForm.price, productForm.discount]);

  const [paymentForm, setPaymentForm] = useState({
    method: "",
    cashReceived: 0,
    cardReceived: 0,
    bkashReceived: 0,
    nagadReceived: 0,
    rocketReceived: 0,
    upayReceived: 0,
    bankTransferReceived: 0,
    due: 0,
    cardBank: "",
    bankTransferBank: "",
    mobileBankingMethod: "",
  });

  const [showCalculator, setShowCalculator] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);

  // ---- The customer being typed in
  //
  // Controlled, so a match can fill all three boxes at once. They used
  // to be read straight off the DOM by id, which works for saving but
  // gives nothing to fill.
  const [custName, setCustName] = useDraft("pos.custName", "", currentShopId);
  const [custPhone, setCustPhone] = useDraft("pos.custPhone", "", currentShopId);
  const [custEmail, setCustEmail] = useDraft("pos.custEmail", "", currentShopId);

  // ---- Finding an existing customer while typing
  //
  // The shop's regulars come back, and asking the cashier to open a
  // dialog and type the name a second time is the hassle. Typing two
  // characters into either box now offers the matches underneath it.
  type CustomerHit = {
    id: number;
    name: string;
    phone_number: string | null;
    email: string | null;
    dues: number | null;
  };
  const [custHits, setCustHits] = useState<CustomerHit[]>([]);
  const [custHitsFor, setCustHitsFor] = useState<"name" | "phone" | null>(null);
  const [custLooking, setCustLooking] = useState(false);
  // newSale() clears currentSaleId, so the just-finished sale is kept
  // separately — otherwise"Last Receipt" is dead right after a sale,
  // which is exactly when a cashier reaches for it.
  const [lastCompletedSaleId, setLastCompletedSaleId] = useState<number | null>(
    null,
  );
  const [heldSales, setHeldSales] = useState<any[]>([]);
  const [showHeldSales, setShowHeldSales] = useState(false);

  const loadHeldSales = async () => {
    if (!currentShopId) return;
    const { data } = await supabase
      .from("sales")
      .select(
        "id, invoice_number, total_amount, held_at, held_cart, sale_customers(customer_id, customer_name, customer_phone, customer_email)",
      )
      .eq("organization_id", currentShopId)
      .eq("status", "held")
      .order("held_at", { ascending: true });
    setHeldSales(data ?? []);
  };

  // Put a parked basket back on screen. The sale row is reused, so the
  // invoice number the customer may already have been quoted stays the
  // same.
  const resumeHeldSale = async (sale: any) => {
    const items: CartItem[] = Array.isArray(sale.held_cart)
      ? sale.held_cart
      : [];
    if (items.length === 0) {
      toast({
        title: "Nothing to resume",
        description: "This held sale has no items.",
        variant: "destructive",
      });
      return;
    }

    const sc = Array.isArray(sale.sale_customers)
      ? sale.sale_customers[0]
      : sale.sale_customers;
    if (sc?.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("id, name, phone_number, email, dues")
        .eq("id", sc.customer_id)
        .eq("organization_id", currentShopId)
        .maybeSingle();
      if (c) {
        setCustomer({
          id: c.id,
          name: c.name,
          phone: c.phone_number ?? "",
          email: c.email ?? "",
          dues: c.dues ?? 0,
        } as Customer);
        // And the boxes, so a resumed sale looks the way it did when
        // it was parked.
        setCustName(c.name ?? "");
        setCustPhone(c.phone_number ?? "");
        setCustEmail(c.email ?? "");
      }
    }

    setCartItems(items);
    setCurrentSaleId(sale.id);
    setInvoiceNumber(sale.invoice_number ?? null);

    // Back to in-progress so it stops showing in the held list.
    await supabase
      .from("sales")
      .update({ status: "in_progress", held_cart: null, held_at: null })
      .eq("id", sale.id)
      .eq("organization_id", currentShopId);

    setShowHeldSales(false);
    loadHeldSales();
    toast({
      title: "Sale Resumed",
      description: `${items.length} item(s) restored.`,
    });
  };

  // ---- Settling an outstanding balance
  //
  // A customer who owes money must be able to just pay, without buying
  // anything — completeSale refuses an empty cart, so previously the
  // only way to clear a balance was to sell them something else.
  //
  // Accounting note: collecting a receivable is NOT revenue. The goods
  // were already booked as revenue on the original sale. So this writes
  // total_amount = 0 (nothing added to sales figures) while recording
  // the cash actually taken, which is what the cashbook needs.

  /** Every purchase still owing something, oldest first. */
  const loadDues = async () => {
    if (!currentShopId) return;
    setDuesLoading(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .select(
          `id, invoice_number, sale_date, net_amount, total_amount, previous_dues,
           credit_amount, due_settled,
           sale_customers ( customer_id, customer_name, customer_phone ),
           sold_products ( product_name, variant, color, quantity, unit_price )`,
        )
        .eq("organization_id", currentShopId)
        .eq("status", "completed")
        .gt("credit_amount", 0)
        .order("sale_date", { ascending: true });
      if (error) throw error;

      // PostgREST cannot filter on one column minus another, so the
      // fully-paid purchases are dropped here. Oldest first, because
      // that is the order a shop chases an account.
      const rows: DuePurchase[] = (data ?? [])
        .map((s: any) => {
          const sc = Array.isArray(s.sale_customers)
            ? s.sale_customers[0]
            : s.sale_customers;
          return {
            saleId: s.id,
            invoiceNumber: s.invoice_number ?? null,
            saleDate: s.sale_date ?? "",
            customerId: sc?.customer_id ?? 0,
            name: sc?.customer_name ?? "Walk-in",
            phone_number: sc?.customer_phone ?? null,
            // What the goods came to. Not total_amount, which includes
            // any older balance carried onto that sale and would show a
            // 5,000 handset as a 25,000 purchase. Older rows predate
            // net_amount, hence the fallback — the same one the
            // database uses.
            total:
              Number(s.net_amount ?? 0) > 0
                ? Number(s.net_amount)
                : Math.max(
                    0,
                    Number(s.total_amount ?? 0) - Number(s.previous_dues ?? 0),
                  ),
            outstanding: Number(
              (
                Number(s.credit_amount ?? 0) - Number(s.due_settled ?? 0)
              ).toFixed(2),
            ),
            items: Array.isArray(s.sold_products) ? s.sold_products : [],
          };
        })
        // No customer means no account to credit, and the database
        // refuses it — so it must not be offered at the counter.
        .filter((r) => r.outstanding > 0.001 && r.customerId);

      setDuesList(rows);
    } catch (e: any) {
      toast({
        title: "Couldn't load dues",
        description:
          e?.message ?? "The list of outstanding balances could not be loaded.",
        variant: "destructive",
      });
    } finally {
      setDuesLoading(false);
    }
  };

  const resetDuePaymentEntry = () => {
    setDueRoute(EMPTY_ROUTE);
    setDueSingle("");
    setDueLines([]);
  };

  const openDues = () => {
    setDuePayee(null);
    resetDuePaymentEntry();
    setDuesSearch("");
    setShowDues(true);
    loadDues();
  };

  const selectPayee = (c: DuePurchase) => {
    setDuePayee(c);
    // Deliberately left blank rather than pre-filled with the balance.
    // A pre-filled figure is one Enter away from recording a full
    // settlement when the customer handed over part of it, and the
    // balance is shown right beside the box anyway.
    resetDuePaymentEntry();
  };

  /**
   * Take a payment against an outstanding balance.
   *
   * Goes through settle_sale_due, which applies the money to the named
   * purchase AND to the account in one transaction under row locks. The
   * browser no longer reads the balance, subtracts, and writes it back
   * — two tills doing that at once would credit the customer twice for
   * a single payment.
   */
  const recordDuePayment = async () => {
    if (!duePayee || !currentShopId) return;

    const owed = Number(duePayee.outstanding ?? 0);
    // Rounded because the split is summed from free-text inputs, and
    // 100.1 + 200.2 in floating point is 300.29999999999995 — which the
    // database would reject as not adding up.
    const amount = Number(dueEntered.toFixed(2));

    if (!Number.isFinite(amount) || amount <= 0) {
      toast({
        title: "Enter an amount",
        description:
          "Enter how much is being paid, against at least one method.",
        variant: "destructive",
      });
      return;
    }
    if (amount > owed) {
      toast({
        title: "Amount too high",
        description: `${duePayee.invoiceNumber ?? "This purchase"} has ৳${owed.toFixed(
          2,
        )} left on it, but ৳${amount.toFixed(2)} has been entered.`,
        variant: "destructive",
      });
      return;
    }
    // Every line must say where the money went. Checked per line
    // because on a split one can be complete while another is missing
    // its bank, and only the lines know which.
    const incompleteDue = duePaymentLines.find((line) => {
      if (line.method === "bank_transfer")
        return !line.bankName || !line.channel;
      if (line.method === "mobile_banking") return !line.channel;
      return false;
    });

    if (incompleteDue) {
      toast({
        title: "Payment details incomplete",
        description:
          incompleteDue.method === "bank_transfer"
            ? "Choose the bank and the method used for the bank payment."
            : "Choose which mobile banking service was used.",
        variant: "destructive",
      });
      return;
    }

    setDuePaying(true);
    try {
      const clientTxnId =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      // Both shapes, exactly as at checkout: the lines are the
      // truthful record, the folded totals keep the existing reports
      // working until each one reads the lines instead.
      const payments: Record<string, unknown> = {
        ...toLegacyTotals(duePaymentLines),
        method:
          duePaymentLines.length > 1
            ? "split"
            : duePaymentLines[0]?.channel ||
              duePaymentLines[0]?.method ||
              "cash",
        card_bank: firstBankFor(duePaymentLines, "card"),
        bank_transfer_bank: firstBankFor(duePaymentLines, "transfer"),
        lines: duePaymentLines.map((l) => ({
          method: l.method,
          bank: l.bankName || null,
          channel: l.channel || null,
          amount: l.amount,
        })),
      };

      const { data, error } = await supabase.rpc("settle_sale_due", {
        p_organization_id: currentShopId,
        p_client_txn_id: clientTxnId,
        p_sales_id: duePayee.saleId,
        p_amount: amount,
        p_payments: payments,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) {
        toast({
          title: "Payment not recorded",
          description: data?.message ?? "The payment could not be recorded.",
          variant: "destructive",
        });
        return;
      }

      // Two figures now, and they mean different things: what is left
      // on this purchase, and what the customer still owes overall.
      const remaining = Number(data.remaining ?? 0);
      const purchaseLeft = Number(data.purchase_remaining ?? 0);
      const which = duePayee.invoiceNumber ?? `#${duePayee.saleId}`;

      toast({
        title: "Payment recorded",
        description:
          purchaseLeft > 0
            ? `৳${amount.toFixed(2)} from ${duePayee.name} against ${which} • ৳${purchaseLeft.toFixed(
                2,
              )} left on it, ৳${remaining.toFixed(2)} on their account`
            : `${which} paid in full • ${
                remaining > 0
                  ? `৳${remaining.toFixed(2)} still on their account`
                  : "nothing left owing"
              }`,
      });

      // If this is the customer on the current sale, keep the screen in
      // step so the previous-dues line is not stale.
      if (customer?.id === duePayee.customerId) {
        setCustomer({ ...customer, dues: remaining });
      }

      setLastCompletedSaleId(data.sale_id as number);
      await openPrintableReceipt(data.sale_id as number);

      // Back to the list, fully cleared, so the next payment cannot
      // inherit amounts from this one.
      setDuePayee(null);
      resetDuePaymentEntry();
      await loadDues();
    } catch (e: any) {
      toast({
        title: "Payment failed",
        description: e?.message ?? "Could not record the payment.",
        variant: "destructive",
      });
    } finally {
      setDuePaying(false);
    }
  };

  const discardHeldSale = async (sale: any) => {
    const { error } = await supabase
      .from("sales")
      .update({ status: "cancelled", held_cart: null, held_at: null })
      .eq("id", sale.id)
      .eq("organization_id", currentShopId);
    if (error) {
      toast({
        title: "Couldn't discard",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    loadHeldSales();
    toast({ title: "Held sale discarded" });
  };
  const [showScanner, setShowScanner] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Sample bank accounts - in a real app, these would come from a database
  // Shared with Expenses, Income and the Dues panel, so a payment
  // recorded here can be reconciled against one recorded there.
  const bankAccounts = BANK_ACCOUNTS;

  // ---- How this sale was paid
  //
  // A single route with one amount, or — when the route is"split" — a
  // list of lines each with its own bank, method and amount.
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods();
  const [payRoute, setPayRoute] = useState<PaymentRouteValue>(EMPTY_ROUTE);
  const [payAmount, setPayAmount] = useState(0);
  const [payLines, setPayLines] = useState<PaymentLine[]>([]);

  /** The lines as they will be stored, whichever way they were entered. */
  const paymentLines: PaymentLine[] =
    payRoute.method === "split"
      ? payLines.filter((l) => (Number(l.amount) || 0) > 0)
      : payAmount > 0
        ? [{ ...payRoute, amount: payAmount }]
        : [];

  const resetPayment = () => {
    setPayRoute(EMPTY_ROUTE);
    setPayAmount(0);
    setPayLines([]);
  };

  const saleStarted = currentSaleId != null;

  // Totals with improved due logic
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.quantity * item.price,
    0,
  );
  const totalDiscount = cartItems.reduce(
    (sum, item) => sum + item.quantity * item.discount,
    0,
  );
  const netAmount = subtotal - totalDiscount;
  // How much of that discount the suppliers are funding. Part of the
  // figure above, not another deduction — shown so the cashier knows
  // what the shop will be claiming back on this sale.
  const promoTotal = cartItems.reduce(
    (sum, item) => sum + item.quantity * (item.promoAmount || 0),
    0,
  );
  const previousDues = customer?.dues || 0;
  const total = netAmount + previousDues;

  // Summed from the payment lines, so a split adds up to exactly what
  // was entered rather than to whatever the old per-method boxes still
  // happened to hold.
  const totalReceived = paymentLines.reduce(
    (sum, line) => sum + (Number(line.amount) || 0),
    0,
  );

  // Updated due calculation logic
  const totalPaid = totalReceived + paymentForm.due;
  const change = totalPaid > total ? totalPaid - total : 0;
  const remainingDue = Math.max(0, total - totalReceived);
  const newDuesForCustomer = remainingDue > 0 ? remainingDue : 0;

  // Check if payment method requires bank selection
  const requiresBankSelection = () => {
    return (
      paymentForm.method === "card" || paymentForm.method === "bank-transfer"
    );
  };

  // Check if payment method should show amount input immediately
  const showsAmountImmediately = () => {
    return ["cash", "mobile-banking"].includes(paymentForm.method);
  };

  // Handle payment method change
  const handlePaymentMethodChange = (method: string) => {
    setPaymentForm({
      ...paymentForm,
      method,
      cashReceived: 0,
      cardReceived: 0,
      bkashReceived: 0,
      nagadReceived: 0,
      rocketReceived: 0,
      upayReceived: 0,
      bankTransferReceived: 0,
      due: 0,
      cardBank: "",
      bankTransferBank: "",
      mobileBankingMethod: "",
    });
  };

  // Handle payment amount changes with auto-calculation
  const handlePaymentChange = (
    field: keyof typeof paymentForm,
    value: number | string,
  ) => {
    const updatedPayment = { ...paymentForm, [field]: value };

    // For number fields, recalculate due amount
    if (typeof value === "number") {
      const newTotalReceived =
        (field === "cashReceived" ? value : updatedPayment.cashReceived) +
        (field === "cardReceived" ? value : updatedPayment.cardReceived) +
        (field === "bkashReceived" ? value : updatedPayment.bkashReceived) +
        (field === "nagadReceived" ? value : updatedPayment.nagadReceived) +
        (field === "rocketReceived" ? value : updatedPayment.rocketReceived) +
        (field === "upayReceived" ? value : updatedPayment.upayReceived) +
        (field === "bankTransferReceived"
          ? value
          : updatedPayment.bankTransferReceived);

      const autoCalculatedDue = Math.max(0, total - newTotalReceived);

      setPaymentForm({
        ...updatedPayment,
        due: field === "due" ? value : autoCalculatedDue,
      });
    } else {
      setPaymentForm(updatedPayment);
    }
  };

  // ---- Supabase helpers

  const startSaleForCustomer = async (cust: {
    id: number;
    name: string;
    phone?: string;
    email?: string;
  }) => {
    const { data, error } = await supabase.rpc("start_sale", {
      p_customer_id: cust.id,
      p_customer_name: cust.name,
      p_customer_phone: cust.phone || null,
      p_customer_email: cust.email || null,
      p_organization_id: currentShopId,
    });
    if (error) throw new Error(error.message || "start_sale failed");

    const saleId = (data?.sale_id as number) || null;
    const inv =
      (data?.invoice_number as string) ||
      (saleId ? `INV-${String(saleId).padStart(6, "0")}` : null);
    if (!saleId) throw new Error("start_sale returned no sale_id");

    setCurrentSaleId(saleId);
    setInvoiceNumber(inv);
    return { saleId, invoiceNumber: inv };
  };

  /**
   * Find a product by its name, for stock that has no barcode.
   *
   * Fills the form exactly as a scan does — including the internal key
   * the database generated for counted stock, which is what lets the
   * sale deduct from the right line. Without it the item would reach
   * the cart with no barcode and sell without touching stock at all.
   */
  const lookupByName = async (rawName: string): Promise<boolean> => {
    const name = rawName.trim();
    if (!name) return false;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_product_by_name", {
        p_name: name,
        p_organization_id: currentShopId,
      });
      if (error) throw error;

      const res = data as ProductResponse;
      if (!res?.success || !res.name) {
        toast({
          title: "Not found",
          description: res?.message || `No product matching"${name}".`,
          variant: "destructive",
        });
        return false;
      }

      setProductForm((prev) => ({
        ...prev,
        // The generated key for counted stock. Never shown, but it is
        // what the sale deducts against.
        barcode: res.barcode ?? "",
        name: res.name ?? prev.name,
        model: res.model ?? prev.model,
        variant: res.variant ?? prev.variant,
        color: res.color ?? prev.color,
        brand: res.brand ?? "",
        price: res.price ?? prev.price,
      }));

      setProductLoads((n) => n + 1);
      notifyLoaded(res);
      focusById("sale-price");
      return true;
    } catch (err: any) {
      toast({
        title: "Lookup failed",
        description: err?.message ?? "Could not look that product up.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Offer matching products as the cashier types.
   *
   * Debounced, because this fires on every keystroke and a shop with
   * thousands of lines does not need a query per letter. It starts from
   * the FIRST letter: in a shop the catalogue is small enough that one
   * letter already narrows it usefully, and waiting for a second makes
   * the field feel dead.
   */
  useEffect(() => {
    if (!posNoBarcode || !currentShopId) return;

    const term = productForm.name.trim();
    if (term.length < 1) {
      // Cleared (Add to Cart, New Sale): the next name typed is a new
      // search, even if it is the same product again.
      chosenNameRef.current = null;
      setNameHits([]);
      return;
    }
    // The cashier just picked this one: nothing to search for.
    if (chosenNameRef.current !== null && term === chosenNameRef.current.trim()) {
      return;
    }
    chosenNameRef.current = null;

    const timer = setTimeout(async () => {
      try {
        // Asked for more than are shown, because some are dropped below
        // and eight real choices should still reach the list.
        const { data, error } = await supabase.rpc("search_product_names", {
          p_query: term,
          p_organization_id: currentShopId,
          p_limit: 100,
        });
        if (error) throw error;
        // Manual Entry sells stock that has no barcode; a handset with
        // one is scanned. Filtered here as well as in the database
        // (script 104), so it holds on a database not yet updated.
        const counted = ((data ?? []) as NameSuggestion[]).filter((h) => h.no_barcode);
        setNameHits(withoutSoldOutBatches(counted).slice(0, 12));
        setNameHighlight(0);
        // Only while the cashier is in the name box -- never over a
        // field they have already moved on to.
        setShowNameHits(document.activeElement?.id === "product-name");
      } catch (err: any) {
        // A failed suggestion lookup must not stop the cashier typing
        // the name in full and pressing Enter.
        console.error("Product name search failed:", err?.message ?? err);
        setNameHits([]);
      }
    }, 200);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productForm.name, posNoBarcode, currentShopId]);

  /**
   * One line per product, not one per delivery.
   *
   * Counted stock gets a fresh key each time it is bought, so a product
   * bought twice has two stock rows. This used to drop only the
   * SOLD-OUT duplicates, which left the common case untouched: buy
   * "Square S3 · Speaker" on two invoices and both batches still have
   * one each, so the cashier is offered the same product name twice
   * with no way to tell the lines apart.
   *
   * So every batch of the same product now collapses to one line, and
   * the one kept is the fullest. That is not an arbitrary pick: typing
   * the name and pressing Enter goes to the server, which orders by
   * quantity desc and takes the top row, so keeping the fullest batch
   * makes the list agree with what Enter already does.
   *
   * The quantity shown is that batch's own, not the total across
   * batches. Summing would read as stock the chosen key cannot
   * actually supply, and the sale would be refused at the till with
   * the screen still claiming the stock was there.
   *
   * A product with NO stock anywhere still appears once as Out of
   * stock — the shop may have one on the shelf, and the sale is
   * refused server-side if not.
   */
  const withoutSoldOutBatches = (hits: NameSuggestion[]) => {
    // Spaces closed up and case ignored: "Flaxyload  Gp" and
    // "Flaxyload Gp" are one brand, entered twice.
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const identity = (h: NameSuggestion) =>
      [h.product_name, h.brand, h.model_number, h.variant, h.color].map(norm).join("|");

    const groups = new Map<string, NameSuggestion[]>();
    for (const hit of hits) {
      const key = identity(hit);
      groups.set(key, [...(groups.get(key) ?? []), hit]);
    }

    // One line per product: the fullest delivery is the one chosen,
    // carrying every delivery with stock and their total -- the same
    // figure Inventory shows.
    const lines: NameSuggestion[] = [];
    for (const group of groups.values()) {
      const byStock = [...group].sort(
        (x, y) => Number(y.quantity ?? 0) - Number(x.quantity ?? 0),
      );
      const batches = byStock
        .filter((h) => Number(h.quantity ?? 0) > 0)
        .map((h) => ({ barcode: h.barcode, quantity: Number(h.quantity) }));
      lines.push({
        ...byStock[0],
        batches,
        total: batches.reduce((t, x) => t + x.quantity, 0),
      });
    }

    // In stock first, then by name, as the server ranked them.
    return lines.sort(
      (x, y) =>
        Number((y.total ?? 0) > 0) - Number((x.total ?? 0) > 0) ||
        String(x.product_name).localeCompare(String(y.product_name)) ||
        String(x.brand ?? "").localeCompare(String(y.brand ?? "")),
    );
  };

  /**
   * The deliveries behind the product last chosen from the list. A sale
   * of more than the chosen delivery holds takes the rest from these.
   */
  const pickedBatchesRef = useRef<{
    barcode: string;
    batches: { barcode: string; quantity: number }[];
  } | null>(null);

  /** Take a suggestion exactly as offered — including its key. */
  const chooseSuggestion = (hit: NameSuggestion) => {
    chosenNameRef.current = hit.product_name;
    pickedBatchesRef.current = hit.batches?.length
      ? { barcode: hit.barcode, batches: hit.batches }
      : null;
    setProductForm((prev) => ({
      ...prev,
      barcode: hit.barcode ?? "",
      name: hit.product_name,
      model: hit.model_number ?? "",
      variant: hit.variant ?? "",
      color: hit.color ?? "",
      // The line's own brand (script 104), or blank on an older
      // database -- never the previous item's.
      brand: hit.brand ?? "",
      price: Number(hit.sale_price ?? 0),
    }));
    setProductLoads((n) => n + 1);
    setShowNameHits(false);
    setNameHits([]);
    focusById("sale-price");
  };

  const getProductByBarcode = async (
    barcode: string,
  ): Promise<ProductResponse> => {
    // The app works online only, so say so immediately rather than
    // letting the cashier wait on a request that cannot succeed.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return {
        success: false,
        message:
          "No internet connection. Reconnect before continuing to trade.",
      };
    }

    try {
      const { data, error } = await supabase.rpc("get_product_by_barcode", {
        p_barcode: barcode,
        p_organization_id: currentShopId,
      });
      if (error) throw error;
      return data as ProductResponse;
    } catch (error: any) {
      // Log the error itself as well as the pulled-apart fields. A
      // Postgres error is a plain object that renders as"{}", but so
      // does picking fields off something that is NOT a Postgres error
      // — and that second case is the one that leaves you staring at an
      // empty log with nothing to go on.
      const code = error?.code ?? "";
      console.error("Error fetching product:", {
        raw: error,
        type: Object.prototype.toString.call(error),
        code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        // Context that turns"it failed" into something diagnosable.
        barcode,
        shopId: currentShopId,
        browserThinksOnline:
          typeof navigator !== "undefined" ? navigator.onLine : null,
      });

      // PGRST202 means the database function itself is absent, which is
      // a setup problem, not a bad barcode. Say so plainly instead of
      // making staff think the product is missing.
      return {
        success: false,
        message:
          code === "PGRST202"
            ? "Product lookup is not set up on this database. Run scripts/34-pos-functions.sql."
            : error?.message || "Failed to fetch product from database",
      };
    }
  };

  // ---- Update customer dues
  // A helper that wrote customers.dues to a value calculated in the
  // browser used to live here. It is gone deliberately: balances now
  // move server-side inside complete_sale and settle_customer_due,
  // under a row lock. Writing an absolute figure from the client is how
  // two terminals overwrite each other's payments, so if you need to
  // change a balance, add it to one of those functions rather than
  // reintroducing a direct update.

  // ---- Printable receipt

  const openPrintableReceipt = async (
    saleId: number,
    options?: { autoPrint?: boolean; closeAfterPrint?: boolean },
  ) => {
    const shop = shops.find((sh) => sh.id === currentShopId);
    const result = await printReceiptDocument({
      supabase,
      saleId,
      organizationId: currentShopId,
      shop,
      autoPrint: options?.autoPrint,
      closeAfterPrint: options?.closeAfterPrint,
    });

    if (result.ok) return;

    if (result.reason === "popup-blocked") {
      // Never fail silently here. The cashier has taken the money and
      // is waiting to hand over a receipt — saying nothing looks
      // exactly like a receipt that printed.
      toast({
        title: "Receipt window did not open",
        description:
          "The sale is saved — nothing was lost. Use Last Receipt to print it. If it still will not open, allow pop-ups for this application.",
        variant: "destructive",
      });
      return;
    }

    console.error("print receipt error:", result.error);
    toast({
      title: "Failed to open printable receipt.",
      variant: "destructive",
    });
  };

  // ---- Barcode behavior

  // typing only (no fetch)
  const handleBarcodeInput = (value: string) => {
    setProductForm((f) => ({ ...f, barcode: value }));
  };

  /**
   * Say what was loaded — and say it differently when the unit came
   * back on an exchange.
   *
   * A defective unit sells exactly like any other; the only thing that
   * changes is that the cashier is told, so the customer can be told
   * too. Nothing is blocked, because the shop puts these back on the
   * shelf on purpose.
   */
  const notifyLoaded = (res: ProductResponse) => {
    const what = `${res.name}${res.variant ? ` ${res.variant}` : ""}${
      res.color ? ` - ${res.color}` : ""
    }`;

    if (res.defective) {
      toast({
        title: "⚠ Defected item",
        description: `${what} — this unit came back on an exchange. It can still be sold.`,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Product Loaded", description: what });
  };

  // lookup on click / scanner confirm - NO CUSTOMER CHECK
  const lookupByBarcode = async (rawBarcode: string): Promise<boolean> => {
    const barcode = rawBarcode.trim();
    if (!barcode) return false;

    setIsLoading(true);
    try {
      const res = await getProductByBarcode(barcode);
      if (res.success && res.name) {
        setProductForm((prev) => ({
          ...prev,
          barcode: res.barcode ?? barcode,
          name: res.name ?? prev.name,
          model: res.model ?? prev.model,
          variant: res.variant ?? prev.variant,
          color: res.color ?? prev.color,
          brand: res.brand ?? "",
          price: res.price ?? prev.price,
          // quantity remains prev.quantity
        }));
        setProductLoads((n) => n + 1);
        notifyLoaded(res);
        return true;
      } else {
        toast({
          title: "Not Found",
          description: res.message || "Barcode not found in inventory.",
          variant: "destructive",
        });
        return false;
      }
    } catch {
      toast({
        title: "Error",
        description: "Lookup failed",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // ---- Keyboard-first entry
  //
  // At a busy counter, reaching for the mouse between every field is
  // the biggest time cost. Enter walks the form, and a scan fills the
  // product automatically — no"Load" click.

  const barcodeRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  const focusField = (el: HTMLInputElement | null) => {
    if (!el) return;
    // Deferred a frame on purpose. The lookup finishes, then React
    // re-renders (the barcode box flips from disabled back to enabled
    // and the form fields repopulate). Focusing before that flush can
    // be undone by the render, leaving the cursor stuck in the barcode
    // box — which looked like"Enter does nothing".
    requestAnimationFrame(() => {
      el.focus();
      el.select?.();
    });
  };

  const focusById = (id: string) => {
    focusField(document.getElementById(id) as HTMLInputElement | null);
  };

  // A scan (or Enter in the barcode box) loads the product and parks
  // the cursor on Quantity, so one more Enter drops it in the cart.
  // Not memoised on purpose: useBarcodeScanner keeps the latest
  // callback in a ref, so a fresh closure each render is correct and
  // avoids capturing a stale lookupByBarcode.
  const handleScan = async (code: string) => {
    const found = await lookupByBarcode(code);
    // A miss keeps the cursor in the barcode box with the text
    // selected, so the cashier can simply scan again. Mis-scans are
    // routine at a counter; making them cost a mouse trip is not.
    focusField(found ? quantityRef.current : barcodeRef.current);
  };

  const scanner = useBarcodeScanner({
    onScan: handleScan,
    enabled: !isLoading,
  });

  // Held sales belong to a shop, so wait for it to resolve.
  useEffect(() => {
    if (!currentShopId) return;
    loadHeldSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  // Enter from any product field commits the line, then returns to the
  // barcode box ready for the next item.
  const addToCartAndContinue = async () => {
    await addToCart();
    focusField(barcodeRef.current);
  };

  const productFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addToCartAndContinue();
  };

  useHotkeys(
    {
      f1: () => focusField(barcodeRef.current),
      f2: () => focusById("customer-name"),
      f3: () => setShowCustomerSearch(true),
      f4: () => setShowCalculator(true),
      f7: () => openDues(),
      f8: () => holdSale(),
      f9: () => completeSale(),
      escape: () =>
        setProductForm((prev) => ({
          ...prev,
          barcode: "",
          name: "",
          model: "",
          variant: "",
          color: "",
          price: 0,
          discount: 0,
          isGift: false,
          quantity: 1,
        })),
    },
    { allowInInputs: ["f1", "f2", "f3", "f4", "f8", "f9", "escape"] },
  );

  // ---- Cart / sale

  // ✅ UPDATED: No customer check, no sale start
  const addToCart = async () => {
    if (!productForm.name || productForm.price <= 0) {
      toast({
        title: "Error",
        description: "Please enter product name and price",
        variant: "destructive",
      });
      return;
    }

    // A no-barcode product chosen from the list is one product however
    // many deliveries it came in on. A sale bigger than the chosen
    // delivery takes the rest from the next fullest, as separate cart
    // lines -- each delivery is its own stock line in the database,
    // and each is still checked there when the sale is recorded.
    const picked = pickedBatchesRef.current;
    let parts: { barcode: string; quantity: number }[] = [
      { barcode: productForm.barcode.trim(), quantity: productForm.quantity },
    ];
    if (
      posNoBarcode &&
      picked &&
      picked.barcode === productForm.barcode.trim() &&
      picked.batches.length > 1
    ) {
      const first = picked.batches.find((x) => x.barcode === picked.barcode);
      if (productForm.quantity > (first?.quantity ?? 0)) {
        const total = picked.batches.reduce((t, x) => t + x.quantity, 0);
        if (productForm.quantity > total) {
          toast({
            title: "Insufficient Stock",
            description: `Only ${total} in stock across all deliveries.`,
            variant: "destructive",
          });
          return;
        }
        parts = [];
        let left = productForm.quantity;
        const order = [
          ...(first ? [first] : []),
          ...picked.batches.filter((x) => x.barcode !== picked.barcode),
        ];
        for (const batch of order) {
          if (left <= 0) break;
          const take = Math.min(left, batch.quantity);
          parts.push({ barcode: batch.barcode, quantity: take });
          left -= take;
        }
      }
    }

    // Optional stock check (for barcoded items)
    if (parts.length === 1 && productForm.barcode.trim().length > 0) {
      const productResponse = await getProductByBarcode(
        productForm.barcode.trim(),
      );
      if (
        productResponse.success &&
        productResponse.available_quantity !== undefined
      ) {
        if (productResponse.available_quantity < productForm.quantity) {
          toast({
            title: "Insufficient Stock",
            description: `Only ${productResponse.available_quantity} units available in inventory`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    // The promo rides inside the line's discount, so every total the
    // till, the invoice and the books compute is worked out exactly as
    // it was before promos existed. What it adds is the claim.
    const lineDiscount = round2(productForm.discount + promoOffPerUnit);

    if (lineDiscount > productForm.price) {
      toast({
        title: "Discount is more than the price",
        description: promoOffPerUnit
          ? `The promo takes off ৳${promoOffPerUnit}. Lower the discount, or untick the promo.`
          : "Lower the discount and try again.",
        variant: "destructive",
      });
      return;
    }

    const baseItem: CartItem = {
      id: Date.now().toString(),
      name: productForm.name,
      model: productForm.model,
      variant: productForm.variant,
      color: productForm.color,
      quantity: productForm.quantity,
      price: productForm.price,
      discount: lineDiscount,
      isGift: productForm.isGift,
      promoId: offeredPromo && promoOffPerUnit ? offeredPromo.id : undefined,
      promoAmount: promoOffPerUnit || undefined,
      promoLabel: offeredPromo && promoOffPerUnit ? promoLabel(offeredPromo) : undefined,
      barcode: productForm.barcode.trim(),
    };

    // One cart line per delivery taken from; normally just the one.
    const newItems: CartItem[] = parts.map((part, i) => ({
      ...baseItem,
      id: `${baseItem.id}-${i}`,
      barcode: part.barcode,
      quantity: part.quantity,
    }));
    const newItem = newItems[0];
    pickedBatchesRef.current = null;
    setCartItems((prev) => [...prev, ...newItems]);
    setProductForm((prev) => ({
      ...prev,
      barcode: "",
      name: "",
      model: "",
      variant: "",
      color: "",
      brand: "",
      price: 0,
      discount: 0,
      isGift: false,
      promoOn: false,
    }));
    toast({
      title: "Product Added",
      description: `${newItem.name} added to cart`,
    });
  };

  const removeFromCart = (id: string) =>
    setCartItems((prev) => prev.filter((item) => item.id !== id));

  const updateQuantity = (id: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(id);
      return;
    }
    setCartItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, quantity: newQuantity } : item,
      ),
    );
  };

  const clearCart = () => {
    setCartItems([]);
    // The stored copy too. Emptying the cart on screen while leaving
    // the draft behind means it comes back on the next navigation.
    clearCartDraft();
    setPaymentForm({
      method: "",
      cashReceived: 0,
      cardReceived: 0,
      bkashReceived: 0,
      nagadReceived: 0,
      rocketReceived: 0,
      upayReceived: 0,
      bankTransferReceived: 0,
      due: 0,
      cardBank: "",
      bankTransferBank: "",
      mobileBankingMethod: "",
    });
  };

  // Close a sale row the cashier has walked away from. Holding or
  // starting a sale creates the row up front, so abandoning it would
  // otherwise leave it in_progress forever, holding an invoice number
  // that nothing will ever print.
  //
  // The status guard is not optional: newSale() also runs immediately
  // after a successful sale, when currentSaleId still points at the row
  // that was just completed.
  const releaseOpenSale = async (saleId: number | null) => {
    if (saleId == null || !currentShopId) return;
    await supabase
      .from("sales")
      .update({ status: "cancelled", held_cart: null, held_at: null })
      .eq("id", saleId)
      .eq("organization_id", currentShopId)
      .eq("status", "in_progress");
  };

  const newSale = async () => {
    await releaseOpenSale(currentSaleId);
    clearCart();
    // Without this the next customer inherits the last one's payment
    // route and amount — which, on a busy counter, is how a sale gets
    // recorded against the wrong bank.
    resetPayment();
    setProductForm({
      barcode: "",
      name: "",
      model: "",
      variant: "",
      color: "",
      brand: "",
      quantity: 1,
      price: 0,
      discount: 0,
      isGift: false,
      promoOn: false,
    });
    // Back to the scanner. No Barcode is for the occasional
    // accessory with nothing to scan, and leaving it on meant the next
    // customer's phone was rung up by typing its name — which picks a
    // stock row by text match instead of by barcode, and quietly sells
    // from the wrong batch.
    setPosNoBarcode(false);
    setNameHits([]);
    setShowNameHits(false);
    setCustomer(null);
    setCustName("");
    setCustPhone("");
    setCustEmail("");
    setCustHits([]);
    setCustHitsFor(null);
    setCurrentSaleId(null);
    setInvoiceNumber(null);
    // Back to today, deliberately. A date left ticked from the last
    // sale would misdate every sale that followed it, and the cashier
    // would have no reason to look. Re-ticking the box costs a click;
    // a day of sales on the wrong page of the cashbook costs an
    // evening of reconciling.
    setUseBackdate(false);
    setBackdateChoice(null);

    // Everything this till had half-finished. Clearing the fields on
    // screen is not enough: each one is also written to storage, and a
    // draft left behind reappears the moment the cashier navigates
    // away and back — behind the NEXT customer.
    clearDrafts(currentShopId, [
      "pos.cart",
      "pos.customer",
      "pos.productForm",
      "pos.priceText",
      "pos.useBackdate",
      "pos.backdateChoice",
      "pos.custName",
      "pos.custPhone",
      "pos.custEmail",
    ]);

    toast({
      title: "New Sale",
      description: "Ready for new transaction",
    });
  };

  // ✅ UPDATED: Check customer and start sale at completion
  /**
   * The cashier confirmed they meant to record this sale as unpaid.
   *
   * The acknowledgement is cleared in a finally block, so it applies to
   * exactly this one sale — the next sale asks again, whether this one
   * succeeded or failed.
   */
  const confirmZeroPaymentSale = async () => {
    setShowZeroPaymentConfirm(false);
    zeroPaymentAckRef.current = true;
    try {
      await completeSale();
    } finally {
      zeroPaymentAckRef.current = false;
    }
  };

  const completeSale = async () => {
    // Stop before the first write, not partway through. completeSale
    // inserts line items, decrements stock and finalises the sale as
    // separate statements — failing midway on a lapsed subscription
    // would leave a half-recorded sale behind.
    if (!canWrite) {
      toast({
        title: "Subscription inactive",
        description:
          "The app is read-only. Existing records are safe and can still be viewed and printed, but new sales cannot be recorded until it is renewed.",
        variant: "destructive",
      });
      return;
    }

    if (cartItems.length === 0) {
      toast({
        title: "Empty Cart",
        description: "Please add items to cart before completing sale.",
        variant: "destructive",
      });
      return;
    }

    // Ticked the box but picked nothing. Recording it as today would
    // be the one outcome the cashier has already said they don't want.
    if (useBackdate && !backdateChoice) {
      toast({
        title: "Choose a date",
        description: "Pick which of the last three days this sale was made on.",
        variant: "destructive",
      });
      return;
    }

    // Every sale has a customer. One already picked is used; otherwise
    // whatever is typed in Customer Information is saved here, so the
    // counter does not have to save the customer first.
    let saleCustomer = customer;
    if (!saleCustomer) {
      if (!custName.trim()) {
        toast({
          title: "Customer Required",
          description: "Type the customer's name (and phone) before completing the sale.",
          variant: "destructive",
        });
        return;
      }
      saleCustomer = await saveCustomer({ quiet: true });
      if (!saleCustomer) return;

      // The phone matched a customer who already owes the shop. Their
      // old balance joins this sale's total, which the cashier has not
      // seen yet — so stop and let them check it rather than charge it.
      if ((saleCustomer.dues || 0) > 0) {
        toast({
          title: `${saleCustomer.name} already owes ৳${Number(saleCustomer.dues).toFixed(2)}`,
          description: "Their previous dues are now added to the total. Check it and press Complete Sale again.",
        });
        return;
      }
    }

    // A resumed held sale already has a row and an invoice number, so
    // it is finished in place. A fresh sale is opened by the database
    // inside the same transaction — nothing is created up front that
    // could be left stranded if the sale never completes.
    const existingSaleId = currentSaleId;

    // Nothing at all was taken, but there is money owing.
    //
    // This is either a deliberate credit sale, or — far more often in a
    // rush — the cashier filled the cart and pressed F9 without typing
    // the amount received, silently turning the whole sale into debt.
    // The two are indistinguishable to the software, so ask.
    //
    // Partial payments are deliberately NOT prompted: instalments are
    // normal here, and a prompt that fires constantly is one staff learn
    // to dismiss without reading.
    //
    // A ref, not state: state is not readable in the same tick it is
    // set, so a state flag here would be stale on the retry.
    if (!zeroPaymentAckRef.current && totalReceived === 0 && total > 0) {
      setShowZeroPaymentConfirm(true);
      return;
    }

    // Every payment must say where the money went.
    //
    // Checked against the lines rather than a single method field: on a
    // split sale one line can be complete while another is missing its
    // bank, and only the lines know which.
    const incomplete = paymentLines.find((line) => {
      if (line.method === "bank_transfer")
        return !line.bankName || !line.channel;
      if (line.method === "mobile_banking") return !line.channel;
      return false;
    });

    if (incomplete) {
      toast({
        title: "Payment details incomplete",
        description:
          incomplete.method === "bank_transfer"
            ? "Choose the bank and the method used for the bank payment."
            : "Choose which mobile banking service was used.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // The entire sale — lines, stock movements, totals, dues — is one
      // database transaction. Previously this was half a dozen separate
      // calls, so a dropped connection midway could deduct stock for a
      // sale that was never recorded. Stock now moves as a guarded
      // delta server-side, which also makes overselling impossible.
      //
      // clientTxnId makes a retry safe: replaying the same sale returns
      // the original instead of charging twice.
      const clientTxnId =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      // Built once so the exact same sale can either go to the server
      // now or be parked on this PC — the queued copy must not be a
      // second, subtly different version of what was rung up.
      const saleArgs = {
        p_organization_id: currentShopId,
        p_client_txn_id: clientTxnId,
        p_existing_sale_id: existingSaleId,
        // The day the sale was made. Today is sent like any other day;
        // the database turns it back into now() so an ordinary sale
        // still carries its real time.
        p_sale_date: saleDate,
        p_customer: {
          id: saleCustomer.id ?? null,
          name: saleCustomer.name ?? null,
          phone: saleCustomer.phone ?? null,
          email: saleCustomer.email ?? null,
        },
        p_items: cartItems.map((item) => ({
          barcode: item.barcode || null,
          name: item.name,
          model: item.model || null,
          variant: item.variant || null,
          color: item.color || null,
          quantity: item.quantity,
          price: item.price,
          // Per unit, the promo included.
          discount: item.discount,
          gift: item.isGift,
          // Script 98. An older database ignores both: the keys are
          // read by name, so a till that is ahead of its database
          // sells exactly as it did before.
          promo_id: item.promoId ?? null,
          promo: item.promoAmount ?? 0,
        })),
        // Both shapes are sent on purpose.
        //
        // `lines` is the truthful record — it can hold BRAC-Card and
        // City-Card on one sale, which the fixed columns cannot. The
        // folded totals keep Day Cashbook, Ledger and Bank Info working
        // until each of them reads the lines instead.
        p_payments: {
          ...toLegacyTotals(paymentLines),
          method:
            paymentLines.length > 1
              ? "split"
              : paymentLines[0]?.channel || paymentLines[0]?.method || "cash",
          card_bank: firstBankFor(paymentLines, "card"),
          bank_transfer_bank: firstBankFor(paymentLines, "transfer"),
          lines: paymentLines.map((l) => ({
            method: l.method,
            bank: l.bankName || null,
            channel: l.channel || null,
            amount: l.amount,
          })),
        },
        p_totals: {
          subtotal,
          discount: totalDiscount,
          previous_dues: previousDues,
          net_amount: netAmount,
          total,
          received: totalReceived,
          change,
          due: remainingDue,
        },
      };

      // Sales are recorded on the server, so there is nothing useful to
      // attempt without a connection. Stop before the customer is
      // handed anything, and be explicit that no sale exists — a vague
      // failure here is how a customer walks out unpaid.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        toast({
          title: "No internet — sale NOT recorded",
          description:
            "Nothing has been charged and stock is unchanged. Reconnect and ring the sale up again before the customer leaves.",
          variant: "destructive",
        });
        return;
      }

      const { data: result, error: rpcError } = await supabase.rpc(
        "complete_sale",
        saleArgs,
      );

      // The connection died mid-sale. Same message, because the outcome
      // for the cashier is identical: no sale was recorded.
      if (rpcError && looksLikeNetworkFailure(rpcError.message)) {
        toast({
          title: "Lost connection — sale NOT recorded",
          description:
            "Nothing has been charged and stock is unchanged. Check the internet and ring the sale up again.",
          variant: "destructive",
        });
        return;
      }

      // The app knows how to date a sale but this database does not,
      // which means the migration has not been run on it. Named,
      // because"function not found" reads as a crash, and until it is
      // applied no sale can be recorded at all.
      if (rpcError?.code === "PGRST202") {
        toast({
          title: "Database update needed — sale NOT recorded",
          description:
            "Run scripts/58-sale-date.sql on this database. Nothing has been charged and stock is unchanged.",
          variant: "destructive",
        });
        return;
      }

      if (rpcError) throw new Error(rpcError.message);
      if (!result?.success) {
        toast({
          title: "Sale not completed",
          description: result?.message ?? "The sale could not be recorded.",
          variant: "destructive",
        });
        return;
      }

      const activeSaleId = result.sale_id as number;
      let activeInvoiceNumber = (result.invoice_number as string) ?? null;

      if (saleCustomer.id) {
        // Keep the on-screen customer in step with what the sale wrote.
        setCustomer({ ...saleCustomer, dues: newDuesForCustomer });
      }

      // Ensure invoice number is present
      let inv = activeInvoiceNumber;
      if (!inv && activeSaleId) {
        const { data: sRow } = await supabase
          .from("sales")
          .select("invoice_number")
          .eq("id", activeSaleId)
          .eq("organization_id", currentShopId)
          .single();
        inv =
          sRow?.invoice_number ||
          `INV-${String(activeSaleId).padStart(6, "0")}`;
        setInvoiceNumber(inv);
      }

      const completionMessage =
        remainingDue > 0
          ? `Sale completed with ৳${remainingDue.toFixed(2)} due remaining`
          : "Sale completed successfully";

      toast({
        title: "Sale Completed",
        description: `Invoice: ${inv} • ${completionMessage}`,
      });

      // Open the invoice as a preview. The shop asked not to have it
      // sent to the printer by itself: the cashier checks it on screen
      // and prints it with the Print button on the preview.
      if (activeSaleId) {
        setLastCompletedSaleId(activeSaleId);
        await openPrintableReceipt(activeSaleId);
      }

      // Reset for next transaction
      await newSale();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to complete sale";

      // The sale is one database transaction, so a failure here means
      // NOTHING was recorded — no sale, no stock movement, no dues.
      // Messages must say that plainly: staff who think a sale"might
      // have gone through" will either double-charge or let a customer
      // walk out unpaid.
      if (errorMessage.includes("Not enough stock")) {
        // The database refused because stock ran out between adding to
        // the cart and taking payment. Name the item; the cashier needs
        // to know which one to pull.
        const item = errorMessage.match(/"([^"]+)"/)?.[1];
        toast({
          title: "Not enough stock",
          description: `${
            item ? `"${item}" is` : "An item is"
          } out of stock, so the sale was not recorded. Nothing has been charged. Check the shelf, then remove it from the cart or correct the stock count in Inventory.`,
          variant: "destructive",
        });
      } else if (errorMessage.includes("Quantity must be at least")) {
        toast({
          title: "Check the quantity",
          description:
            "Every item needs a quantity of 1 or more. The sale was not recorded.",
          variant: "destructive",
        });
      } else if (
        errorMessage.includes("permission") ||
        errorMessage.includes("policy")
      ) {
        toast({
          title: "Not allowed",
          description:
            "This account cannot record sales for this shop. The sale was not recorded. Ask the owner to check your access.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sale not recorded",
          description: `Nothing was charged and stock is unchanged — you can safely try again. (${errorMessage})`,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const holdSale = async () => {
    // Stop before the first write, not partway through. completeSale
    // inserts line items, decrements stock and finalises the sale as
    // separate statements — failing midway on a lapsed subscription
    // would leave a half-recorded sale behind.
    if (!canWrite) {
      toast({
        title: "Subscription inactive",
        description:
          "The app is read-only. Existing records are safe and can still be viewed and printed, but new sales cannot be recorded until it is renewed.",
        variant: "destructive",
      });
      return;
    }

    if (cartItems.length === 0) {
      toast({
        title: "Empty Cart",
        description: "Add items to cart before holding sale.",
        variant: "destructive",
      });
      return;
    }

    // Require customer for held sales too
    if (!customer) {
      toast({
        title: "Customer Required",
        description:
          "Please select or save a customer before holding the sale.",
        variant: "destructive",
      });
      return;
    }

    // Start sale if not started.
    //
    // The id must be captured from the return value, not read back from
    // state: setCurrentSaleId does not take effect until the next
    // render, so using currentSaleId here sent id=eq.null and every
    // hold failed. completeSale already works this way.
    let activeSaleId = currentSaleId;
    if (!saleStarted) {
      try {
        const { saleId } = await startSaleForCustomer(
          customer as Required<Customer>,
        );
        activeSaleId = saleId;
      } catch (e: any) {
        toast({
          title: "Couldn't start sale",
          description: e?.message ?? "start_sale failed",
          variant: "destructive",
        });
        return;
      }
    }

    if (!activeSaleId) {
      toast({
        title: "Couldn't hold sale",
        description: "No sale reference was created.",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("sales")
        .update({
          subtotal,
          total_discount: totalDiscount,
          previous_dues: previousDues,
          net_amount: netAmount,
          total_amount: total,
          status: "held",
          // The basket has to travel with the sale. Line items only
          // reach sold_products on completion, so without this the
          // customer's items are gone the moment the screen clears.
          held_cart: cartItems,
          held_at: new Date().toISOString(),
        })
        .eq("id", activeSaleId)
        .eq("organization_id", currentShopId);
      if (error) throw error;
      toast({
        title: "Sale Held",
        description: `${cartItems.length} item(s) parked. Reopen from "Held Sales".`,
      });
      await newSale();
      loadHeldSales();
    } catch (error: any) {
      console.error("Error holding sale:", {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      });
      toast({
        title: "Couldn't hold sale",
        description: error?.message ?? "Failed to hold sale",
        variant: "destructive",
      });
    }
  };

  const printReceipt = async () => {
    const saleId = currentSaleId ?? lastCompletedSaleId;
    if (!saleId) {
      toast({
        title: "No receipt yet",
        description: "Complete a sale first, then this reprints it.",
      });
      return;
    }
    await openPrintableReceipt(saleId);
  };

  // ---- Customer selection / save

  /**
   * Take a customer chosen from the search dialog.
   *
   * The search returns rows in the database's shape (phone_number),
   * while the POS works in its own (phone). These were being assigned
   * wholesale, so customer.phone came out undefined every time a
   * customer was picked with F3 — the phone number then vanished from
   * the sale record and the printed receipt without any error.
   */
  const handleCustomerSelect = (selected: {
    id: number;
    name: string;
    phone_number?: string | null;
    email?: string | null;
    dues?: number | null;
  }) => {
    if (!selected.id) {
      toast({
        title: "Missing customer ID",
        description: "Selected customer must have an ID.",
        variant: "destructive",
      });
      return;
    }
    setCustomer({
      id: selected.id,
      name: selected.name,
      phone: selected.phone_number ?? "",
      email: selected.email ?? "",
      dues: Number(selected.dues ?? 0),
    });
    // The boxes as well. Picking from the dialog used to leave them
    // empty, so the card said one thing and the fields under it said
    // nothing.
    setCustName(selected.name ?? "");
    setCustPhone(selected.phone_number ?? "");
    setCustEmail(selected.email ?? "");
    setShowCustomerSearch(false);
  };

  /**
   * Look the shop's customers up as the cashier types.
   *
   * Debounced, because this fires on every keystroke and a phone shop
   * types a name faster than a round trip completes. Two characters is
   * the floor: one letter matches half the book and the list is no use.
   */
  const lookupCustomers = async (term: string, field: "name" | "phone") => {
    const q = term.trim();
    if (!currentShopId || q.length < 2) {
      setCustHits([]);
      setCustHitsFor(null);
      return;
    }

    setCustLooking(true);
    try {
      const column = field === "phone" ? "phone_number" : "name";
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,phone_number,email,dues")
        .eq("organization_id", currentShopId)
        // Searched on the box being typed in, not across everything: a
        // name box that starts matching phone numbers is a list the
        // cashier cannot make sense of.
        .ilike(column, `%${q}%`)
        .order("name", { ascending: true })
        .limit(8);

      if (error) throw error;
      setCustHits((data as CustomerHit[]) ?? []);
      setCustHitsFor(field);
    } catch (err: any) {
      // A failed lookup costs the shortcut, not the sale — the cashier
      // types the name out and Complete Sale saves it.
      console.warn("Customer lookup failed:", err?.message ?? err);
      setCustHits([]);
      setCustHitsFor(null);
    } finally {
      setCustLooking(false);
    }
  };

  const custLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCustomerType = (value: string, field: "name" | "phone") => {
    if (custLookupTimer.current) clearTimeout(custLookupTimer.current);
    custLookupTimer.current = setTimeout(() => lookupCustomers(value, field), 250);
  };

  /** Fill all three boxes from one click, and take the account with it. */
  const pickCustomer = (hit: CustomerHit) => {
    setCustName(hit.name ?? "");
    setCustPhone(hit.phone_number ?? "");
    setCustEmail(hit.email ?? "");
    setCustHits([]);
    setCustHitsFor(null);
    // The dues matter: this is what carries an old balance onto the
    // sale, and it is the whole reason for picking the existing record
    // rather than typing the name again.
    setCustomer({
      id: hit.id,
      name: hit.name,
      phone: hit.phone_number ?? "",
      email: hit.email ?? "",
      dues: Number(hit.dues ?? 0),
    });
  };

  /**
   * Save what is typed in Customer Information and make it this sale's
   * customer. Returns the customer, or null when it could not be saved.
   * `quiet` leaves out the "Customer Saved" toast — Complete Sale calls
   * it on the way through and has its own message to show.
   */
  const saveCustomer = async (
    opts: { quiet?: boolean } = {},
  ): Promise<Customer | null> => {
    const customerName = custName.trim();
    const customerPhone = custPhone.trim();
    const customerEmail = custEmail.trim();

    if (!customerName) {
      toast({
        title: "Error",
        description: "Customer name is required",
        variant: "destructive",
      });
      return null;
    }

    try {
      const { data, error } = await supabase.rpc("upsert_customer", {
        p_name: customerName,
        p_phone: customerPhone || null,
        p_email: customerEmail || null,
        p_organization_id: currentShopId,
      });
      if (error) throw new Error(error.message || "upsert_customer failed");
      if (!data?.success || !data?.customer?.id)
        throw new Error("upsert_customer returned no customer id");

      const saved: Customer = {
        id: data.customer.id,
        name: data.customer.name,
        phone: data.customer.phone,
        email: data.customer.email,
        dues: data.customer.dues ?? 0,
      };
      setCustomer(saved);
      if (!opts.quiet) {
        toast({ title: "Customer Saved", description: `Saved ${saved.name}.` });
      }
      return saved;
    } catch (e: any) {
      console.error("Error saving customer:", e);
      toast({
        title: "Error saving customer",
        description: e?.message ?? "Failed",
        variant: "destructive",
      });
      return null;
    }
  };

  return (
    <div className="flex-1 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Point of Sale</h1>
        <div className="flex flex-wrap gap-2">
          {/* The one action in this row that starts something rather than
              looking something up, so it carries the solid fill and its
              neighbours stay outlined. */}
          <Button
            onClick={newSale}
            disabled={isLoading}
            className="shadow-sm"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            New Sale
          </Button>
          <Button variant="outline" onClick={printReceipt}>
            <Receipt className="mr-2 h-4 w-4" />
            Last Receipt
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              loadHeldSales();
              setShowHeldSales(true);
            }}
            className={
              heldSales.length > 0
                ? "border-amber-400 bg-amber-50 hover:bg-amber-100"
                : ""
            }
          >
            <PauseCircle className="mr-2 h-4 w-4" />
            Held Sales
            {heldSales.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                {heldSales.length}
              </span>
            )}
          </Button>
          {/* Take a payment against an outstanding balance without
              needing to sell anything first. */}
          <Button variant="outline" onClick={openDues}>
            <Wallet className="mr-2 h-4 w-4" />
            Dues
          </Button>
          {/* Send stock to a sister shop at cost, and take payment for
              stock already sent. Only does anything once an owner has
              connected the two shops. */}
          <Button variant="outline" onClick={() => setShowTransfer(true)}>
            <Store className="mr-2 h-4 w-4" />
            Shop Transfers
          </Button>
          <Button variant="outline" onClick={() => setShowCalculator(true)}>
            <Calculator className="mr-2 h-4 w-4" />
            Calculator
          </Button>
        </div>
      </div>

      {/* ONE BOX. Customer, product and cart down the left; totals,
          payment and the actions down the right, always in view. The
          three tall cards it replaces left most of the screen empty.
          Every field, button and behaviour is the same - only the
          arrangement changed. */}
      {/* No overflow-hidden: the product suggestions drop down out of the
          left side, and clipping the box cut the lower ones off. */}
      <div className="flex flex-wrap rounded-xl border bg-card">
      <div className="min-w-0 flex-[999_1_640px] space-y-3 border-b p-4 lg:border-b-0 lg:border-r">
        {/* Customer Information */}
        <section className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
            <h2 className="flex items-center text-xs font-semibold uppercase tracking-wider text-primary">
              <User className="mr-2 h-4 w-4" />
              Customer
            </h2>
            {customer ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{customer.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {customer.phone}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {customer.email}
                    </p>
                    {customer.dues > 0 && (
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-sm text-red-600">
                          Previous Dues: ৳{customer.dues.toFixed(2)}
                        </p>
                        {/* Lets a customer pay off a balance without
                            having to buy something first. */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            // Opens the same Dues panel, filtered to
                            // this customer. It cannot jump straight to
                            // payment any more: the money now goes
                            // against one purchase, and a customer with
                            // two handsets on credit has two to choose
                            // between. Phone first — two customers can
                            // share a name.
                            setDuePayee(null);
                            setDuesSearch(
                              customer.phone || customer.name || "",
                            );
                            setShowDues(true);
                            loadDues();
                          }}
                        >
                          Settle Due
                        </Button>
                      </div>
                    )}
                    <p className="text-xs text-green-600 mt-1">
                      ✓ Customer selected
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      // Clearing the customer abandons the sale row too,
                      // so close it rather than orphan its invoice number.
                      await releaseOpenSale(currentSaleId);
                      setCustomer(null);
                      setCustName("");
                      setCustPhone("");
                      setCustEmail("");
                      setCurrentSaleId(null);
                      setInvoiceNumber(null);
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1.2fr_auto] sm:items-end">
                {/* Both boxes look the shop's customers up as they are
                    typed, and one click fills all three — including the
                    balance the customer is carrying. The Search dialog
                    is still there for anyone who wants to browse. */}
                <div className="relative">
                  <Label htmlFor="customer-name">Customer Name</Label>
                  <Input
                    id="customer-name"
                    autoComplete="off"
                    value={custName}
                    onChange={(e) => {
                      setCustName(e.target.value);
                      onCustomerType(e.target.value, "name");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setCustHitsFor(null);
                      if (e.key === "Enter") {
                        e.preventDefault();
                        // Enter takes the top match when the list is
                        // open — the common case is one regular whose
                        // name the cashier half-typed.
                        if (custHitsFor === "name" && custHits.length > 0) {
                          pickCustomer(custHits[0]);
                          focusById("customer-phone");
                          return;
                        }
                        focusById("customer-phone");
                      }
                    }}
                    placeholder="Enter customer name"
                  />
                  <CustomerHits
                    show={custHitsFor === "name"}
                    hits={custHits}
                    looking={custLooking}
                    onPick={pickCustomer}
                    onDismiss={() => setCustHitsFor(null)}
                  />
                </div>
                <div className="relative">
                  <Label htmlFor="customer-phone">Phone Number</Label>
                  <Input
                    id="customer-phone"
                    autoComplete="off"
                    value={custPhone}
                    onChange={(e) => {
                      setCustPhone(e.target.value);
                      onCustomerType(e.target.value, "phone");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setCustHitsFor(null);
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (custHitsFor === "phone" && custHits.length > 0) {
                          pickCustomer(custHits[0]);
                          focusById("customer-email");
                          return;
                        }
                        focusById("customer-email");
                      }
                    }}
                    placeholder="Enter phone number"
                  />
                  <CustomerHits
                    show={custHitsFor === "phone"}
                    hits={custHits}
                    looking={custLooking}
                    onPick={pickCustomer}
                    onDismiss={() => setCustHitsFor(null)}
                  />
                </div>
                <div>
                  <Label htmlFor="customer-email">Email Address</Label>
                  <Input
                    id="customer-email"
                    value={custEmail}
                    onChange={(e) => setCustEmail(e.target.value)}
                    onKeyDown={(e) => {
                      // On to the product: the customer is saved when
                      // the sale is completed, not here.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusById("barcode");
                      }
                    }}
                    type="email"
                    placeholder="Enter email address"
                  />
                </div>
                {/* No Save Customer: Complete Sale saves whoever is typed
                    here. Search is for picking someone already saved. */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowCustomerSearch(true)}
                >
                  Search Customer
                </Button>
              </div>
            )}
        </section>


        {/* Product Entry */}
        <section className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/70 p-3 dark:border-teal-900 dark:bg-teal-950/30">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center text-xs font-semibold uppercase tracking-wider text-primary">Product</h2>
              {/* Recording a sale made on a day the shop was closed.
                  Off is today, which is almost every sale — so the
                  cashier has to reach for this deliberately. */}
              <label
                htmlFor="pos-backdate"
                className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
              >
                Previous date
                <Checkbox
                  id="pos-backdate"
                  checked={useBackdate}
                  onCheckedChange={(next) => {
                    const on = next === true;
                    setUseBackdate(on);
                    // Leaving a chosen date behind when the box is
                    // unticked is how a sale ends up quietly dated to
                    // yesterday after the cashier changed their mind.
                    setBackdateChoice(on ? dateChoices[0].value : null);
                  }}
                />
              </label>
            </div>
            {/* The last three days, as choices rather than a calendar:
                there is no way to pick a date that is then refused. */}
            {useBackdate && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                <p className="text-xs font-medium text-amber-900">
                  Recording a sale from a previous day
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {dateChoices.map((choice) => {
                    const selected = backdateChoice === choice.value;

                    return (
                      <button
                        key={choice.value}
                        type="button"
                        onClick={() => setBackdateChoice(choice.value)}
                        className={`rounded-md border px-2 py-1.5 text-center transition-colors ${
                          selected
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-amber-300 bg-card text-amber-900 hover:bg-amber-100"
                        }`}
                      >
                        <span className="block text-sm font-semibold">
                          {choice.label}
                        </span>
                        <span className="block text-[11px] opacity-80">
                          {choice.weekday}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-amber-800">
                  This sale will appear in the Day Cashbook on the date chosen
                  above.
                </p>
              </div>
            )}

            {/* Accessories have no barcode worth scanning. In this mode
                the product is found by name instead, and fills the form
                exactly as a scan would. */}
            {/* The project's own Switch, rather than a hand-rolled one —
                it gets the knob geometry, focus ring and keyboard
                handling right, and matches every other control. */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-1.5">
              <div className="flex items-center gap-3">
                <Switch
                  id="pos-no-barcode"
                  checked={posNoBarcode}
                  onCheckedChange={(next) => {
                    setPosNoBarcode(next);
                    // Clear the row: a barcode left behind from the
                    // previous mode would attach this sale to the wrong
                    // stock line.
                    setProductForm({
                      barcode: "",
                      name: "",
                      model: "",
                      variant: "",
                      color: "",
                      brand: "",
                      quantity: 1,
                      price: 0,
                      discount: 0,
                      isGift: false,
                      promoOn: false,
                    });
                    setNameHits([]);
                    setShowNameHits(false);
                    setTimeout(
                      () => focusById(next ? "product-name" : "barcode"),
                      0,
                    );
                  }}
                  className="data-[state=checked]:bg-orange-500"
                />
                <Label
                  htmlFor="pos-no-barcode"
                  className="cursor-pointer text-sm font-medium"
                >
                  Manual Entry (No Barcode)
                </Label>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {posNoBarcode ? "No Barcode" : "Barcode"}
              </span>
            </div>

            {/* Sized to what they hold, not stretched across the screen. */}
            <div className="flex flex-wrap items-end gap-2">
            {!posNoBarcode && (
              <div className="flex w-full gap-2 sm:w-[340px]">
                <div className="flex-1">
                  <Label htmlFor="barcode">Barcode</Label>
                  <Input
                    id="barcode"
                    ref={barcodeRef}
                    autoFocus
                    placeholder="Scan or type barcode — loads automatically"
                    value={productForm.barcode}
                    onChange={(e) => {
                      handleBarcodeInput(e.target.value);
                      scanner.onChange(e.target.value);
                    }}
                    onKeyDown={scanner.onKeyDown}
                    disabled={isLoading}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => lookupByBarcode(productForm.barcode)}
                    disabled={isLoading || !productForm.barcode.trim()}
                  >
                    Load
                  </Button>
                </div>
              </div>
            )}

            <div className="relative w-full sm:w-[260px]">
              <Label htmlFor="product-name">Product Name</Label>
              <Input
                id="product-name"
                autoComplete="off"
                autoFocus={posNoBarcode}
                onKeyDown={(e) => {
                  // Arrow keys walk the suggestions, so the whole thing
                  // stays on the keyboard.
                  if (posNoBarcode && showNameHits && nameHits.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setNameHighlight((i) => (i + 1) % nameHits.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setNameHighlight(
                        (i) => (i - 1 + nameHits.length) % nameHits.length,
                      );
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      chooseSuggestion(nameHits[nameHighlight]);
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    setShowNameHits(false);
                    return;
                  }
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  // No suggestion highlighted — look up what was typed.
                  // In barcode mode Enter still adds to cart as before.
                  if (posNoBarcode) lookupByName(productForm.name);
                  else addToCartAndContinue();
                }}
                onBlur={() => {
                  // Delayed so a click on a suggestion lands before the
                  // list disappears out from under the pointer.
                  setTimeout(() => setShowNameHits(false), 150);
                }}
                onFocus={() => {
                  if (nameHits.length > 0) setShowNameHits(true);
                }}
                placeholder={
                  posNoBarcode
                    ? "Type product name — suggestions appear as you type"
                    : "Auto-filled from barcode or enter manually"
                }
                value={productForm.name}
                onChange={(e) =>
                  setProductForm({ ...productForm, name: e.target.value })
                }
                className={
                  productForm.barcode && productForm.name ? "bg-green-50" : ""
                }
              />

              {posNoBarcode && showNameHits && nameHits.length > 0 && (
                <div className="absolute left-0 z-50 mt-1 w-[min(520px,90vw)] max-h-[60vh] overflow-y-auto rounded-lg border bg-popover shadow-lg">
                  {nameHits.map((hit, i) => (
                    <button
                      key={`${hit.barcode}-${i}`}
                      type="button"
                      // onMouseDown, not onClick: blur fires first
                      // otherwise and the list is gone before the click.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        chooseSuggestion(hit);
                      }}
                      onMouseEnter={() => setNameHighlight(i)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                        i === nameHighlight ? "bg-accent" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {hit.product_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[hit.brand, hit.model_number, hit.variant, hit.color]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                          {hit.supplier ? ` — ${hit.supplier}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold">
                          ৳{Number(hit.sale_price ?? 0).toFixed(2)}
                        </span>
                        {/* Out-of-stock is shown, not hidden: the shop
                            may still have one on the shelf, and the sale
                            is refused server-side anyway. */}
                        <span
                          className={`block text-xs ${
                            (hit.total ?? hit.quantity) > 0
                              ? "text-muted-foreground"
                              : "text-destructive"
                          }`}
                        >
                          {(hit.total ?? hit.quantity) > 0
                            ? `${hit.total ?? hit.quantity} in stock${
                                (hit.batches?.length ?? 0) > 1
                                  ? ` · ${hit.batches!.length} deliveries`
                                  : ""
                              }`
                            : "Out of stock"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Variant, Colour and Qty sit with the product they describe.
                Editable rather than display-only: an item keyed in by
                hand without a barcode still needs a configuration, or it
                reaches the cart and the receipt without one. */}
            <div className="w-full sm:w-[140px]">
              <Label htmlFor="variant">Variant</Label>
              <Input
                id="variant"
                onKeyDown={productFieldKeyDown}
                placeholder="Auto-filled from barcode — e.g. 6/128"
                value={productForm.variant}
                onChange={(e) =>
                  setProductForm({ ...productForm, variant: e.target.value })
                }
                className={
                  productForm.barcode && productForm.variant
                    ? "bg-green-50"
                    : ""
                }
              />
            </div>

            <div className="contents">
              <div className="w-full sm:w-[140px]">
                <Label htmlFor="color">Color</Label>
                <Input
                  id="color"
                  onKeyDown={productFieldKeyDown}
                  placeholder="Auto-filled from barcode"
                  value={productForm.color}
                  onChange={(e) =>
                    setProductForm({ ...productForm, color: e.target.value })
                  }
                  className={
                    productForm.barcode && productForm.color
                      ? "bg-green-50"
                      : ""
                  }
                />
              </div>
              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <div className="flex items-center">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 bg-transparent"
                    onClick={() =>
                      setProductForm({
                        ...productForm,
                        quantity: Math.max(1, productForm.quantity - 1),
                      })
                    }
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    className="text-center mx-1"
                    ref={quantityRef}
                    value={productForm.quantity}
                    onKeyDown={productFieldKeyDown}
                    onChange={(e) =>
                      setProductForm({
                        ...productForm,
                        quantity: Math.max(
                          1,
                          Number.parseInt(e.target.value) || 1,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 bg-transparent"
                    onClick={() =>
                      setProductForm({
                        ...productForm,
                        quantity: productForm.quantity + 1,
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            </div>

            {isLoading && (
              <div className="bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-800">
                  🔍 Looking up product...
                </p>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-[150px_170px_auto_auto] md:items-start md:justify-start">
            <div className="contents">
              <div>
                {/* The same height as the Discount header beside it,
                    which carries the Gift tick — otherwise the two
                    boxes below them do not line up. */}
                <div className="flex h-6 items-center">
                  <Label htmlFor="sale-price">Sale Price</Label>
                </div>
                <Input
                  id="sale-price"
                  onKeyDown={productFieldKeyDown}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Auto-filled from barcode"
                  value={priceText}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setPriceText(raw);
                    setProductForm((f) => ({
                      ...f,
                      price: Number.parseFloat(raw) || 0,
                    }));
                  }}
                  className={
                    productForm.barcode && productForm.price > 0
                      ? "bg-green-50"
                      : ""
                  }
                />
              </div>
              <div>
                <div className="flex h-6 items-center justify-between">
                  <Label htmlFor="discount">Discount (TK)</Label>
                  {/* Marks the line as given away rather than
                      discounted. The invoice prints it as a plain free
                      item — no "Discount" figure the customer can read
                      a rate off — while the books behind it still see
                      exactly what they always did: a full-price item
                      marked down to zero. */}
                  <label
                    htmlFor="product-gift"
                    className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Checkbox
                      id="product-gift"
                      checked={productForm.isGift}
                      onCheckedChange={(next) => {
                        const on = next === true;
                        setProductForm((prev) => ({
                          ...prev,
                          isGift: on,
                          // On: the discount is not something the
                          // cashier tunes any more, it just has to
                          // equal the price. Off: back to an ordinary
                          // markdown, starting from nothing rather
                          // than leaving the gift's full-price
                          // discount sitting there unexplained.
                          discount: on ? prev.price : 0,
                          // A gift is not claimable: the customer was
                          // not charged, so there is nothing for the
                          // supplier to fund.
                          promoOn: on ? false : prev.promoOn,
                        }));
                      }}
                    />
                    Gift
                  </label>
                </div>
                <Input
                  id="discount"
                  onKeyDown={productFieldKeyDown}
                  type="number"
                  placeholder="0"
                  value={productForm.discount || ""}
                  readOnly={productForm.isGift}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      discount: Number.parseFloat(e.target.value) || 0,
                    })
                  }
                  className={productForm.isGift ? "bg-muted" : ""}
                />
              </div>
            </div>
            <Button
              className={
                posNoBarcode
                  ? "w-full whitespace-nowrap bg-orange-500 px-5 hover:bg-orange-600 md:mt-6 md:w-auto md:min-w-44"
                  : "w-full whitespace-nowrap px-5 md:mt-6 md:w-auto md:min-w-44"
              }
              onClick={addToCart}
              disabled={isLoading}
            >
              {posNoBarcode ? "Add to Cart (No Barcode)" : "Add to Cart"}
            </Button>
            {/* The supplier's own money, offered only when this
                handset is on a promo running today. Unticked by
                default: the cashier says whether the sale is on
                the promo, because the shop cannot claim for one
                it did not actually give. Beside Add to Cart, so the
                row does not grow taller when there is one. */}
            {offeredPromo && (
              <label
                htmlFor="product-promo"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs leading-tight dark:border-amber-700/60 dark:bg-amber-950/30 md:mt-6 md:min-h-10"
              >
                <Checkbox
                  id="product-promo"
                  checked={productForm.promoOn}
                  onCheckedChange={(next) =>
                    setProductForm((prev) => ({ ...prev, promoOn: next === true }))
                  }
                />
                <span>
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    Supplier promo −৳{Number(offeredPromo.amount).toFixed(2)}
                  </span>
                  <span className="block text-amber-800 dark:text-amber-300">
                    {promoLabel(offeredPromo)} · claimed back from the supplier
                  </span>
                </span>
              </label>
            )}
            </div>

        </section>


        {/* Cart */}
        <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center text-xs font-semibold uppercase tracking-wider text-primary">
                Cart
                {cartItems.length > 0 && (
                  <span className="ml-2 rounded-full bg-primary px-2 text-[11px] font-semibold normal-case tracking-normal text-primary-foreground">
                    {cartItems.length}
                  </span>
                )}
              </h2>
              {cartItems.length > 0 && (
                <Button variant="outline" size="sm" onClick={clearCart}>
                  Clear All
                </Button>
              )}
            </div>
            {/* Cart Items. Taller than before: it has the width of the
                screen's left side and the room the old columns wasted. */}
            <div className="max-h-[min(42vh,440px)] overflow-y-auto rounded-lg border bg-background p-3">
              <div className="space-y-2">
                {cartItems.length > 0 ? (
                  cartItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-md border-b bg-row px-2 py-1.5 text-sm even:bg-stripe"
                    >
                      <div className="flex-1">
                        <p
                          className={`font-medium ${
                            item.isGift ? "text-green-700" : ""
                          }`}
                        >
                          {item.name} - {item.color}
                          {item.isGift && (
                            <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                              Gift
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground">
                          ৳{item.price.toFixed(2)} × {item.quantity}
                          {/* A gift's discount is what makes it free,
                              not a markdown worth itemising — the
                              badge above already says what this line
                              is. */}
                          {!item.isGift && item.discount > 0 && ` (-৳${item.discount})`}
                        </p>
                        {/* Part of the discount above, not on top of
                            it — said out loud so the cashier can see
                            which sales the shop will be claiming
                            for. */}
                        {item.promoAmount ? (
                          <p className="text-xs font-medium text-amber-700 dark:text-amber-500">
                            Supplier promo −৳{item.promoAmount.toFixed(2)} × {item.quantity}
                            {item.promoLabel ? ` · ${item.promoLabel}` : ""}
                          </p>
                        ) : null}
                        {item.barcode && (
                          <p className="text-xs text-muted-foreground">
                            Barcode: {item.barcode}
                          </p>
                        )}
                        {item.model && (
                          <p className="text-xs text-muted-foreground">
                            Model: {item.model}
                          </p>
                        )}
                        {item.variant && (
                          <p className="text-xs font-medium text-foreground">
                            Variant: {item.variant}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() =>
                            updateQuantity(item.id, item.quantity - 1)
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center">{item.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() =>
                            updateQuantity(item.id, item.quantity + 1)
                          }
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-500"
                          onClick={() => removeFromCart(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-muted-foreground py-4">
                    No items in cart
                  </p>
                )}
              </div>
            </div>
        </section>
      </div>

      {/* Right: totals, payment and the actions */}
      <div className="min-w-0 flex-[1_1_360px] space-y-3 rounded-b-xl bg-muted/20 p-4 lg:flex-[0_0_31%] lg:rounded-b-none lg:rounded-r-xl">
            <h2 className="flex items-center text-xs font-semibold uppercase tracking-wider text-primary">Payment</h2>
            {/* Totals with improved due display */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>৳{subtotal.toFixed(2)}</span>
              </div>
              {/* The promo comes off what the customer pays, but it is
                  the supplier's money, not the shop's discount — so it
                  is shown on its own line. Net Amount is unchanged. */}
              <div className="flex justify-between">
                <span>Discount:</span>
                <span>-৳{(totalDiscount - promoTotal).toFixed(2)}</span>
              </div>
              {promoTotal > 0 && (
                <div className="flex justify-between text-amber-700 dark:text-amber-500">
                  <span>Supplier promo:</span>
                  <span>-৳{promoTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Net Amount:</span>
                <span>৳{netAmount.toFixed(2)}</span>
              </div>
              {previousDues > 0 && (
                <div className="flex justify-between text-orange-600">
                  <span>Previous Dues:</span>
                  <span>৳{previousDues.toFixed(2)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total:</span>
                <span>৳{total.toFixed(2)}</span>
              </div>
            </div>

            {/* How the customer paid.

                One route normally; Split Payment turns it into a list
                of lines, each with its own bank and method. That is the
                only shape that can record BRAC-Card and City-Card on
                the same sale — the old fixed columns could hold one
                card bank, so the second silently disappeared. */}
            <div className="space-y-3">
              <PaymentRoute
                idPrefix="pos"
                allowSplit
                value={payRoute}
                methods={payMethods}
                reloadMethods={reloadPayMethods}
                onChange={(next) => {
                  setPayRoute(next);
                  if (next.method === "split" && payLines.length === 0) {
                    // Seed with one empty line so there is something to
                    // fill in rather than an empty panel.
                    setPayLines([{ ...EMPTY_ROUTE, amount: 0 }]);
                  }
                }}
              />

              {payRoute.method !== "split" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="pos-amount">Amount Received</Label>
                  <Input
                    id="pos-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={payAmount || ""}
                    onChange={(e) =>
                      setPayAmount(Number.parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border p-3">
                  {payLines.map((line, i) => (
                    <div
                      key={i}
                      data-pay-line="pos"
                      className={paymentLineTint(i).box}
                    >
                      <div className="flex items-center justify-between">
                        <span className={paymentLineTint(i).label}>
                          Payment {i + 1}
                        </span>
                        {payLines.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setPayLines((prev) =>
                                prev.filter((_, idx) => idx !== i),
                              )
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <PaymentRoute
                        idPrefix={`pos-line-${i}`}
                        value={line}
                        methods={payMethods}
                        reloadMethods={reloadPayMethods}
                        onChange={(next) =>
                          setPayLines((prev) =>
                            prev.map((l, idx) =>
                              idx === i ? { ...next, amount: l.amount } : l,
                            ),
                          )
                        }
                      />

                      <div className="space-y-1.5">
                        <Label
                          htmlFor={`pos-line-${i}-amount`}
                          className="text-xs"
                        >
                          Amount
                        </Label>
                        <Input
                          id={`pos-line-${i}-amount`}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={line.amount || ""}
                          onChange={(e) =>
                            setPayLines((prev) =>
                              prev.map((l, idx) =>
                                idx === i
                                  ? {
                                      ...l,
                                      amount:
                                        Number.parseFloat(e.target.value) || 0,
                                    }
                                  : l,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setPayLines((prev) => [
                        ...prev,
                        { ...ADDED_ROUTE, amount: leftToPay(total, prev) },
                      ]);
                      revealNewPaymentLine("pos");
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add payment
                  </Button>
                </div>
              )}
            </div>

            {/* Due Amount */}
            <div>
              <Label htmlFor="due">Due Amount</Label>
              <Input
                id="due"
                type="number"
                placeholder="0.00"
                value={paymentForm.due || ""}
                onChange={(e) =>
                  handlePaymentChange(
                    "due",
                    Number.parseFloat(e.target.value) || 0,
                  )
                }
                className={
                  remainingDue > 0 ? "bg-yellow-50 border-yellow-300" : ""
                }
              />
              {remainingDue > 0 && (
                <p className="text-xs text-yellow-700 mt-1">
                  Suggested due: ৳{remainingDue.toFixed(2)}
                </p>
              )}
            </div>

            {/* Payment Summary */}
            <div className="bg-muted p-3 rounded-lg space-y-1">
              <div className="flex justify-between text-sm">
                <span>Total Received:</span>
                <span>৳{totalReceived.toFixed(2)}</span>
              </div>
              {remainingDue > 0 ? (
                <div className="flex justify-between font-bold text-orange-600">
                  <span>Remaining Due:</span>
                  <span>৳{remainingDue.toFixed(2)}</span>
                </div>
              ) : change > 0 ? (
                <div className="flex justify-between font-bold text-green-600">
                  <span>Change to Return:</span>
                  <span>৳{change.toFixed(2)}</span>
                </div>
              ) : (
                <div className="flex justify-between font-bold text-green-600">
                  <span>Fully Paid</span>
                  <span>✓</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
                size="lg"
                onClick={completeSale}
                disabled={cartItems.length === 0 || isLoading}
              >
                <CreditCard className="mr-2 h-5 w-5" />
                {isLoading
                  ? "Processing..."
                  : !customer && !custName.trim()
                    ? "Enter Customer to Complete"
                    : "Complete Sale"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={holdSale}
                  disabled={cartItems.length === 0 || isLoading}
                >
                  Hold Sale
                </Button>
                <Button variant="outline" onClick={printReceipt}>
                  Print Receipt
                </Button>
              </div>
            </div>
      </div>
      </div>

      {/* Dialogs */}
      <POSCalculator open={showCalculator} onOpenChange={setShowCalculator} />
      <CustomerSearch
        open={showCustomerSearch}
        onOpenChange={setShowCustomerSearch}
        onSelectCustomer={handleCustomerSelect}
      />
      {/* Pay off an outstanding balance with no goods involved. */}
      {/* Nothing was taken for this sale. Confirm before it becomes debt. */}
      <Dialog
        open={showZeroPaymentConfirm}
        onOpenChange={setShowZeroPaymentConfirm}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>No payment received</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-1">
                <p>
                  Nothing has been entered as received, so the full{""}
                  <span className="font-semibold text-foreground">
                    ৳{total.toFixed(2)}
                  </span>
                  {""}
                  will be recorded as owing.
                </p>
                {customer ? (
                  <p>
                    It will be added to{""}
                    <span className="font-semibold text-foreground">
                      {customer.name}
                    </span>
                    &apos;s account.
                  </p>
                ) : (
                  <p className="font-medium text-destructive">
                    No customer is selected, so there will be no record of who
                    owes this. Go back and choose a customer first.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setShowZeroPaymentConfirm(false)}
            >
              Go back
            </Button>
            {/* Autofocused so the keyboard flow survives: F9 then Enter
                completes a genuine credit sale without reaching for the
                mouse, while Esc backs out. */}
            <Button
              autoFocus
              variant={customer ? "default" : "destructive"}
              onClick={confirmZeroPaymentSale}
              disabled={isLoading}
            >
              {customer ? "Yes, record as due" : "Record with no customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShopTransferDialog open={showTransfer} onOpenChange={setShowTransfer} />

      {/* Dues — who owes money, and taking payment against it. */}
      <Dialog open={showDues} onOpenChange={setShowDues}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>
              {duePayee ? "Take payment" : "Outstanding dues"}
            </DialogTitle>
            <DialogDescription>
              {duePayee
                ? `${duePayee.name} · ${duePayee.invoiceNumber ?? `#${duePayee.saleId}`} — ৳${Number(
                    duePayee.outstanding,
                  ).toFixed(2)} left on this purchase. Part payments are fine.`
                : "Purchases still owing money. Choose one to take a payment against it."}
            </DialogDescription>
          </DialogHeader>

          {!duePayee ? (
            <div className="space-y-3">
              <Input
                autoFocus
                placeholder="Search by name, phone, invoice or product…"
                value={duesSearch}
                onChange={(e) => setDuesSearch(e.target.value)}
              />

              {duesLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Loading…
                </div>
              ) : duesList.length === 0 ? (
                <div className="rounded-lg border border-dashed py-10 text-center">
                  <Wallet className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-3 text-sm font-medium">
                    Nothing outstanding
                  </p>
                  <p className="text-sm text-muted-foreground">
                    No purchase is currently owing money.
                  </p>
                </div>
              ) : (
                <>
                  <div className="max-h-[360px] space-y-2 overflow-y-auto">
                    {duesList
                      .filter((p) => {
                        const q = duesSearch.trim().toLowerCase();
                        if (!q) return true;
                        // Products included: the cashier is more likely
                        // to be told"the black Spark" than an invoice
                        // number.
                        const haystack = [
                          p.name,
                          p.phone_number,
                          p.invoiceNumber,
                          ...p.items.map((i) =>
                            [i.product_name, i.variant, i.color]
                              .filter(Boolean)
                              .join(""),
                          ),
                        ]
                          .filter(Boolean)
                          .join("")
                          .toLowerCase();
                        return haystack.includes(q);
                      })
                      .map((p) => (
                        <button
                          key={p.saleId}
                          type="button"
                          onClick={() => selectPayee(p)}
                          className="flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {p.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {p.invoiceNumber ?? `#${p.saleId}`}
                              {p.saleDate
                                ? ` · ${new Date(p.saleDate).toLocaleDateString()}`
                                : ""}
                              {p.phone_number ? ` · ${p.phone_number}` : ""}
                            </p>
                            <p className="mt-1 truncate text-xs">
                              {p.items.length === 0
                                ? "—"
                                : p.items
                                    .map(
                                      (i) =>
                                        `${i.product_name}${
                                          [i.variant, i.color].filter(Boolean)
                                            .length
                                            ? ` (${[i.variant, i.color]
                                                .filter(Boolean)
                                                .join(",")})`
                                            : ""
                                        }`,
                                    )
                                    .join(",")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-red-600">
                              ৳{p.outstanding.toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              of ৳{p.total.toFixed(2)}
                            </p>
                          </div>
                        </button>
                      ))}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      {duesList.length} purchase
                      {duesList.length === 1 ? "" : "s"} owing
                    </span>
                    <span className="font-semibold">
                      ৳
                      {duesList
                        .reduce((sum, p) => sum + p.outstanding, 0)
                        .toFixed(2)}
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* The same picker as checkout, so a due settled through
                  BRAC's PULM reconciles against a sale taken the same
                  way. Split works here too: a customer can clear a
                  balance partly in cash and partly by bKash. */}
              <PaymentRoute
                idPrefix="due"
                allowSplit
                value={dueRoute}
                methods={payMethods}
                reloadMethods={reloadPayMethods}
                onChange={(next) => {
                  setDueRoute(next);
                  if (next.method === "split" && dueLines.length === 0) {
                    setDueLines([{ ...EMPTY_ROUTE, amount: 0 }]);
                  }
                }}
              />

              {dueRoute.method !== "split" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="due-amount">Amount received</Label>
                  <Input
                    id="due-amount"
                    autoFocus
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={dueSingle}
                    onChange={(e) => setDueSingle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        recordDuePayment();
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border p-3">
                  {dueLines.map((line, i) => (
                    <div
                      key={i}
                      data-pay-line="due"
                      className={paymentLineTint(i).box}
                    >
                      <div className="flex items-center justify-between">
                        <span className={paymentLineTint(i).label}>
                          Payment {i + 1}
                        </span>
                        {dueLines.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setDueLines((prev) =>
                                prev.filter((_, idx) => idx !== i),
                              )
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <PaymentRoute
                        idPrefix={`due-line-${i}`}
                        value={line}
                        methods={payMethods}
                        reloadMethods={reloadPayMethods}
                        onChange={(next) =>
                          setDueLines((prev) =>
                            prev.map((l, idx) =>
                              idx === i ? { ...next, amount: l.amount } : l,
                            ),
                          )
                        }
                      />

                      <div className="space-y-1.5">
                        <Label
                          htmlFor={`due-line-${i}-amount`}
                          className="text-xs"
                        >
                          Amount
                        </Label>
                        <Input
                          id={`due-line-${i}-amount`}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={line.amount || ""}
                          onChange={(e) =>
                            setDueLines((prev) =>
                              prev.map((l, idx) =>
                                idx === i
                                  ? {
                                      ...l,
                                      amount:
                                        Number.parseFloat(e.target.value) || 0,
                                    }
                                  : l,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setDueLines((prev) => [
                        ...prev,
                        {
                          ...ADDED_ROUTE,
                          amount: leftToPay(duePayee?.outstanding ?? 0, prev),
                        },
                      ]);
                      revealNewPaymentLine("due");
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add payment
                  </Button>
                </div>
              )}

              {/* The running total, so the cashier can see at a glance
                  that the split adds up before committing. */}
              <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Owing on this purchase
                  </span>
                  <span>৳{Number(duePayee.outstanding).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between font-medium">
                  <span>Being paid</span>
                  <span
                    className={
                      dueEntered > Number(duePayee.outstanding)
                        ? "text-destructive"
                        : ""
                    }
                  >
                    ৳{dueEntered.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-1">
                  <span className="text-muted-foreground">
                    {dueEntered > Number(duePayee.outstanding)
                      ? "Over by"
                      : "Still owing after"}
                  </span>
                  <span
                    className={
                      dueEntered > Number(duePayee.outstanding)
                        ? "font-semibold text-destructive"
                        : "font-semibold"
                    }
                  >
                    ৳
                    {Math.abs(
                      Number(duePayee.outstanding) - dueEntered,
                    ).toFixed(2)}
                  </span>
                </div>
              </div>

              {dueEntered > Number(duePayee.outstanding) && (
                <p className="text-xs text-destructive">
                  More than is owed on this purchase. Reduce the amounts, or
                  take the rest against their other purchase — this shop does
                  not take advance payment through this screen.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-end">
            {duePayee ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDuePayee(null)}
                  disabled={duePaying}
                >
                  Back to list
                </Button>
                <Button
                  onClick={recordDuePayment}
                  disabled={
                    duePaying ||
                    dueEntered <= 0 ||
                    dueEntered > Number(duePayee.outstanding)
                  }
                >
                  {duePaying
                    ? "Recording…"
                    : `Record ৳${dueEntered.toFixed(2)}`}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setShowDues(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Held sales — a parked basket a cashier can come back to. */}
      <Dialog open={showHeldSales} onOpenChange={setShowHeldSales}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Held Sales</DialogTitle>
            <DialogDescription>
              Baskets parked earlier. Resuming puts the items and customer back
              on screen and keeps the same invoice number.
            </DialogDescription>
          </DialogHeader>

          {heldSales.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center">
              <PauseCircle className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No held sales</p>
              <p className="text-sm text-muted-foreground">
                Use Hold Sale to park a basket and serve the next customer.
              </p>
            </div>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto">
              {heldSales.map((h) => {
                const sc = Array.isArray(h.sale_customers)
                  ? h.sale_customers[0]
                  : h.sale_customers;
                const count = Array.isArray(h.held_cart)
                  ? h.held_cart.length
                  : 0;
                return (
                  <div
                    key={h.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {sc?.customer_name || "Walk-in customer"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {h.invoice_number} • {count} item
                        {count === 1 ? "" : "s"} • ৳
                        {Number(h.total_amount ?? 0).toFixed(2)}
                        {h.held_at
                          ? ` • ${new Date(h.held_at).toLocaleTimeString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => resumeHeldSale(h)}>
                        Resume
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => discardHeldSale(h)}
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ProductScanner
        open={showScanner}
        onOpenChange={setShowScanner}
        onScanResult={(result) => lookupByBarcode(result)}
      />
    </div>
  );
}

/**
 * The matches under a customer box.
 *
 * Shows what the cashier needs to tell two Rahims apart — the phone
 * number — and what the sale needs to know about them: the balance
 * they are carrying. Someone with dues outstanding is exactly who you
 * want to notice before ringing up another credit sale.
 */
function CustomerHits({
  show,
  hits,
  looking,
  onPick,
  onDismiss,
}: {
  show: boolean;
  hits: {
    id: number;
    name: string;
    phone_number: string | null;
    email: string | null;
    dues: number | null;
  }[];
  looking: boolean;
  onPick: (hit: any) => void;
  onDismiss: () => void;
}) {
  if (!show) return null;
  if (looking && hits.length === 0) return null;

  return (
    <>
      {/* Clicking anywhere else puts the list away. Behind the list, so
          a click ON a name still reaches the name. */}
      <div className="fixed inset-0 z-10" onClick={onDismiss} aria-hidden />
      <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
        {hits.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-muted-foreground">
            No customer matches that. Type the rest; they are saved when the sale is completed.
          </p>
        ) : (
          hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => onPick(h)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{h.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {h.phone_number || "no number"}
                  {h.email ? ` · ${h.email}` : ""}
                </span>
              </span>
              {Number(h.dues ?? 0) > 0 && (
                <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                  ৳{Number(h.dues).toLocaleString("en-BD")} due
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </>
  );
}
