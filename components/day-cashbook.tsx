"use client";

import { useState, useEffect } from "react";
import { Calendar, Printer, RefreshCw, Lock, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/utils/supabase/component";
import { incomeTypeLabel, isMissingCustomType } from "@/lib/income-type";
import { useShopLabels } from "@/hooks/use-shop-labels";
import { labelFor } from "@/lib/shop-labels";
import { EXPENSE_HEADS } from "@/lib/expense-categories";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/components/role-provider"
import { useLinkedShops } from "@/hooks/use-linked-shops"
import { shopHeader } from "@/lib/utils/shop-header";
import { ManagerAccessBadge } from "@/components/role-badge"
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const supabase = createClient();

type CashbookEntry = {
  particulars: string;
  debit: number;
  credit: number;
  // Most lines here are arithmetic over sales and have no record behind
  // them to open. Only expenses and income are real rows, so only those
  // two carry a source and only those two are editable.
  source?: { table: "expenses" | "income_owner"; id: string };
  // Stable identifier for an adjustment to attach to. Labels get
  // reworded; this must not, or a correction would silently detach
  // from the line it was posted against.
  lineKey?: string;
  /** True when an owner correction replaced the computed figure. */
  adjusted?: boolean;
  adjustmentNote?: string | null;
};

/**
 * The shop a "stock received" expense came from, or null for an
 * ordinary expense.
 *
 * Matches exactly what scripts 60 and 62 write into the RECEIVING shop
 * when stock moves between linked shops: category 'other',
 * custom_category 'Stock Transfer', and a description of the form
 * "Stock from <sending shop>". Read here rather than corrected in SQL
 * so that transfers already recorded read the new way too.
 */
function stockTransferSource(expense: any): string | null {
  const head = String(expense?.custom_category ?? "").trim().toLowerCase();
  if (head !== "stock transfer") return null;
  // Plain string work, deliberately not a regular expression. The
  // first version of this used one and shipped with its backslashes
  // stripped — /^s*stock froms+(.+?)s*$/ — which matches nothing, so
  // every transfer fell through to the fallback and the shop saw
  // "Stock In - From another shop" instead of the sending shop's name.
  const text = String(expense?.description ?? "").trim();
  const PREFIX = "stock from";
  if (!text.toLowerCase().startsWith(PREFIX)) return "another shop";
  return text.slice(PREFIX.length).trim() || "another shop";
}

type CashbookData = {
  startDate: string;
  endDate: string;
  entries: CashbookEntry[];
  totalDebit: number;
  totalCredit: number;
  cashInHand: number;
};

export function DayCashbook() {
  const { toast } = useToast();
  const { currentShopId, shops, accountType } = useRole();
  const { nameOf: shopNameOf } = useLinkedShops();
  // The shop's own wording for the built-in income kinds, so this page
  // says what the Income screen says.
  const { labels } = useShopLabels();
  const isOwner = accountType === "owner";

  // ---- Opening balance (BFC baseline)
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineDate, setBaselineDate] = useState("");
  const [baselineAmount, setBaselineAmount] = useState("");
  const [baselineNote, setBaselineNote] = useState("");
  const [baselineSaving, setBaselineSaving] = useState(false);
  const [baselineHistory, setBaselineHistory] = useState<
    { id: number; effective_date: string; amount: number; note: string | null }[]
  >([]);
  // Reports print the shop's own letterhead, not a hard-coded one.
  const header = shopHeader(shops.find((s) => s.id === currentShopId));

  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);
  // Always on: the dates are always shown, and leaving them empty
  // shows every date -- which is all the old tick box did when off.
  const dateFilterEnabled = true;
  const [cashbookData, setCashbookData] = useState<CashbookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Check user authorization (only admin can edit)
  useEffect(() => {
    checkAuthorization();
  }, []);

  const checkAuthorization = async () => {
    try {
      const { data: userData, error } = await supabase.auth.getUser();
      if (error) throw error;

      setIsAuthorized(!!userData?.user);
    } catch (err) {
      console.error("Auth check error:", err);
      setIsAuthorized(false);
    }
  };

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return
    if (dateFilterEnabled) {
      if (startDate && endDate) {
        // Validate date range
        if (new Date(startDate) > new Date(endDate)) {
          setError("Start date cannot be after end date");
          return;
        }
        loadCashbookData(startDate, endDate);
      } else if (startDate && !endDate) {
        // Only start date - from that date to today
        loadCashbookData(startDate, today);
      } else if (!startDate && endDate) {
        // Only end date - from beginning to that date
        loadCashbookData("2000-01-01", endDate);
      } else {
        // No dates - show all time
        loadCashbookData("2000-01-01", today);
      }
    }
  }, [startDate, endDate, dateFilterEnabled, currentShopId]);

  // Get the date range description
  const getDateRangeDescription = () => {
    if (!dateFilterEnabled) return "Date filter disabled";
    if (!startDate && !endDate) return "All time";
    if (!startDate && endDate)
      return `All data up to ${new Date(endDate).toLocaleDateString("en-GB")}`;
    if (startDate && !endDate)
      return `From ${new Date(startDate).toLocaleDateString("en-GB")} onwards`;
    return `${new Date(startDate).toLocaleDateString("en-GB")} to ${new Date(
      endDate
    ).toLocaleDateString("en-GB")}`;
  };

  // ---- Owner: correcting a line without leaving the cashbook
  //
  // Deliberately edit-only. Deleting a record belongs on the Expenses
  // or Income page, where the totals it affects are on screen — here it
  // would silently remove a line from a day someone is reconciling.
  const [cbEdit, setCbEdit] = useState<CashbookEntry | null>(null);
  const [cbForm, setCbForm] = useState({
    description: "",
    amount: "",
    debit: "",
    credit: "",
    note: "",
  });
  const [cbSaving, setCbSaving] = useState(false);

  const openCashbookEdit = (entry: CashbookEntry) => {
    setCbEdit(entry);
    setCbForm({
      // The line reads "Category - description"; the record holds only
      // the description, so the label is trimmed back to it.
      description: entry.particulars.includes(" - ")
        ? entry.particulars.split(" - ").slice(1).join(" - ")
        : entry.particulars,
      amount: String(entry.debit !== 0 ? entry.debit : entry.credit),
      debit: entry.debit ? String(entry.debit) : "",
      credit: entry.credit ? String(entry.credit) : "",
      note: entry.adjustmentNote ?? "",
    });
  };

  /**
   * Save a correction.
   *
   * Two different jobs behind one button, because the lines are two
   * different kinds of thing:
   *
   *   expense / income  a real row — edit it, and the change shows on
   *                     its own page and in the Ledger too
   *   everything else   a SUM over sales — there is no row to edit, so
   *                     the owner's figure is stored as an adjustment
   *                     and applied on top. The sales underneath are
   *                     never rewritten: changing a sale to fix a
   *                     cashbook total would move stock, customer
   *                     balances and invoices already printed.
   */
  const saveCashbookEdit = async () => {
    if (!cbEdit || !currentShopId) return;

    setCbSaving(true);
    try {
      if (cbEdit.source) {
        const amount = Number(cbForm.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          toast({
            title: "Invalid amount",
            description: "Enter an amount greater than zero.",
            variant: "destructive",
          });
          return;
        }

        const { data, error } = await supabase
          .from(cbEdit.source.table)
          .update({
            description: cbForm.description.trim() || null,
            amount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cbEdit.source.id)
          .eq("organization_id", currentShopId)
          .select("id");

        if (error) throw error;

        // A row blocked by row-level security matches nothing and
        // returns no error, so without this the screen would report a
        // save that never happened.
        if (!data || data.length === 0) {
          toast({
            title: "Not allowed",
            description: "Only the shop owner can change these records.",
            variant: "destructive",
          });
          return;
        }
      } else {
        if (!cbEdit.lineKey) {
          toast({
            title: "Cannot correct this line",
            description: "This line has no identifier to attach a correction to.",
            variant: "destructive",
          });
          return;
        }

        const debit = Number(cbForm.debit || 0);
        const credit = Number(cbForm.credit || 0);
        if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
          toast({
            title: "Invalid figures",
            description: "Dr. and Cr. must be zero or more.",
            variant: "destructive",
          });
          return;
        }

        const { data: userData } = await supabase.auth.getUser();

        const { data, error } = await supabase
          .from("cashbook_adjustments")
          .upsert(
            {
              organization_id: currentShopId,
              entry_date: startDate,
              line_key: cbEdit.lineKey,
              debit,
              credit,
              note: cbForm.note.trim() || null,
              created_by: userData?.user?.id ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "organization_id,entry_date,line_key" }
          )
          .select("id");

        if (error) throw error;

        if (!data || data.length === 0) {
          toast({
            title: "Not allowed",
            description: "Only the shop owner can correct cashbook lines.",
            variant: "destructive",
          });
          return;
        }
      }

      toast({ title: "Cashbook updated" });
      setCbEdit(null);
      await loadCashbookData(startDate, endDate);
    } catch (err: any) {
      toast({
        title: "Could not save",
        description: err?.message ?? "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setCbSaving(false);
    }
  };

  const loadCashbookData = async (start: string, end: string) => {
    setLoading(true);
    setError(null);

    try {
      // Get BFC from the day before start date
      const prevDate = new Date(start);
      prevDate.setDate(prevDate.getDate() - 1);
      const previousDate = prevDate.toISOString().split("T")[0];

      // Initialize default data
      let salesData: {
        totalSalesAmount: number;
        cashAmount: number;
        bankAmount: number;
        duesAmount: number;
        duePaymentsCash: number;
        duePaymentsBank: number;
        transferCash: number;
        transferBank: number;
        transferDue: number;
        /** Per receiving shop, so each gets its own cashbook line. */
        byShop: Record<string, { cash: number; bank: number; total: number }>;
      } = {
        totalSalesAmount: 0,
        cashAmount: 0,
        bankAmount: 0,
        duesAmount: 0,
        duePaymentsCash: 0,
        duePaymentsBank: 0,
        transferCash: 0,
        transferBank: 0,
        transferDue: 0,
        byShop: {},
      };
      let purchaseData = { totalAmount: 0, numPurchases: 0 };
      let returnsData = { salesReturns: 0, purchaseReturns: 0 };
      let expensesData: {
        individualExpenses: any[];
      } = {
        individualExpenses: [],
      };
      let incomeData: {
        individualIncomes: any[];
      } = {
        individualIncomes: [],
      };
      let bfcAmount = 0;

      try {
        const results = await Promise.all([
          getSalesData(start, end).catch((err) => {
            console.warn("Sales data error:", err);
            return salesData;
          }),

          getReturnsData(start, end).catch((err) => {
            console.warn("Returns data error:", err);
            return returnsData;
          }),
          getExpensesData(start, end).catch((err) => {
            console.warn("Expenses data error:", err);
            return expensesData;
          }),
          getIncomeData(start, end).catch((err) => {
            console.warn("Income data error:", err);
            return incomeData;
          }),
          getPreviousBalance(previousDate).catch((err) => {
            console.warn("Previous balance error:", err);
            return 0;
          }),
        ]);

        salesData = results[0] || salesData;
        returnsData = results[1] || returnsData;
        expensesData = results[2] || expensesData;
        incomeData = results[3] || incomeData;
        bfcAmount = results[4] || 0;
      } catch (err) {
        console.error("Error loading data:", err);
      }

      // Build entries array
      const entries: CashbookEntry[] = [];

      // Add BFC entry (opening balance)
      //
      // Always on the debit side, whatever its sign. It used to move to
      // the credit column when the carried figure was below zero, and
      // the shop looks for its opening cash in one place.
      //
      // A negative therefore has to PRINT. The three cells below used to
      // read `entry.debit > 0`, which renders a negative as an empty
      // cell — so a shop opening the day short would have found the row
      // blank rather than moved. They test for non-zero now.
      //
      // Nothing else on this page is ever negative, so that is the only
      // row the change can affect. The totals are untouched either way:
      // cashInHand is totalDebit minus totalCredit, and a negative debit
      // carries the same weight as the positive credit it replaces.
      entries.push({
        particulars: "BFC (Brought Forward Cash)",
        lineKey: "bfc",
        debit: bfcAmount,
        credit: 0,
      });

      // Total Sale — the full invoice value of the day's sales.
      //
      // Label only. lineKey stays "cash_sales": it is what any
      // correction already posted against this line is attached to,
      // and renaming it would silently detach them.
      if (salesData.totalSalesAmount > 0) {
        entries.push({
          particulars: "Total Sale",
          lineKey: "cash_sales",
          debit: salesData.totalSalesAmount,
          credit: 0,
        });
      }

      // Money taken to clear an outstanding balance.
      //
      // A due settlement is recorded with a sale value of zero — it is
      // a payment, not revenue — so it contributes nothing to Cash
      // Sales above. Without this line, cash handed over the counter to
      // pay off a debt never appeared in the cash book at all.
      if (salesData.duePaymentsCash > 0) {
        entries.push({
          particulars: "Due Payments Received",
          lineKey: "due_payments",
          debit: salesData.duePaymentsCash,
          credit: 0,
        });
      }

      // UPDATED: Bank/Digital Payments (money goes to bank, not cash in hand - CREDIT)
      //
      // Settlements are excluded: their value is not in Cash Sales, so
      // crediting their bank portion here would push cash in hand DOWN
      // when a customer settled a debt by bKash.
      if (salesData.bankAmount - salesData.duePaymentsBank > 0) {
        entries.push({
          // Includes the bank portion of shop transfers: that money did
          // not reach the till either, so it is credited here with the
          // rest rather than a second time under the shop's own line.
          particulars: "Bank/Digital Payments",
          lineKey: "bank_digital",
          debit: 0,
          credit: salesData.bankAmount - salesData.duePaymentsBank,
        });
      }

      // Sales on Credit (Due) — the part of a sale not yet collected.
      //
      // Cash Sales above is booked at the full invoice value, so a sale
      // made partly on credit would otherwise look like it was paid in
      // full. This credits back the uncollected portion; it is re-added
      // as "Due Payments Received" once the customer actually pays it.
      if (salesData.duesAmount > 0) {
        entries.push({
          particulars: "Sales on Credit (Due)",
          lineKey: "sales_credit",
          debit: 0,
          credit: salesData.duesAmount,
        });
      }

      // Stock sent to sister shops, at cost.
      //
      // Read from the point of view of the shop whose book this is:
      // "Stock Out - To Star Power 02" here, and the same movement
      // appears as "Stock In - From Star Power 01" in the other shop's
      // book. It used to be named the same way round in both books
      // ("Star Power 01 to Star Power 02"), which left the reader to
      // work out which end they were looking at.
      //
      // Kept out of Cash Sales above because it is not trade: the money
      // is real and belongs in the day, but counting it as revenue
      // would overstate what the shop sold.
      for (const [shopId, figures] of Object.entries(salesData.byShop ?? {})) {
        const t = figures as { cash: number; bank: number; total: number };
        const receivingShopName = shopNameOf(shopId);

        entries.push({
          particulars: `Stock Out - To ${receivingShopName}`,
          // Only the cash reached the till. The bank portion is
          // credited below with every other bank receipt, and anything
          // unpaid is owed rather than received.
          debit: t.cash,
          credit: 0,
          lineKey: `transfer_${shopId}`,
        });
      }

      if (salesData.transferDue > 0) {
        entries.push({
          particulars: "Shop Transfers on Credit",
          debit: 0,
          credit: salesData.transferDue,
          lineKey: "transfer_credit",
        });
      }

      // Purchase Returns (money/credit coming back from suppliers)
      if (returnsData.purchaseReturns > 0) {
        entries.push({
          particulars: "Purchase Returns",
          lineKey: "purchase_returns",
          debit: returnsData.purchaseReturns,
          credit: 0,
        });
      }

      // Income: one line per kind and destination, with the total.
      //
      // Owner Invest arrives in several pieces — as stock, as opening
      // cash, as top-ups — and each printed its own line. The shop wants
      // one figure for what the owner put in, so "Owner Invest (Cash)" is
      // one line however many rows are behind it. Cash and Bank stay
      // apart, because they land in different places.
      //
      // Supplier income is the exception: the description IS the
      // supplier, so it is kept one line per supplier, as supplier
      // payments are on the expense side.
      //
      // A single row keeps its own line and pencil; several become a
      // total carrying a lineKey. See the expenses below.
      const incomeSlug = (t: string) =>
        t.trim().toLowerCase().split(" ").filter(Boolean).join("_");
      const incomes: any[] = incomeData.individualIncomes ?? [];
      const incomeHead = (i: any) =>
        `${incomeTypeLabel(i.income_type, i.custom_type, labels)} (${
          i.destination_type === "bank" ? "Bank" : "Cash"
        })`;
      const incomeGroupOf = (i: any) =>
        `income_${incomeSlug(incomeHead(i))}` +
        (i.income_type === "party_income"
          ? `_${incomeSlug(String(i.description ?? ""))}`
          : "");

      const incomesByGroup = new Map<string, any[]>();
      for (const i of incomes) {
        const key = incomeGroupOf(i);
        const list = incomesByGroup.get(key);
        if (list) list.push(i);
        else incomesByGroup.set(key, [i]);
      }
      const printedIncome = new Set<string>();

      incomes.forEach((income: any) => {
        const key = incomeGroupOf(income);
        const group = incomesByGroup.get(key) ?? [income];
        const head = incomeHead(income);
        const description = income.description ? ` - ${income.description}` : "";

        if (group.length > 1) {
          if (printedIncome.has(key)) return;
          printedIncome.add(key);
          entries.push({
            particulars:
              income.income_type === "party_income" ? `${head}${description}` : head,
            debit: group.reduce((t, i) => t + (Number(i.amount) || 0), 0),
            credit: 0,
            lineKey: key,
          });
          return;
        }

        entries.push({
          particulars: `${head}${description}`,
          debit: income.amount || 0,
          credit: 0,
          source: income.id ? { table: "income_owner", id: String(income.id) } : undefined,
        });
      });

      // Sales Returns (refunds paid to customers)
      if (returnsData.salesReturns > 0) {
        entries.push({
          particulars: "Sales Returns (Refunds)",
          lineKey: "sales_returns",
          debit: 0,
          credit: returnsData.salesReturns,
        });
      }

      // Stock received from a sister shop — one line per sending shop.
      //
      // A transfer writes ONE expense row, so a day with three
      // deliveries from the same shop listed three near-identical
      // lines. The shop reads that as a single movement between two
      // shops and wants one figure for it.
      //
      // No `source`, because there is no single expense row behind the
      // total for the pencil to open. It carries a lineKey instead,
      // which is how every other computed line on this page is
      // corrected, and matches the outgoing side above.
      const stockInBySource = new Map<string, number>();
      const plainExpenses: any[] = [];

      for (const expense of expensesData.individualExpenses ?? []) {
        const from = stockTransferSource(expense);
        if (from) {
          stockInBySource.set(
            from,
            (stockInBySource.get(from) ?? 0) + (Number(expense.amount) || 0),
          );
        } else {
          plainExpenses.push(expense);
        }
      }

      for (const [from, amount] of stockInBySource) {
        entries.push({
          particulars: `Stock In - From ${from}`,
          debit: 0,
          credit: amount,
          // Split on spaces rather than a regular expression: the one
          // here shipped as /s+/ with its backslash lost, which replaced
          // the letter "s" instead of the spaces.
          lineKey: `transfer_in_${from.toLowerCase().split(" ").filter(Boolean).join("_")}`,
        });
      }

      // Expenses: one line per head, with the total.
      //
      // Entertainment, tea, poly and the rest are paid a little at a
      // time, and a line for each printed as a column of near-identical
      // rows. The shop reads the day by head, so each head is one line
      // with the day's total.
      //
      // Supplier payments are the exception to "by head": they are
      // grouped per supplier, by the name the line prints, because the
      // shop wants to see what each supplier was paid. Trimmed and
      // case-folded, so "Ismartu" and "ismartu " are one supplier.
      //
      // A head with ONE row keeps its own line, pencil and all: that
      // row is a real expense and can still be opened. Only when there
      // are several does it become a total, which has no single row
      // behind it to open, so it carries a lineKey instead — the same
      // way every other computed line on this page is corrected.
      //
      // Grouped by what the line prints (the shop's own wording for the
      // head, or the custom head typed on the expense), so two heads
      // that read the same are one line.
      const slug = (t: string) =>
        t.trim().toLowerCase().split(" ").filter(Boolean).join("_");
      const supplierName = (e: any) => String(e.description ?? "").trim();
      // Was printing the raw column — "party_payment - Ismartu
      // Technology Bd Ltd" — instead of the shop's own wording.
      const SUPPLIER_PAYMENT_HEAD = labelFor(
        labels,
        "expense_category",
        "party_payment",
        EXPENSE_HEADS.party_payment || "Supplier Payment",
      );
      const headOf = (e: any) =>
        (e.custom_category || "").trim() ||
        labelFor(
          labels,
          "expense_category",
          e.category,
          EXPENSE_HEADS[e.category] || e.category || "Other",
        );
      // Money handed over as the voucher was written. The shop asked
      // for it to be named apart from a payment made later, so it gets
      // its own wording and its own line: a supplier paid both ways on
      // one day shows "Supplier Payment - X" and "Supplier Payment
      // Instant - X", never the two added together.
      const isInstant = (e: any) =>
        e.category === "party_payment" && e.paidWithVoucher === true;
      const supplierHead = (e: any) =>
        isInstant(e) ? `${SUPPLIER_PAYMENT_HEAD} Instant` : SUPPLIER_PAYMENT_HEAD;
      const groupOf = (e: any) =>
        e.category === "party_payment"
          ? `supplier_payment_${isInstant(e) ? "instant_" : ""}${slug(supplierName(e))}`
          : `expense_${slug(headOf(e))}`;

      const expensesByGroup = new Map<string, any[]>();
      for (const e of plainExpenses) {
        const key = groupOf(e);
        const list = expensesByGroup.get(key);
        if (list) list.push(e);
        else expensesByGroup.set(key, [e]);
      }
      const printedGroup = new Set<string>();

      plainExpenses.forEach((expense: any) => {
        const key = groupOf(expense);
        const group = expensesByGroup.get(key) ?? [expense];
        const isSupplier = expense.category === "party_payment";
        const head = isSupplier ? supplierHead(expense) : headOf(expense);

        if (group.length > 1) {
          // Printed once, where that group's first row falls.
          if (printedGroup.has(key)) return;
          printedGroup.add(key);
          entries.push({
            particulars: isSupplier ? `${head} - ${supplierName(expense)}` : head,
            debit: 0,
            credit: group.reduce((t, e) => t + (Number(e.amount) || 0), 0),
            lineKey: key,
          });
          return;
        }

        entries.push({
          particulars: `${head} - ${expense.description}`,
          debit: 0,
          credit: expense.amount || 0,
          source: expense.id ? { table: "expenses", id: String(expense.id) } : undefined,
        });
      });

      // Owner corrections to computed lines.
      //
      // Applied here, on top of what was just calculated, so the source
      // sales are never rewritten to make a total come out differently.
      // Only for a single day: an adjustment is posted against one
      // date, and spreading it over a range would double-count it.
      if (start === end) {
        const { data: adjustments } = await supabase
          .from("cashbook_adjustments")
          .select("line_key, debit, credit, note")
          .eq("organization_id", currentShopId)
          .eq("entry_date", start);

        for (const adj of adjustments ?? []) {
          const target = entries.find((e) => e.lineKey === adj.line_key);
          if (!target) continue;
          target.debit = Number(adj.debit ?? 0);
          target.credit = Number(adj.credit ?? 0);
          target.adjusted = true;
          target.adjustmentNote = adj.note ?? null;
        }
      }

      // Calculate totals
      const totalDebit = entries.reduce((sum, entry) => sum + entry.debit, 0);
      const totalCredit = entries.reduce((sum, entry) => sum + entry.credit, 0);
      // Same rule as the brought-forward figure above: this IS
      // tomorrow's BFC, so the two have to agree about the floor.
      //
      // Where it bites, Dr minus Cr will be less than the Cash in Hand
      // printed under it, by exactly what the books are short. Setting
      // the shop's opening balance is what removes the gap properly.
      const cashInHand = Math.max(0, totalDebit - totalCredit);

      const data: CashbookData = {
        startDate: start,
        endDate: end,
        entries: entries,
        totalDebit: totalDebit,
        totalCredit: totalCredit,
        cashInHand: cashInHand,
      };

      setCashbookData(data);
    } catch (err: any) {
      console.error("Error loading cashbook data:", err);
      setError(err.message || "Failed to load cashbook data");
      toast({
        title: "Error",
        description: "Failed to load cashbook data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getSalesData = async (start: string, end: string) => {
    try {
      const { data, error } = await supabase
        .from("sales")
        .select(
          `
          id, 
          total_amount, 
          cash_received, 
          card_received, 
          bank_transfer_received, 
          bkash_received, 
          nagad_received, 
          rocket_received, 
          upay_received, 
          due_amount, 
          transfer_to_org_id,
          invoice_number
        `
        )
        .eq("organization_id", currentShopId)
        // sale_date, not created_at: a sale made on a day the shop was
        // closed and entered two mornings later belongs on the day it
        // was MADE. created_at stays the moment it was typed in, which
        // is what makes a backdated sale identifiable afterwards.
        //
        // Every sale recorded before dating existed was written with
        // sale_date = created_at, so no figure already printed moves.
        .gte("sale_date", start)
        .lte("sale_date", `${end}T23:59:59.999Z`)
        .eq("status", "completed");

      if (error) {
        console.error("Sales data error:", error);
        throw error;
      }

      const sales = data || [];

      const totals = sales.reduce(
        (acc, sale) => {
          const totalAmount = sale.total_amount || 0;
          const cashAmount = sale.cash_received || 0;
          const bankAmount =
            (sale.card_received || 0) +
            (sale.bank_transfer_received || 0) +
            (sale.bkash_received || 0) +
            (sale.nagad_received || 0) +
            (sale.rocket_received || 0) +
            (sale.upay_received || 0);
          const duesAmount = sale.due_amount || 0;

          // A due settlement is a payment against an old balance, not a
          // sale, so it is recorded with a sale value of zero. That is
          // what tells the two apart here.
          const isSettlement = totalAmount === 0 && cashAmount + bankAmount > 0;

          // Stock sent to a sister shop at cost. Real money, so it
          // belongs in the day's cash — but it is NOT trade, so it is
          // kept out of Cash Sales and given its own line. Counting it
          // in both would double the day's takings.
          const transferTo: string | null = sale.transfer_to_org_id ?? null;
          const isTransfer = !!transferTo;

          const shopTotals = { ...acc.byShop };
          if (isTransfer) {
            const prev = shopTotals[transferTo] ?? { cash: 0, bank: 0, total: 0 };
            shopTotals[transferTo] = {
              cash: prev.cash + cashAmount,
              bank: prev.bank + bankAmount,
              total: prev.total + totalAmount,
            };
          }

          return {
            // Transfers excluded: they are stock moved at cost between
            // the owner's own shops, not revenue.
            totalSalesAmount: acc.totalSalesAmount + (isTransfer ? 0 : totalAmount),
            cashAmount: acc.cashAmount + cashAmount,
            bankAmount: acc.bankAmount + bankAmount,
            duesAmount: acc.duesAmount + (isTransfer ? 0 : duesAmount),
            duePaymentsCash: acc.duePaymentsCash + (isSettlement ? cashAmount : 0),
            duePaymentsBank: acc.duePaymentsBank + (isSettlement ? bankAmount : 0),
            transferCash: acc.transferCash + (isTransfer ? cashAmount : 0),
            transferBank: acc.transferBank + (isTransfer ? bankAmount : 0),
            transferDue: acc.transferDue + (isTransfer ? duesAmount : 0),
            byShop: shopTotals,
          };
        },
        {
          totalSalesAmount: 0,
          cashAmount: 0,
          bankAmount: 0,
          duesAmount: 0,
          duePaymentsCash: 0,
          duePaymentsBank: 0,
          transferCash: 0,
          transferBank: 0,
          transferDue: 0,
          byShop: {} as Record<string, { cash: number; bank: number; total: number }>,
        }
      );

      return totals;
    } catch (error) {
      console.error("getSalesData error:", error);
      return {
        totalSalesAmount: 0,
        cashAmount: 0,
        bankAmount: 0,
        duesAmount: 0,
        duePaymentsCash: 0,
        duePaymentsBank: 0,
        transferCash: 0,
        transferBank: 0,
        transferDue: 0,
        byShop: {} as Record<string, { cash: number; bank: number; total: number }>,
      };
    }
  };

  // const getPurchaseData = async (start: string, end: string) => {
  //   try {
  //     const { data, error } = await supabase
  //       .from("purchases")
  //       .select(`
  //         id,
  //         cost_price,
  //         color_variants(purchase_id)
  //       `)
  //       .gte("created_at", start)
  //       .lte("created_at", `${end}T23:59:59.999Z`)

  //     if (error) {
  //       console.error("Purchase data error:", error)
  //       return { totalAmount: 0, numPurchases: 0 }
  //     }

  //     // Count total color_variants (products)
  //     let numPurchases = data.flatMap(p => p.color_variants ?? []).length

  //     // Calculate total amount: cost_price × number of variants for each purchase
  //     const totalAmount = data.reduce((sum, purchase) => {
  //       const numVariants = purchase.color_variants?.length ?? 0
  //       const costPrice = purchase.cost_price ?? 0
  //       return sum + (costPrice * numVariants)
  //     }, 0)

  //     return { totalAmount, numPurchases }
  //   } catch (error) {
  //     console.error("getPurchaseData error:", error)
  //     return { totalAmount: 0, numPurchases: 0 }
  //   }
  // }

  const getReturnsData = async (start: string, end: string) => {
    try {
      const [salesReturnsResult, purchaseReturnsResult] = await Promise.all([
        supabase
          .from("sales_returns")
          .select("total_refund_amount")
          .eq("organization_id", currentShopId)
          .gte("return_date", start)
          .lte("return_date", `${end}T23:59:59.999Z`)
          .eq("status", "processed")
          .then((result) => (result.error ? { data: [] } : result)),
        supabase
          .from("purchase_returns")
          .select("total_credit_amount")
          .eq("organization_id", currentShopId)
          .gte("return_date", start)
          .lte("return_date", end)
          .eq("status", "processed")
          .then((result) => (result.error ? { data: [] } : result)),
      ]);

      const salesReturns = (salesReturnsResult.data || []).reduce(
        (sum, ret) => sum + (ret.total_refund_amount || 0),
        0
      );

      const purchaseReturns = (purchaseReturnsResult.data || []).reduce(
        (sum, ret) => sum + (ret.total_credit_amount || 0),
        0
      );

      return {
        salesReturns,
        purchaseReturns,
      };
    } catch (error) {
      console.error("getReturnsData error:", error);
      return { salesReturns: 0, purchaseReturns: 0 };
    }
  };

  const getExpensesData = async (start: string, end: string) => {
    try {
      const read = (columns: string) =>
        supabase
          .from("expenses")
          .select(columns)
          .eq("organization_id", currentShopId)
          .gte("date", start)
          .lte("date", end)
          .order("created_at", { ascending: true });

      const COLUMNS = "id, amount, category, custom_category, description, created_at";

      // paid_with_voucher_id arrives with script 90 and marks the money
      // handed over as the voucher was written. A shop that has not run
      // the migration has no such payments to name, so the plain read is
      // the right answer there rather than an empty day.
      let { data, error } = await read(`${COLUMNS}, paid_with_voucher_id`);
      if (error) {
        ({ data, error } = await read(COLUMNS));
      }

      if (error) {
        console.error("Expenses data error:", error);
        return { individualExpenses: [] };
      }

      const expenses = (data || []) as any[];

      const individualExpenses = expenses.map((expense) => ({
        id: expense.id,
        amount: expense.amount || 0,
        category: expense.category || "Other",
        custom_category: expense.custom_category,
        description: expense.description || "No description",
        created_at: expense.created_at,
        paidWithVoucher: expense.paid_with_voucher_id != null,
      }));

      return { individualExpenses };
    } catch (error) {
      console.error("getExpensesData error:", error);
      return { individualExpenses: [] };
    }
  };

  const getIncomeData = async (start: string, end: string) => {
    try {
      // custom_type arrives with script 67. The app can update before
      // the migration is applied, so drop back to the columns that were
      // always there rather than showing the day with no income on it.
      // Written as two whole calls rather than one with the column
      // list switched: supabase-js parses the select string at the type
      // level, so anything but a literal comes back as a parse error
      // instead of a row type.
      const scoped = (q: any) =>
        q
          .eq("organization_id", currentShopId)
          .gte("date", start)
          .lte("date", end)
          .order("created_at", { ascending: true });

      let { data, error }: { data: any[] | null; error: any } = await scoped(
        supabase
          .from("income_owner")
          .select(
            "id, amount, income_type, custom_type, destination_type, description, created_at"
          )
      );

      if (error && isMissingCustomType(error)) {
        ({ data, error } = await scoped(
          supabase
            .from("income_owner")
            .select("id, amount, income_type, destination_type, description, created_at")
        ));
      }

      if (error) {
        console.error(
          "Income data error:",
          error?.message ?? error,
          error?.code ? `(${error.code})` : ""
        );
        return { individualIncomes: [] };
      }

      const incomes = data || [];

      const individualIncomes = incomes.map((income: any) => ({
        id: income.id,
        amount: income.amount || 0,
        income_type: income.income_type || "owner_income",
        custom_type: income.custom_type ?? null,
        destination_type: income.destination_type || "cash",
        description: income.description || "",
        created_at: income.created_at,
      }));

      return { individualIncomes };
    } catch (error) {
      console.error("getIncomeData error:", error);
      return { individualIncomes: [] };
    }
  };

  const loadBaselineHistory = async () => {
    if (!currentShopId) return;
    const { data } = await supabase
      .from("cashbook_opening_balances")
      .select("id, effective_date, amount, note")
      .eq("organization_id", currentShopId)
      .order("effective_date", { ascending: false })
      .limit(20);
    setBaselineHistory((data ?? []) as any);
  };

  const openBaselineDialog = () => {
    setBaselineDate(startDate || today);
    setBaselineAmount("");
    setBaselineNote("");
    setShowBaseline(true);
    loadBaselineHistory();
  };

  /**
   * Record what was actually in the drawer on a given morning.
   *
   * Upserted on (organization, date) so setting the same day twice
   * corrects the figure rather than leaving two baselines for the
   * reports to choose between.
   */
  const saveBaseline = async () => {
    if (!currentShopId) return;

    const amount = Number(baselineAmount);
    if (!baselineDate) {
      toast({ title: "Pick a date", description: "Choose the day this balance applies from.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amount)) {
      toast({ title: "Enter an amount", description: "The opening balance must be a number.", variant: "destructive" });
      return;
    }

    setBaselineSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("cashbook_opening_balances")
        .upsert(
          {
            organization_id: currentShopId,
            effective_date: baselineDate,
            amount,
            note: baselineNote.trim() || null,
            created_by: userData?.user?.id ?? null,
          },
          { onConflict: "organization_id,effective_date" }
        );

      if (error) throw error;

      toast({
        title: "Opening balance set",
        description: `৳${amount.toFixed(2)} from ${baselineDate}. The cashbook now counts forward from there.`,
      });
      setShowBaseline(false);
      loadCashbookData(startDate || "2000-01-01", endDate || today);
    } catch (e: any) {
      toast({
        title: "Could not save",
        description:
          e?.code === "42501" || /row-level security/i.test(e?.message ?? "")
            ? "Only the shop owner can set the opening balance."
            : e?.message ?? "The opening balance could not be saved.",
        variant: "destructive",
      });
    } finally {
      setBaselineSaving(false);
    }
  };

  const getPreviousBalance = async (date: string) => {
    try {
      // Start from the owner's most recent baseline rather than from
      // the beginning of time.
      //
      // A shop adopting this software already had cash in the drawer,
      // and none of that history is in the database. Adding up only
      // what the app has seen understates the opening balance by
      // whatever was there on day one — an error that is then carried
      // forward every single day.
      //
      // With a baseline set, only what happened since it counts. With
      // none set, this behaves exactly as before.
      const { data: baseline } = (await supabase
        .rpc("cashbook_baseline", {
          p_organization_id: currentShopId,
          p_date: date,
        })
        .maybeSingle()) as {
        data: { effective_date: string; amount: number } | null;
      };

      const from = baseline?.effective_date ?? "2000-01-01";
      const opening = Number(baseline?.amount ?? 0);

      const [salesResult, returnsResult, expensesResult, incomeResult] =
        await Promise.all([
          getSalesData(from, date),
          getReturnsData(from, date),
          getExpensesData(from, date),
          getIncomeData(from, date),
        ]);

      // Calculate total income amount
      const totalIncome = incomeResult.individualIncomes.reduce(
        (sum, income) => sum + income.amount,
        0
      );

      // Calculate total debits (money in) - EXCLUDING bankAmount
      //
      // cashAmount already includes the cash side of shop transfers, so
      // they carry forward like any other takings. Nothing to add here:
      // adding transferCash again would count that money twice in every
      // opening balance from then on.
      const totalDebits =
        salesResult.cashAmount + returnsResult.purchaseReturns + totalIncome;

      // duesAmount is deliberately NOT subtracted here.
      //
      // Selling on credit takes nothing out of the till, so subtracting
      // it made the carried-forward figure permanently lower than the
      // drawer: a 500 due showed -500 on the day of sale, then +500 when
      // paid, netting zero against a drawer that had genuinely gained
      // 500. Every unpaid sale compounded the gap.
      const totalCredits =
        returnsResult.salesReturns +
        expensesResult.individualExpenses.reduce(
          (sum, exp) => sum + exp.amount,
          0
        );

      // Cash in hand = opening + Dr - Cr, and never below zero.
      //
      // A drawer cannot hold negative cash, so the shop's rule is that
      // this figure is always positive. A computed negative means the
      // books are short of something — most often an opening balance
      // that was never set, sometimes a bank payment entered as cash —
      // not that the till owes money.
      return Math.max(0, opening + totalDebits - totalCredits);
    } catch (error) {
      console.error("getPreviousBalance error:", error);
      return 0;
    }
  };

  const handlePrint = () => {
    if (!cashbookData) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Preview did not open",
        description: "Allow pop-ups for this application, then try again.",
        variant: "destructive",
      });
      return;
    }
    const printContent = generatePrintContent();
    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  const generatePrintContent = () => {
    if (!cashbookData) return "";

    const formatDate = (date: string) => {
      return new Date(date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    };

    const formatAmount = (amount: number) => amount.toFixed(2);

    const dateRangeText = getDateRangeDescription();

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cash Book - ${dateRangeText}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 15px; 
            font-size: 12px;
          }
          .header { 
            text-align: center; 
            margin-bottom: 20px;
          }
          .company-name { 
            font-size: 16px; 
            font-weight: bold; 
            margin-bottom: 5px; 
          }
          .address { 
            font-size: 10px; 
            margin-bottom: 10px; 
          }
          .period {
            font-size: 11px;
            margin-bottom: 10px;
          }
          .title {
            border: 2px solid black;
            border-radius: 20px;
            padding: 5px 20px;
            display: inline-block;
            font-size: 14px;
            font-weight: bold;
          }
          .cashbook-table { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 20px 0;
            border: 2px solid black;
          }
          .cashbook-table th, 
          .cashbook-table td { 
            border: 1px solid black; 
            padding: 6px; 
            text-align: left; 
            font-size: 11px;
          }
          .cashbook-table th { 
            background-color: #f0f0f0; 
            font-weight: bold; 
            text-align: center;
          }
          .amount-cell { 
            text-align: right; 
            font-family: monospace;
          }
          .total-row { 
            font-weight: bold; 
            background-color: #f0f0f0;
            border-top: 2px solid black;
          }
          .cash-in-hand {
            text-align: center;
            font-size: 16px;
            font-weight: bold;
            margin-top: 20px;
          }
          @media print {
            body { margin: 10px; }
          }
        ${DOCUMENT_TOOLBAR_CSS}

        </style>
      </head>
      <body>

        ${documentToolbar("Cash Book")}
        <div class="header">
          <div class="company-name">${header.name}</div>
          <div class="address">${header.addressLine}</div>
          <div class="period">${dateRangeText}</div>
          <div class="title">CASH BOOK</div>
        </div>

        <table class="cashbook-table">
          <thead>
            <tr>
              <th style="width: 50%;">Particulars</th>
              <th style="width: 25%;">Dr.</th>
              <th style="width: 25%;">Cr.</th>
            </tr>
          </thead>
          <tbody>
            ${(cashbookData.entries || [])
              .map(
                (entry) => `
              <tr>
                <td>${entry.particulars}</td>
                <td class="amount-cell">${
                  entry.debit !== 0 || entry.lineKey === "bfc"
                    ? formatAmount(entry.debit)
                    : ""
                }</td>
                <td class="amount-cell">${
                  entry.credit !== 0 ? formatAmount(entry.credit) : ""
                }</td>
              </tr>
            `
              )
              .join("")}
            <tr class="total-row">
              <td></td>
              <td class="amount-cell">${formatAmount(
                cashbookData.totalDebit || 0
              )}</td>
              <td class="amount-cell">${formatAmount(
                cashbookData.totalCredit || 0
              )}</td>
            </tr>
          </tbody>
        </table>

        <div class="cash-in-hand">
          Cash In Hand &nbsp;&nbsp;&nbsp;&nbsp; ${formatAmount(
            cashbookData.cashInHand || 0
          )}
        </div>
      </body>
      </html>
    `;
  };

  const formatCurrency = (amount: number) => amount.toFixed(2);

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Cash Book</h1>
          <ManagerAccessBadge mode="view" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isAuthorized && (
            <div className="flex items-center text-amber-600 bg-amber-50 px-3 py-1 rounded-md">
              <Lock className="h-4 w-4 mr-2" />
              Read Only
            </div>
          )}
          <Button
            variant="outline"
            onClick={() =>
              dateFilterEnabled &&
              loadCashbookData(startDate || "2000-01-01", endDate || today)
            }
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          {/* Owner only. A manager who could reset the opening balance
              could hide a shortfall by "correcting" it, so this is not
              theirs to touch — and the database refuses it too, not
              just this button. */}
          {isOwner && (
            <Button variant="outline" onClick={openBaselineDialog}>
              <Lock className="h-4 w-4 mr-2" />
              Opening Balance
            </Button>
          )}
          <Button onClick={handlePrint} disabled={!cashbookData}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {/* The dates, on one line */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <span className="flex items-center gap-1 text-sm font-medium">
            <Calendar className="h-4 w-4" />
            Dates
          </span>

          <>
              <Label htmlFor="start-date" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 w-40"
              />
              <Label htmlFor="end-date" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 w-40"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDate(today);
                  setEndDate(today);
                }}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
              >
                Clear
              </Button>
              <span className="text-xs text-muted-foreground">
                Showing: <span className="font-medium text-foreground">{getDateRangeDescription()}</span>
              </span>
          </>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200">
          <CardContent className="p-4">
            <div className="text-red-600 font-medium">Error: {error}</div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="p-8 text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading cashbook data...</p>
          </CardContent>
        </Card>
      )}

      {/* Main Cashbook */}
      {cashbookData && !loading && (
        <Card>
          <CardHeader className="text-center">
            <div className="space-y-2">
              <div className="text-xl font-bold">{header.name}</div>
              <div className="text-xs text-muted-foreground">{header.addressLine}</div>
              <div className="text-sm">{getDateRangeDescription()}</div>
              <div className="inline-block border-2 border-black rounded-full px-6 py-1 font-bold">
                CASH BOOK
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table
                className="w-full border-2 border-black"
                style={{ borderCollapse: "collapse" }}
              >
                <thead>
                  <tr className="bg-gray-100">
                    <th
                      className="border border-black px-3 py-2 text-center font-bold"
                      style={{ width: "50%" }}
                    >
                      Particulars
                    </th>
                    <th
                      className="border border-black px-3 py-2 text-center font-bold"
                      style={{ width: "25%" }}
                    >
                      Dr.
                    </th>
                    <th
                      className="border border-black px-3 py-2 text-center font-bold"
                      style={{ width: "25%" }}
                    >
                      Cr.
                    </th>
                  </tr>
                </thead>
                <tbody className="zebra">
                  {(cashbookData?.entries || []).map((entry, index) => (
                    <tr key={index}>
                      <td className="border border-black px-3 py-1 text-sm">
                        <span className="inline-flex items-center gap-2">
                          {entry.particulars}
                          {/* Only expense and income lines are real
                              records. Every other line is a total over
                              sales — there is nothing to open, so no
                              button appears rather than one that fails.
                              No delete here by design: removing a record
                              belongs on its own page, where the figures
                              it affects are in view. */}
                          {entry.adjusted && (
                            <span
                              title={entry.adjustmentNote || "Corrected by the owner"}
                              className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                            >
                              corrected
                            </span>
                          )}
                          {/* An expense or income line is a real row and
                              can be corrected from any view, single day
                              or range — the edit goes to the record
                              itself and needs no date.

                              A computed line has no row behind it, so a
                              correction is stored against ONE date and
                              replaces that day's figure. Over a range
                              there is no single day to attach it to, and
                              applying one day's replacement to a
                              multi-day total would throw the other days
                              away. Hidden there rather than shown and
                              quietly wrong; the note under the table
                              says why. */}
                          {isOwner &&
                            (entry.source || (entry.lineKey && startDate === endDate)) && (
                              <button
                                type="button"
                                title="Correct this entry"
                                onClick={() => openCashbookEdit(entry)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                        </span>
                      </td>
                      <td className="border border-black px-3 py-1 text-right text-sm font-mono">
                        {entry.debit !== 0 || entry.lineKey === "bfc"
                          ? formatCurrency(entry.debit)
                          : ""}
                      </td>
                      <td className="border border-black px-3 py-1 text-right text-sm font-mono">
                        {entry.credit !== 0 ? formatCurrency(entry.credit) : ""}
                      </td>
                    </tr>
                  ))}

                  {/* Total Row */}
                  <tr className="bg-gray-100 font-bold border-t-2 border-black">
                    <td className="border border-black px-3 py-2"></td>
                    <td className="border border-black px-3 py-2 text-right font-mono">
                      {formatCurrency(cashbookData?.totalDebit || 0)}
                    </td>
                    <td className="border border-black px-3 py-2 text-right font-mono">
                      {formatCurrency(cashbookData?.totalCredit || 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Why half the pencils are missing on a range. Without
                this the owner sees an uneditable page and no reason
                for it. */}
            {isOwner && startDate !== endDate && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Expense and income lines can be corrected from here. Sales
                figures are added up across {getDateRangeDescription().toLowerCase()},
                so a correction to one has to be posted against a single day —
                set From and To to the same date to edit those.
              </p>
            )}

            {/* Cash In Hand */}
            <div className="text-center mt-8 text-xl font-bold">
              Cash In Hand &nbsp;&nbsp;&nbsp;&nbsp;{" "}
              {formatCurrency(cashbookData?.cashInHand || 0)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Owner-only: what was in the drawer on a given morning. */}
      <Dialog open={showBaseline} onOpenChange={setShowBaseline}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Opening balance</DialogTitle>
            <DialogDescription>
              What was actually in the drawer at the start of a day. The cashbook
              counts forward from the most recent one of these, instead of assuming
              the shop started with nothing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="baseline-date">Applies from</Label>
                <Input
                  id="baseline-date"
                  type="date"
                  value={baselineDate}
                  onChange={(e) => setBaselineDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="baseline-amount">Cash in drawer (৳)</Label>
                <Input
                  id="baseline-amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={baselineAmount}
                  onChange={(e) => setBaselineAmount(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="baseline-note">Reason (optional)</Label>
              <Input
                id="baseline-note"
                placeholder="e.g. Cash counted at close of business"
                value={baselineNote}
                onChange={(e) => setBaselineNote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A figure nobody can explain later is worse than none — especially a
                correction.
              </p>
            </div>

            {baselineHistory.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Previously set</Label>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {baselineHistory.map((b) => (
                    <div key={b.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{b.effective_date}</span>
                      <span className="font-medium">{formatCurrency(Number(b.amount))}</span>
                      <span className="flex-1 truncate text-xs text-muted-foreground">
                        {b.note ?? ""}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Setting the same date again replaces that figure. Earlier ones are
                  kept so a change stays explainable.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBaseline(false)} disabled={baselineSaving}>
              Cancel
            </Button>
            <Button onClick={saveBaseline} disabled={baselineSaving}>
              {baselineSaving ? "Saving…" : "Save opening balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Correct an expense or income line in place. No delete: that
          belongs on the page that owns the record. */}
      <Dialog open={!!cbEdit} onOpenChange={(open) => !open && setCbEdit(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {cbEdit?.source
                ? `Correct ${cbEdit.source.table === "expenses" ? "expense" : "income"}`
                : `Correct "${cbEdit?.particulars}"`}
            </DialogTitle>
            <DialogDescription>
              {cbEdit?.source
                ? `Changes the underlying record, so it updates on the ${
                    cbEdit.source.table === "expenses" ? "Expenses" : "Income"
                  } page and in the Ledger too.`
                : "This line is a total worked out from sales, so there is no single record to change. Your figures are stored as a correction for this day and applied on top — the sales, stock and invoices underneath are left exactly as they are."}
            </DialogDescription>
          </DialogHeader>

          {cbEdit?.source ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="cb-desc">Description</Label>
                <Input
                  id="cb-desc"
                  value={cbForm.description}
                  onChange={(e) => setCbForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="cb-amount">Amount*</Label>
                <Input
                  id="cb-amount"
                  type="number"
                  step="0.01"
                  value={cbForm.amount}
                  onChange={(e) => setCbForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Calculated Dr.</span>
                  <span className="font-mono">{formatCurrency(cbEdit?.debit ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Calculated Cr.</span>
                  <span className="font-mono">{formatCurrency(cbEdit?.credit ?? 0)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cb-dr">Dr. should read</Label>
                  <Input
                    id="cb-dr"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={cbForm.debit}
                    onChange={(e) => setCbForm((f) => ({ ...f, debit: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="cb-cr">Cr. should read</Label>
                  <Input
                    id="cb-cr"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={cbForm.credit}
                    onChange={(e) => setCbForm((f) => ({ ...f, credit: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="cb-note">Reason</Label>
                <Input
                  id="cb-note"
                  placeholder="e.g. till count short by 500"
                  value={cbForm.note}
                  onChange={(e) => setCbForm((f) => ({ ...f, note: e.target.value }))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Shown against the corrected line. An unexplained change to a day&apos;s
                  takings is the first thing an accountant will ask about.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCbEdit(null)} disabled={cbSaving}>
              Cancel
            </Button>
            <Button onClick={saveCashbookEdit} disabled={cbSaving}>
              {cbSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
