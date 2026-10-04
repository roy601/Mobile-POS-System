"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Calendar, Printer, Download, Search, BookOpen, Loader2, RefreshCw } from "lucide-react"
import { createClient } from "@/utils/supabase/component"
import { incomeTypeLabel, isMissingCustomType } from "@/lib/income-type"
import { useShopLabels } from "@/hooks/use-shop-labels"
import { labelFor } from "@/lib/shop-labels"
import { EXPENSE_HEADS, STOCK_TRANSFER_CATEGORY } from "@/lib/expense-categories"
import { loadCashInHandAt } from "@/lib/cash-in-hand"
import { useRole } from "@/components/role-provider"
import { shopHeader } from "@/lib/utils/shop-header"
import {
  printPartyDues,
  printOwnExpense,
  printIncomeReport,
  printPurchaseLedger,
  type PartyDuesRow,
} from "@/lib/ledger-reports"
import { printProfitLoss, type ProfitLossData } from "@/lib/profit-loss-report"
import { linePromo } from "@/lib/promo"
import {
  printBalanceSheet,
  type BalanceSheetReportData,
  type OwnExpenseRow,
  type PartyPaymentRow,
  type PartyPurchaseRow,
  type SalesHistoryRow,
} from "@/lib/balance-sheet-report"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { ManagerAccessBadge } from "@/components/role-badge"
import { StatStrip } from "@/components/stat-strip"
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt"

const supabase = createClient()

type LedgerEntry = {
  id: string
  date: string
  description: string
  voucherType: string
  debit: number
  credit: number
  balance: number
  reference?: string
  supplier?: string
  customer?: string
}

type BalanceSheetData = {
  totalPurchaseAmount: number
  totalSalesAmount: number
  totalPartyPaymentAmount: number
  totalOwnExpenseAmount: number
  totalCustomerDuesReceiveAmount: number
  totalIncomeAmount: number
}

/**
 * PostgREST answers with at most 1000 rows and says nothing about the
 * ones it left behind, so a report over a busy month would quietly
 * foot short and look right doing it. Every query behind the printed
 * sheets goes through here.
 */
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}


/**
 * A supplier payment made before expenses carried a supplier_id has
 * only its description to say who was paid. Several wordings are in
 * the data, so several are tried.
 */
const supplierFromDescription = (description?: string | null): string | null => {
  const desc = (description || "").trim()
  if (!desc) return null

  const patterns = [
    /^Payment to\s+(.+?)(?:\s*-|$)/i,
    /^Paid to\s+(.+?)(?:\s*-|$)/i,
    /^(.+?)(?:\s*-\s*Payment|\s+Payment)/i,
  ]
  for (const re of patterns) {
    const match = desc.match(re)
    if (match?.[1]?.trim()) return match[1].trim()
  }

  const cleaned = desc
    .replace(/^(payment|paid|pay|to|from|for)\s+/gi, "")
    .split(/[-–—:,]/)[0]
    .trim()
  if (cleaned.length > 2) return cleaned

  return desc.length <= 50 ? desc : null
}

/** Everything that is not cash, added up the way the sales sheets do. */
const bankReceived = (s: Record<string, unknown>) =>
  (Number(s.card_received) || 0) +
  (Number(s.bank_transfer_received) || 0) +
  (Number(s.bkash_received) || 0) +
  (Number(s.nagad_received) || 0) +
  (Number(s.rocket_received) || 0) +
  (Number(s.upay_received) || 0)

/**
 * The name on the joined supplier record, and nothing else.
 *
 * Kept separate from supplierNameOf because guessing at a name from
 * free text is only ever right for a supplier PAYMENT, where the
 * description was written to say who was paid. Do it to an ordinary
 * expense and "Electricity for August" becomes a party name.
 */
const joinedSupplierName = (row: {
  suppliers?: { name?: string | null } | { name?: string | null }[] | null
}): string | null => {
  const joined = Array.isArray(row?.suppliers) ? row.suppliers[0] : row?.suppliers
  return joined?.name?.trim() || null
}

/** Two spellings of one supplier compare equal: case, edge and inner spaces. */
const supplierKey = (name: string) => name.trim().toLowerCase().split(" ").filter(Boolean).join(" ")

/**
 * The calendar day a date or timestamp falls on, in the shop's own time
 * zone, as "YYYY-MM-DD". A plain date ("2026-09-10") is already a day
 * and is returned as it is — parsing it would read it as midnight UTC.
 */
const localDay = (value: string | null | undefined) => {
  if (!value) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The day an expense or income happened: its own date, else when it was entered. */
const dayOf = (row: { date?: string | null; created_at?: string | null }) =>
  row.date || row.created_at || ""

/**
 * One head on the Expense or Income Voucher — "Salaries", "Owner
 * Invest" — with every row filed under it.
 */
type VoucherGroup = {
  key: string
  name: string
  total: number
  rows: any[]
}

/** Rows gathered under a label, alphabetical, each group oldest first. */
function groupVouchers(rows: any[], labelOf: (row: any) => string): VoucherGroup[] {
  const groups = new Map<string, VoucherGroup>()
  for (const row of rows) {
    const name = (labelOf(row) || "Other").trim() || "Other"
    const key = supplierKey(name)
    const g = groups.get(key)
    if (g) {
      g.rows.push(row)
      g.total += Number(row.amount) || 0
    } else {
      groups.set(key, { key, name, total: Number(row.amount) || 0, rows: [row] })
    }
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => localDay(dayOf(a)).localeCompare(localDay(dayOf(b))))
  }
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The Expense / Income Voucher summary: one row per head, like the
 * Purchase Ledger's one row per supplier. A month of expenses was a
 * wall of individual lines; the owner reads this page for the totals
 * and opens a head only when a figure needs explaining.
 */
function VoucherGroupTable({
  groups,
  headLabel,
  amountClass,
  emptyText,
  totalLabel,
  money,
  onOpen,
}: {
  groups: VoucherGroup[]
  headLabel: string
  amountClass: string
  emptyText: string
  totalLabel: string
  money: (n: number) => string
  onOpen: (key: string) => void
}) {
  const grand = groups.reduce((t, g) => t + g.total, 0)
  const count = groups.reduce((t, g) => t + g.rows.length, 0)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{headLabel}</TableHead>
          <TableHead>Transactions</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.length === 0 ? (
          <TableRow>
            <TableCell colSpan={3} className="text-center text-muted-foreground">
              {emptyText}
            </TableCell>
          </TableRow>
        ) : (
          <>
            {groups.map((g) => (
              <TableRow
                key={g.key}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onOpen(g.key)}
                title="Click to see every transaction"
              >
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {g.rows.length} {g.rows.length === 1 ? "transaction" : "transactions"}
                </TableCell>
                <TableCell className={`text-right font-medium ${amountClass}`}>
                  {money(g.total)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted font-bold">
              <TableCell>{totalLabel}</TableCell>
              <TableCell className="text-muted-foreground">
                {count} {count === 1 ? "transaction" : "transactions"}
              </TableCell>
              <TableCell className={`text-right ${amountClass}`}>{money(grand)}</TableCell>
            </TableRow>
          </>
        )}
      </TableBody>
    </Table>
  )
}

/** Every row behind one head, with a running total. */
function VoucherGroupDialog({
  group,
  description,
  amountClass,
  extra,
  money,
  onClose,
}: {
  group: VoucherGroup | null
  description: string
  amountClass: string
  /** A column between Description and Amount, e.g. Cash / Bank. */
  extra?: { label: string; value: (row: any) => string }
  money: (n: number) => string
  onClose: () => void
}) {
  let running = 0
  return (
    <Dialog open={group !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group?.name}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {group && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                {extra && <TableHead>{extra.label}</TableHead>}
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Running total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row, i) => {
                running += Number(row.amount) || 0
                return (
                  <TableRow key={row.id ?? i}>
                    <TableCell>{new Date(dayOf(row)).toLocaleDateString("en-GB")}</TableCell>
                    <TableCell>{row.description || "—"}</TableCell>
                    {extra && (
                      <TableCell>
                        <Badge variant="outline">{extra.value(row)}</Badge>
                      </TableCell>
                    )}
                    <TableCell className={`text-right ${amountClass}`}>
                      {money(Number(row.amount) || 0)}
                    </TableCell>
                    <TableCell className="text-right font-medium">{money(running)}</TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="bg-muted font-bold">
                <TableCell colSpan={extra ? 3 : 2}>
                  Total — {group.rows.length} {group.rows.length === 1 ? "transaction" : "transactions"}
                </TableCell>
                <TableCell className={`text-right ${amountClass}`}>{money(group.total)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The name to print for a supplier, whichever source has it. */
const supplierNameOf = (row: {
  suppliers?: { name?: string | null } | { name?: string | null }[] | null
  supplier?: string | null
  description?: string | null
}): string =>
  joinedSupplierName(row) ||
  row?.supplier ||
  supplierFromDescription(row?.description) ||
  "(no supplier)"

export function LedgerClient() {
  const { toast } = useToast()
  const { currentShopId, shops } = useRole()
  // Reports print the shop's own letterhead, not a hard-coded one.
  const header = shopHeader(shops.find((s) => s.id === currentShopId))
  // The shop's own wording for the built-in income kinds and expense
  // heads, so the ledger says what Income and Expenses say.
  const { labels } = useShopLabels()

  const today = new Date().toISOString().split('T')[0]
  
  const [startDate, setStartDate] = useState<string>(today)
  const [endDate, setEndDate] = useState<string>(today)
  // Always on: the dates are always shown, and leaving them empty
  // shows every date -- which is all the old tick box did when off.
  const dateFilterEnabled = true
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedSupplierPurchase, setSelectedSupplierPurchase] = useState<string>("all")
  // The supplier whose transactions are open in the popup, if any.
  const [openSupplier, setOpenSupplier] = useState<string | null>(null)
  // The expense head / income type open in its popup, if any.
  const [openExpenseGroup, setOpenExpenseGroup] = useState<string | null>(null)
  const [openIncomeGroup, setOpenIncomeGroup] = useState<string | null>(null)
  // "Filter by Category" / "Filter by Type" — a group key, or "all".
  const [expenseFilter, setExpenseFilter] = useState<string>("all")
  const [incomeFilter, setIncomeFilter] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [purchaseEntries, setPurchaseEntries] = useState<LedgerEntry[]>([])
  // Each supplier's own position the moment the period starts — what
  // they were owed (or overpaid) before any row in the table below.
  // Keyed by supplierKey, so a filter matches it the same way it
  // matches the rows.
  const [supplierOpeningBalances, setSupplierOpeningBalances] = useState<Map<string, number>>(new Map())
  const [balanceSheetData, setBalanceSheetData] = useState<BalanceSheetData | null>(null)
  
  // Store expense and income data for voucher tabs
  const [expensesResult, setExpensesResult] = useState<any>({ individualExpenses: [], totalAmount: 0, partyPaymentAmount: 0 })
  const [incomeResult, setIncomeResult] = useState<any>({ individualIncomes: [], totalAmount: 0 })
  
  const [cashbookBalance, setCashbookBalance] = useState<number>(0)
  // Cash in hand the day before the period opened. Worked out once
  // with the rest of the page — the Profit & Loss sheet needs it, and
  // it costs an all-time sweep to compute.
  const [openingCash, setOpeningCash] = useState<number>(0)
  // Only the FIRST load blanks the page. After that a reload keeps the
  // screen — including the date picker the owner is using — and updates
  // the figures in place, like every other page. Replacing the whole
  // page with a spinner on each date change unmounted the very input
  // being typed into, and read as the page refreshing itself.
  const [hasLoaded, setHasLoaded] = useState(false)
  // Each load takes a number. Picking dates quickly starts several, and
  // they do not finish in order; without this an older, slower answer
  // could land last and show figures for dates no longer selected.
  const loadSeq = useRef(0)
  const [printing, setPrinting] = useState<string | null>(null)

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) {
      setLoading(false)
      return
    }
    if (dateFilterEnabled) {
      let effectiveStart = startDate
      let effectiveEnd = endDate

      // Handle flexible dates
      if (!startDate && !endDate) {
        // No dates - use all time
        effectiveStart = '2000-01-01'
        effectiveEnd = today
      } else if (!startDate && endDate) {
        // Only end date - from beginning
        effectiveStart = '2000-01-01'
      } else if (startDate && !endDate) {
        // Only start date - to today
        effectiveEnd = today
      }

      if (new Date(effectiveStart) > new Date(effectiveEnd)) {
        setError("Start date cannot be after end date")
        return
      }
      // A short pause first. Typing a year into a date box passes
      // through 0002, 0020, 0202 before 2026, and each is a valid date
      // that would otherwise send the whole ledger's worth of queries.
      const timer = setTimeout(() => loadLedgerData(effectiveStart, effectiveEnd), 350)
      return () => clearTimeout(timer)
    }
  }, [startDate, endDate, dateFilterEnabled, currentShopId])

  // Get the date range description
  const getDateRangeDescription = () => {
    if (!dateFilterEnabled) return "Date filter disabled"
    if (!startDate && !endDate) return "All time"
    if (!startDate && endDate) return `All data up to ${new Date(endDate).toLocaleDateString('en-GB')}`
    if (startDate && !endDate) return `From ${new Date(startDate).toLocaleDateString('en-GB')} onwards`
    return `${new Date(startDate).toLocaleDateString('en-GB')} to ${new Date(endDate).toLocaleDateString('en-GB')}`
  }

  const loadLedgerData = async (start: string, end: string) => {
    // RoleProvider resolves the session a moment after this screen
    // mounts, and the effect below runs on that first render too.
    // Without this, every query underneath went out as
    // organization_id=eq.null — eight PostgREST 400s per load, each
    // swallowed into a "…error: {}" in the console, and an opening
    // balance built from nothing.
    if (!currentShopId) return
    const seq = ++loadSeq.current
    const stale = () => seq !== loadSeq.current
    setLoading(true)
    setError(null)
    
    try {
      // Get opening balance (BFC) from day before start date
      const prevDate = new Date(start)
      prevDate.setDate(prevDate.getDate() - 1)
      const previousDate = prevDate.toISOString().split('T')[0]

      // getPreviousBalance used to be in here. It scanned all history
      // five times over to produce a cash figure that nothing reads any
      // more — lib/cash-in-hand.ts replaced it, and its arithmetic was
      // wrong besides. Six requests per load, for nothing.
      const [salesResult, purchaseResult, returnsResult, expensesData, incomeData, purchaseOpening, supplierOpenings] = await Promise.all([
        getSalesData(start, end),
        getPurchaseData(start, end),
        getReturnsData(start, end),
        getExpensesData(start, end),
        getIncomeData(start, end),
        // The Purchase Ledger needs its own opening, on the same basis
        // as its own rows.
        getPurchaseOpeningBalance(previousDate),
        // Same arithmetic, kept apart per supplier — what filtering the
        // table down to one supplier needs to start from.
        getSupplierOpeningBalances(previousDate)
      ])

      if (stale()) return

      // Store for voucher tabs
      setExpensesResult(expensesData)
      setIncomeResult(incomeData)
      setSupplierOpeningBalances(supplierOpenings)

      // ============================================
      // PURCHASE LEDGER
      // ============================================
      const purchaseLedger: LedgerEntry[] = []
      let purchaseBalance = purchaseOpening

      purchaseLedger.push({
        id: 'opening',
        date: start,
        // Not "BFC" any more: this is no longer brought-forward CASH,
        // it is the position with suppliers carried in from earlier.
        description: 'Opening Balance (Brought Forward)',
        voucherType: 'Opening',
        debit: purchaseBalance >= 0 ? purchaseBalance : 0,
        credit: purchaseBalance < 0 ? Math.abs(purchaseBalance) : 0,
        balance: purchaseBalance
      })

      // Individual Purchases (DEBIT - goods purchased/liability created)
      if (purchaseResult.individualPurchases && purchaseResult.individualPurchases.length > 0) {
        purchaseResult.individualPurchases.forEach((purchase: any) => {
          purchaseBalance += purchase.cashAmount  // increases balance (represents goods received)
          
          // Build a more descriptive description
          let description = 'Purchase'
          if (purchase.productName) {
            description += ` - ${purchase.productName}`
          }
          if (purchase.modelNumber) {
            description += ` (${purchase.modelNumber})`
          }
          
          purchaseLedger.push({
            id: `purchase-${purchase.id}`,
            date: purchase.date,
            description: description,
            voucherType: 'Purchase',
            debit: purchase.cashAmount,
            credit: 0,
            balance: purchaseBalance,
            supplier: purchase.supplierName,
            reference: `PURCH-${purchase.id}`
          })
        })
      }

      // Supplier Payments (CREDIT - cash paid out)
      if (expensesData.supplierPayments && expensesData.supplierPayments.length > 0) {
        expensesData.supplierPayments.forEach((payment: any, idx: number) => {
          purchaseBalance -= payment.amount  // reduces balance (cash going out)
          
          purchaseLedger.push({
            id: `supplier-payment-${idx}`,
            date: payment.date || payment.created_at,
            description: payment.description || 'Supplier Payment',
            voucherType: 'Supplier Payment',
            debit: 0,
            credit: payment.amount,
            balance: purchaseBalance,
            supplier: payment.supplier || undefined,
            reference: `PAY-${payment.id}`
          })
        })
      }

      // Purchase Returns (CREDIT - goods returned), one row per return
      // so each carries the supplier it credits and can be grouped,
      // filtered and opened with that supplier's other rows.
      if (returnsResult.individualPurchaseReturns && returnsResult.individualPurchaseReturns.length > 0) {
        returnsResult.individualPurchaseReturns.forEach((ret: any) => {
          purchaseBalance -= ret.amount

          purchaseLedger.push({
            id: `purchase-return-${ret.id}`,
            date: ret.date,
            description: 'Purchase Return',
            voucherType: 'Purchase Return',
            debit: 0,
            credit: ret.amount,
            balance: purchaseBalance,
            supplier: ret.supplier || undefined,
            reference: `RET-${ret.id}`
          })
        })
      }

      // Sort Purchase Ledger by date.
      //
      // By calendar day first, then by kind: payments carry a plain date
      // (midnight) while purchases carry the time they were entered, so
      // a delivery paid for at the counter used to sort AFTER its own
      // payment and the running balance dipped below zero between them.
      // Within a day the opening comes first, then what was bought, then
      // what was paid, then what went back.
      const KIND_ORDER: Record<string, number> = {
        Opening: 0,
        Purchase: 1,
        'Supplier Payment': 2,
        'Purchase Return': 3,
      }
      const sortByDate = (a: LedgerEntry, b: LedgerEntry) =>
        localDay(a.date).localeCompare(localDay(b.date)) ||
        (KIND_ORDER[a.voucherType] ?? 9) - (KIND_ORDER[b.voucherType] ?? 9) ||
        new Date(a.date).getTime() - new Date(b.date).getTime()
      purchaseLedger.sort(sortByDate)

      // Recalculate balances after sorting
      let purchaseRunningBalance = purchaseOpening
      purchaseLedger.forEach((entry, index) => {
        if (index === 0) {
          entry.balance = purchaseRunningBalance
        } else {
          purchaseRunningBalance = purchaseRunningBalance + entry.debit - entry.credit
          entry.balance = purchaseRunningBalance
        }
      })

      // One spelling per supplier. The purchase and the payment that
      // settles it are typed separately, so "I Smart U Technology BD LTD"
      // and "i smart u technology bd ltd " were two suppliers to every
      // list, filter and total below. The first spelling seen is kept.
      const spelling = new Map<string, string>()
      for (const entry of purchaseLedger) {
        if (!entry.supplier) continue
        const key = supplierKey(entry.supplier)
        if (!spelling.has(key)) spelling.set(key, entry.supplier.trim())
        entry.supplier = spelling.get(key)
      }

      setPurchaseEntries(purchaseLedger)

      // What is in the drawer, from the one implementation of it.
      //
      // This used to be worked out here, differently from the Day
      // Cashbook, and wrongly: it SUBTRACTED bank and digital receipts
      // (money that never reached the drawer), subtracted every
      // purchase as well as the supplier payments that settle them
      // (the same stock twice), and ignored the opening-balance
      // baseline. For Star Power 01 the two screens said 147,142 and
      // -2,367,321 about the same day, and the Profit & Loss printed
      // the second because this is where it got it.
      const [cashBefore, cashNow] = await loadCashInHandAt(supabase, currentShopId, [
        previousDate,
        end,
      ])
      if (stale()) return
      setOpeningCash(cashBefore)
      setCashbookBalance(cashNow)

      // Calculate Balance Sheet Data
      const bsData: BalanceSheetData = {
        totalPurchaseAmount: purchaseResult.totalAmount,
        totalSalesAmount: salesResult.totalSalesAmount,
        totalPartyPaymentAmount: expensesData.partyPaymentAmount,
        totalOwnExpenseAmount: expensesData.totalAmount - expensesData.partyPaymentAmount,
        totalCustomerDuesReceiveAmount: 0,
        totalIncomeAmount: incomeData.totalAmount
      }
      setBalanceSheetData(bsData)
      
    } catch (err: any) {
      if (stale()) return
      console.error(
        "Error loading ledger data:",
        err?.message ?? err,
        err?.code ? `(${err.code})` : "",
        err?.hint ?? "",
      )
      setError(err.message || "Failed to load ledger data")
      toast({
        title: "Error",
        description: "Failed to load ledger data",
        variant: "destructive"
      })
    } finally {
      if (!stale()) {
        setLoading(false)
        setHasLoaded(true)
      }
    }
  }

  // Data fetching functions
  const getSalesData = async (start: string, end: string) => {
    try {
      const { data, error } = await supabase
        .from("sales")
        .select(`
          id,
          sale_date,
          invoice_number,
          total_amount, 
          cash_received, 
          card_received, 
          bank_transfer_received, 
          bkash_received, 
          nagad_received, 
          rocket_received, 
          upay_received,
          sale_customers(customer_name)
        `)
        .eq("organization_id", currentShopId)
        // sale_date, not created_at — a sale entered days after it was
        // made belongs on the day it was made. Matches Day Cashbook,
        // so the two reports cannot disagree about which day a sale
        // fell on.
        .gte("sale_date", start)
        .lte("sale_date", `${end}T23:59:59.999Z`)
        .eq("status", "completed")
        .order("sale_date", { ascending: true })

      if (error) throw error

      const sales = data || []
      
      const individualSales = sales.map(sale => {
        const cashAmount = sale.cash_received || 0
        const bankAmount = (sale.card_received || 0) + (sale.bank_transfer_received || 0) + 
                          (sale.bkash_received || 0) + (sale.nagad_received || 0) + 
                          (sale.rocket_received || 0) + (sale.upay_received || 0)
        
        return {
          id: sale.id,
          date: sale.sale_date,
          invoiceNumber: sale.invoice_number,
          cashAmount,
          bankAmount,
          customerName: sale.sale_customers?.[0]?.customer_name || null
        }
      })

      const totals = sales.reduce((acc, sale) => {
        const totalAmount = sale.total_amount || 0
        const cashAmount = sale.cash_received || 0
        const bankAmount = (sale.card_received || 0) + (sale.bank_transfer_received || 0) + 
                          (sale.bkash_received || 0) + (sale.nagad_received || 0) + 
                          (sale.rocket_received || 0) + (sale.upay_received || 0)
        
        return {
          totalSalesAmount: acc.totalSalesAmount + totalAmount,
          cashAmount: acc.cashAmount + cashAmount,
          bankAmount: acc.bankAmount + bankAmount
        }
      }, { totalSalesAmount: 0, cashAmount: 0, bankAmount: 0 })

      return {
        ...totals,
        individualSales
      }
    } catch (error) {
      console.error(
        "getSalesData error:",
        (error as any)?.message ?? error,
        (error as any)?.code ? `(${(error as any).code})` : "",
        (error as any)?.hint ?? "",
      )
      return { 
        totalSalesAmount: 0,
        cashAmount: 0, 
        bankAmount: 0,
        individualSales: []
      }
    }
  }

  const getPurchaseData = async (start: string, end: string) => {
  try {
    const { data, error } = await supabase
      .from("purchases")
      .select(`
        id,
        created_at,
        product_name,
        model_number,
        cost_price,
        supplier,
        supplier_id,
        suppliers(name),
        color_variants(color, barcode, quantity)
      `)
      .eq("organization_id", currentShopId)
      .gte("created_at", start)
      .lte("created_at", `${end}T23:59:59.999Z`)
      .order("created_at", { ascending: true })

    if (error) throw error

    const purchases = data || []

    // Flatten purchases - one entry per color variant
    const individualPurchases = purchases.flatMap(purchase => {
      // Get supplier name.
      //
      // A joined relation comes back as an object for a to-one link but
      // is typed as an array, and the shape differs depending on how the
      // select is written. Handle both rather than rely on one — reading
      // the wrong shape is what previously printed raw UUIDs where a
      // supplier's name should have been.
      const joined = purchase.suppliers as
        | { name?: string | null }
        | { name?: string | null }[]
        | null
        | undefined
      const joinedName = Array.isArray(joined) ? joined[0]?.name : joined?.name

      const supplierName = purchase.supplier || joinedName || 'Unknown Supplier'
      
      const baseData = {
        id: purchase.id,
        date: purchase.created_at,
        cashAmount: purchase.cost_price || 0,
        supplierName: supplierName,
        productName: purchase.product_name || 'Unknown Product',
        modelNumber: purchase.model_number || ''
      }

      // If there are color variants, create one entry per variant
      const colors = purchase.color_variants || []
      
      if (colors.length === 0) {
        // No color variants - create single entry
        return [{
          ...baseData,
          color: null,
          barcode: '',
          invoiceNumber: `PURCH-${purchase.id}`
        }]
      }

      // Create one entry per color variant.
      //
      // Each row is worth cost x ITS quantity. A scanned handset's row
      // holds one unit, so that changes nothing for phones — but counted
      // stock is ONE row carrying the whole count, and valuing it at a
      // single unit's cost made ten cables bought for 1,900 appear in
      // this ledger as 190. Across both shops that understated purchases
      // by more than 76,000.
      return colors.map((variant: any, idx: number) => ({
        ...baseData,
        cashAmount:
          (Number(purchase.cost_price) || 0) *
          Math.max(1, Number(variant.quantity) || 1),
        id: `${purchase.id}-${idx}`, // Unique ID for each variant
        color: variant.color || null,
        barcode: variant.barcode || '',
        invoiceNumber: `PURCH-${purchase.id}-${variant.color || 'NA'}`
      }))
    })

    const totalAmount = individualPurchases.reduce((sum, p) => sum + p.cashAmount, 0)

    return {
      totalAmount,
      individualPurchases
    }
  } catch (error) {
    console.error(
      "getPurchaseData error:",
      (error as any)?.message ?? error,
      (error as any)?.code ? `(${(error as any).code})` : "",
      (error as any)?.hint ?? "",
    )
    return {
      totalAmount: 0,
      individualPurchases: []
    }
  }
}

  const getReturnsData = async (start: string, end: string) => {
    try {
      const [salesReturnsResult, purchaseReturnsResult] = await Promise.all([
        supabase
          .from("sales_returns")
          .select("total_refund_amount")
          .eq("organization_id", currentShopId)
          .gte("return_date", start)
          .lte("return_date", `${end}T23:59:59.999Z`)
          .eq("status", "processed"),
        supabase
          .from("purchase_returns")
          .select("id, total_credit_amount, supplier, return_date")
          .eq("organization_id", currentShopId)
          .gte("return_date", start)
          .lte("return_date", end)
          .eq("status", "processed")
      ])

      const salesReturns = (salesReturnsResult.data || []).reduce(
        (sum, ret) => sum + (ret.total_refund_amount || 0), 0
      )

      // Kept per row, with the supplier it credits, so the Purchase
      // Ledger can attribute a return to the supplier it belongs to
      // instead of one lump sum with nobody's name on it.
      const individualPurchaseReturns = (purchaseReturnsResult.data || []).map((ret) => ({
        id: ret.id,
        amount: ret.total_credit_amount || 0,
        supplier: (ret.supplier || '').trim(),
        date: ret.return_date,
      }))

      const purchaseReturns = individualPurchaseReturns.reduce(
        (sum, ret) => sum + ret.amount, 0
      )

      return { salesReturns, purchaseReturns, individualPurchaseReturns }
    } catch (error) {
      console.error(
        "getReturnsData error:",
        (error as any)?.message ?? error,
        (error as any)?.code ? `(${(error as any).code})` : "",
        (error as any)?.hint ?? "",
      )
      return { salesReturns: 0, purchaseReturns: 0, individualPurchaseReturns: [] }
    }
  }

  const getExpensesData = async (start: string, end: string) => {
    try {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, date, amount, category, custom_category, description, reference, created_at")
        .eq("organization_id", currentShopId)
        .gte("date", start)
        .lte("date", end)
        .order("created_at", { ascending: true })

      if (error) throw error

      const individualExpenses = (data || []).map(expense => {
        const supplierName =
          expense.category === 'party_payment'
            ? supplierFromDescription(expense.description)
            : null

        return {
          id: expense.id,
          amount: expense.amount || 0,
          category: expense.category || 'Other',
          custom_category: expense.custom_category,
          description: expense.description || 'No description',
          reference: expense.reference ?? null,
          // The day the money moved. created_at is only when it was
          // typed in, and a payment entered late — or written in by a
          // migration — would otherwise be listed on the wrong day.
          date: expense.date ?? null,
          created_at: expense.created_at,
          supplier: supplierName
        }
      })

      const totalAmount = individualExpenses.reduce((sum, exp) => sum + exp.amount, 0)
      const partyPaymentAmount = individualExpenses
        .filter(exp => exp.category === 'party_payment')
        .reduce((sum, exp) => sum + exp.amount, 0)
      
      const supplierPayments = individualExpenses.filter(exp => exp.category === 'party_payment')

      return { 
        individualExpenses,
        totalAmount,
        partyPaymentAmount,
        supplierPayments
      }
    } catch (error) {
      console.error(
        "getExpensesData error:",
        (error as any)?.message ?? error,
        (error as any)?.code ? `(${(error as any).code})` : "",
        (error as any)?.hint ?? "",
      )
      return { 
        individualExpenses: [],
        totalAmount: 0,
        partyPaymentAmount: 0,
        supplierPayments: []
      }
    }
  }

  const getIncomeData = async (start: string, end: string) => {
    try {
      // custom_type only exists once script 67 has been run. The app
      // updates independently of the database, so ask for it, and drop
      // back to the columns that were always there if it is not there
      // yet — the shop's own income wording is worth having, but not at
      // the price of a blank ledger.
      const query = (withCustomType: boolean) =>
        supabase
          .from("income_owner")
          .select(`
            id,
            amount,
            income_type,
            ${withCustomType ? "custom_type," : ""}
            destination_type,
            description,
            date,
            created_at,
            supplier_id,
            suppliers (
              id,
              name
            )
          `)
          .eq("organization_id", currentShopId)
          .gte("date", start)
          .lte("date", end)
          .order("created_at", { ascending: true })

      let { data, error } = await query(true)

      if (error && isMissingCustomType(error)) {
        ;({ data, error } = await query(false))
      }

      if (error) throw error

      const individualIncomes = (data || []).map((income: any) => ({
        id: income.id,
        amount: income.amount || 0,
        income_type: income.income_type || 'owner_income',
        custom_type: income.custom_type ?? null,
        destination_type: income.destination_type || 'cash',
        description: income.description || '',
        date: income.date ?? null,
        created_at: income.created_at,
        supplier_id: income.supplier_id || null,
        supplier_name: income.suppliers?.name || null
      }))

      const totalAmount = individualIncomes.reduce((sum, income) => sum + income.amount, 0)

      return {
        individualIncomes,
        totalAmount
      }
    } catch (error: any) {
      // Spelled out rather than passed as an object: a PostgrestError's
      // fields are not own-enumerable, so console.error prints "{}" and
      // the one useful sentence is lost.
      console.error(
        "getIncomeData error:",
        error?.message ?? error,
        error?.code ? `(${error.code})` : "",
        error?.hint ?? ""
      )
      return {
        individualIncomes: [],
        totalAmount: 0
      }
    }
  }

  /**
   * The Purchase Ledger's opening balance.
   *
   * Deliberately NOT cash in hand (lib/cash-in-hand.ts). That counts
   * sales, income and expenses, none of which the Purchase Ledger ever
   * moves, and it treats a purchase payment as money going OUT while
   * the ledger below counts the purchase as a debit going IN.
   *
   * Mixing the two meant the closing balance depended on where you set
   * the start date: a purchase sitting one day either side of it was
   * subtracted on one side and added on the other, so the total swung
   * by twice its value. A closing balance that moves when you change
   * the start date is not a balance.
   *
   * So this is the SAME arithmetic as the rows beneath it, applied to
   * everything that happened earlier. Opening plus movements then
   * telescopes into one all-time figure, and where the period is cut
   * stops mattering.
   *
   * What it means: purchases less what has actually been paid for them
   * — the shop's standing position with its suppliers.
   */
  const getPurchaseOpeningBalance = async (date: string) => {
    try {
      const [purchaseResult, expensesResult, returnsResult] = await Promise.all([
        getPurchaseData('2000-01-01', date),
        getExpensesData('2000-01-01', date),
        getReturnsData('2000-01-01', date)
      ])

      const supplierPaid = (expensesResult.supplierPayments || []).reduce(
        (sum: number, payment: any) => sum + (payment.amount || 0), 0
      )

      return purchaseResult.totalAmount - supplierPaid - returnsResult.purchaseReturns
    } catch (error) {
      console.error(
        "getPurchaseOpeningBalance error:",
        (error as any)?.message ?? error,
        (error as any)?.code ? `(${(error as any).code})` : "",
        (error as any)?.hint ?? "",
      )
      return 0
    }
  }

  /**
   * The same opening figure as above, split out per supplier.
   *
   * Filtering the Purchase Ledger down to one supplier used to start
   * that supplier's balance from zero, because the aggregate opening
   * belongs to no supplier in particular. A supplier who owed money
   * BEFORE the period started then looked settled from row one, and
   * every balance under it was short by exactly what they carried in.
   *
   * Same three sources as getPurchaseOpeningBalance, summed per
   * supplier instead of into one figure, so the two never disagree
   * about the shop-wide total — they are the same numbers, added up a
   * different way.
   */
  const getSupplierOpeningBalances = async (date: string) => {
    try {
      const [purchaseResult, expensesResult, returnsResult] = await Promise.all([
        getPurchaseData('2000-01-01', date),
        getExpensesData('2000-01-01', date),
        getReturnsData('2000-01-01', date)
      ])

      const balances = new Map<string, number>()
      const add = (name: string | null | undefined, amount: number) => {
        const label = (name || '').trim()
        if (!label) return
        const key = supplierKey(label)
        balances.set(key, (balances.get(key) ?? 0) + amount)
      }

      for (const purchase of purchaseResult.individualPurchases ?? []) {
        add(purchase.supplierName, purchase.cashAmount)
      }
      for (const payment of expensesResult.supplierPayments ?? []) {
        add(payment.supplier, -(payment.amount || 0))
      }
      for (const ret of returnsResult.individualPurchaseReturns ?? []) {
        add(ret.supplier, -(ret.amount || 0))
      }

      return balances
    } catch (error) {
      console.error(
        "getSupplierOpeningBalances error:",
        (error as any)?.message ?? error,
        (error as any)?.code ? `(${(error as any).code})` : "",
        (error as any)?.hint ?? "",
      )
      return new Map<string, number>()
    }
  }

  // Get unique suppliers from entries
  const getUniqueSuppliers = (entries: LedgerEntry[]) => {
    const suppliers = entries
      .map(e => e.supplier)
      // typeof rather than Boolean(): both are safe at runtime, but only
      // typeof narrows the type, so the compiler stops flagging s.trim().
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    return Array.from(new Set(suppliers)).sort()
  }

// Filtered entries based on search and supplier selection
const filteredPurchaseEntries = useMemo(() => {
  const term = searchTerm.trim().toLowerCase()
  const supplierChosen =
    selectedSupplierPurchase && selectedSupplierPurchase !== "all"
      ? selectedSupplierPurchase
      : null

  let filtered = purchaseEntries

  // Apply supplier filter
  if (supplierChosen) {
    filtered = filtered.filter(e => e.supplier === supplierChosen)
  }

  // Apply search filter
  if (term) {
    filtered = filtered.filter(e => 
      e.description.toLowerCase().includes(term) ||
      (e.supplier && e.supplier.toLowerCase().includes(term)) ||
      (e.reference && e.reference.toLowerCase().includes(term)) ||
      e.voucherType.toLowerCase().includes(term)
    )
  }

  if (filtered.length === 0) return filtered

  if (supplierChosen) {
    // One supplier: this IS their account, so it starts where their
    // account actually starts. Filtering used to zero the balance out,
    // which read as a supplier with nothing owed the moment the
    // dropdown was touched — even one carried forward from before the
    // period, or from a purchase dated outside it.
    const opening = supplierOpeningBalances.get(supplierKey(supplierChosen)) ?? 0
    let runningBalance = opening
    const openingRow: LedgerEntry = {
      id: 'opening',
      date: startDate || filtered[0].date,
      description: 'Opening Balance (Brought Forward)',
      voucherType: 'Opening',
      debit: opening >= 0 ? opening : 0,
      credit: opening < 0 ? Math.abs(opening) : 0,
      balance: opening,
      supplier: supplierChosen,
    }
    const rows = filtered
      .filter(e => e.id !== 'opening')
      .map((entry) => {
        runningBalance = runningBalance + entry.debit - entry.credit
        return { ...entry, balance: runningBalance }
      })
    return [openingRow, ...rows]
  }

  if (term) {
    // A bare search can span several suppliers, who share no single
    // opening figure, so this stays a balance over the matched rows
    // alone rather than pretending to be anyone's account.
    let runningBalance = 0
    return filtered
      .filter(e => e.id !== 'opening')
      .map((entry) => {
        runningBalance = runningBalance + entry.debit - entry.credit
        return { ...entry, balance: runningBalance }
      })
  }

  // No filter applied - keep original balances
  // (already calculated correctly in loadLedgerData)
  return filtered
}, [purchaseEntries, searchTerm, selectedSupplierPurchase, supplierOpeningBalances, startDate])

// The Purchase Ledger table: one row per supplier, not one per
// transaction. A shop pays and buys from the same supplier all month,
// and a row for each buried the figure the owner reads the page for.
//
// Purchases, supplier payments and purchase returns all belong to a
// supplier. The shop-wide opening position has none — it stays a row
// of its own, unless the filter above has narrowed the page to one
// supplier, in which case filteredPurchaseEntries already replaced it
// with THEIR opening and it lands here the same way. The transactions
// behind a supplier's total are kept on the group and shown only when
// its row is opened.
const groupedVoucherTypes = new Set(['Purchase', 'Supplier Payment', 'Purchase Return'])

/**
 * Purchases made against one supplier on one day, as one row with the
 * day's total — not one row per product, colour or invoice line.
 *
 * A single purchase invoice already becomes several rows here, one per
 * colour variant, and a supplier delivered to twice in a day doubles
 * that again. Opening a supplier who is restocked daily meant scrolling
 * past a column of same-day amounts to find what any one day actually
 * cost; the shop wants that one figure per day.
 *
 * Payments and returns are untouched: grouping those was not asked
 * for, and one payment is already one meaningful event, unlike a
 * purchase invoice's per-colour rows.
 *
 * Runs after the running balance is calculated, on ONE supplier's
 * chronological rows, so the day with more than one purchase keeps the
 * balance as it stood after the LAST of them — which is where a
 * cumulative balance belongs regardless of how many rows fed it.
 */
function mergeSameDayPurchases(entries: LedgerEntry[]): LedgerEntry[] {
  const dayLabel = (date: string) => new Date(date).toLocaleDateString("en-GB")

  const countForDay = new Map<string, number>()
  for (const entry of entries) {
    if (entry.voucherType !== "Purchase") continue
    const key = dayLabel(entry.date)
    countForDay.set(key, (countForDay.get(key) ?? 0) + 1)
  }

  const merged: LedgerEntry[] = []
  const rowForDay = new Map<string, LedgerEntry>()

  for (const entry of entries) {
    const key = dayLabel(entry.date)
    if (entry.voucherType !== "Purchase" || (countForDay.get(key) ?? 0) <= 1) {
      merged.push(entry)
      continue
    }

    const existing = rowForDay.get(key)
    if (existing) {
      existing.debit += entry.debit
      // The last entry that day carries the running balance after all
      // of that day's purchases, which is what the merged row shows.
      existing.balance = entry.balance
    } else {
      const row: LedgerEntry = {
        ...entry,
        id: `purchase-day-${supplierKey(entry.supplier || "")}-${key}`,
        description: `Purchase (${countForDay.get(key)} items)`,
        reference: undefined,
      }
      rowForDay.set(key, row)
      merged.push(row)
    }
  }

  return merged
}

const purchaseSummary = useMemo(() => {
  const groups = new Map<string, {
    name: string
    opening: number
    debit: number
    credit: number
    entries: LedgerEntry[]
  }>()
  const others: LedgerEntry[] = []

  for (const entry of filteredPurchaseEntries) {
    if (!groupedVoucherTypes.has(entry.voucherType)) {
      others.push(entry)
      continue
    }
    const name = entry.supplier?.trim() || '(no supplier)'
    const key = supplierKey(name)
    let group = groups.get(key)
    if (!group) {
      // Carried in from before this period, so a supplier who came in
      // owing money doesn't read as settled just because this page
      // starts later than their history does.
      group = { name, opening: supplierOpeningBalances.get(key) ?? 0, debit: 0, credit: 0, entries: [] }
      groups.set(key, group)
    }
    group.debit += entry.debit
    group.credit += entry.credit
    group.entries.push(entry)
  }

  const suppliers = Array.from(groups.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(group => {
      let running = group.opening
      const withBalance = group.entries.map(entry => {
        running = running + entry.debit - entry.credit
        return { ...entry, balance: running }
      })
      return {
        ...group,
        balance: group.opening + group.debit - group.credit,
        entries: mergeSameDayPurchases(withBalance),
      }
    })

  return {
    opening: others.filter(e => e.id === 'opening'),
    suppliers,
    others: others.filter(e => e.id !== 'opening'),
  }
}, [filteredPurchaseEntries, supplierOpeningBalances])

const openedSupplier = openSupplier
  ? purchaseSummary.suppliers.find(g => supplierKey(g.name) === supplierKey(openSupplier)) ?? null
  : null

  // Calculate totals for P&L from expense and income data
  const profitLoss = useMemo(() => {
    const revenue = incomeResult.totalAmount + (balanceSheetData?.totalSalesAmount || 0)
    const expenses = expensesResult.totalAmount
    
    return { revenue, expenses, net: revenue - expenses }
  }, [expensesResult, incomeResult, balanceSheetData])

  // Helper function to get expense category display
  // The shop's own wording where it gave one. Previously returned the
  // raw enum for anything but a supplier payment, so a water bill read
  // as "water_bill" on the ledger and in its printed voucher.
  const getExpenseCategory = (expense: any) => {
    if (expense.category === 'other') return expense.custom_category || 'Other'
    return labelFor(
      labels,
      'expense_category',
      expense.category,
      EXPENSE_HEADS[expense.category] || expense.category || 'Other',
    )
  }

  // The Expense and Income Vouchers, one row per head. Grouped by the
  // label the row prints, so two spellings of one custom head are one.
  const expenseGroups = useMemo(
    () => groupVouchers(expensesResult.individualExpenses ?? [], getExpenseCategory),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expensesResult, labels],
  )
  const incomeGroups = useMemo(
    () =>
      groupVouchers(incomeResult.individualIncomes ?? [], (r: any) =>
        incomeTypeLabel(r.income_type, r.custom_type, labels),
      ),
    [incomeResult, labels],
  )
  // The filter as it applies to THESE dates. A head chosen for one
  // period may not exist in the next; falling back to "all" keeps the
  // dropdown and the table in agreement instead of showing a blank box
  // over an empty table.
  const expenseFilterKey = expenseGroups.some((g) => g.key === expenseFilter) ? expenseFilter : "all"
  const incomeFilterKey = incomeGroups.some((g) => g.key === incomeFilter) ? incomeFilter : "all"
  const shownExpenseGroups =
    expenseFilterKey === "all" ? expenseGroups : expenseGroups.filter((g) => g.key === expenseFilterKey)
  const shownIncomeGroups =
    incomeFilterKey === "all" ? incomeGroups : incomeGroups.filter((g) => g.key === incomeFilterKey)
  // What Print and Export work from, so paper matches the screen.
  const shownExpenseRows = shownExpenseGroups.flatMap((g) => g.rows)
  const shownIncomeRows = shownIncomeGroups.flatMap((g) => g.rows)

  const openedExpenseGroup = expenseGroups.find((g) => g.key === openExpenseGroup) ?? null
  const openedIncomeGroup = incomeGroups.find((g) => g.key === openIncomeGroup) ?? null

  // Print functions
  const periodText = () => {
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    if (startDate && endDate) return `${fmt(startDate)} TO ${fmt(endDate)}`
    if (startDate) return `From ${fmt(startDate)}`
    if (endDate) return `Up to ${fmt(endDate)}`
    return "All dates"
  }

  const handlePrintPurchaseLedger = () => {
    // The same groups the screen shows, so the paper and the popup
    // cannot disagree: each supplier's own opening, a day's purchases
    // as one row, payments and returns as they happened.
    const ok = printPurchaseLedger({
      header,
      period: periodText(),
      parties: purchaseSummary.suppliers.map((party) => ({
        ...party,
        entries: party.entries.map((e) => ({
          ...e,
          // The shop's calendar day. Purchases carry a UTC timestamp,
          // and one entered after midnight in Dhaka would otherwise
          // print under the day before.
          date: localDay(e.date),
          // A payment's description is the supplier's name, which the
          // block heading already says; name what happened instead.
          description: e.voucherType === "Purchase" ? e.description : e.voucherType,
        })),
      })),
      filters:
        selectedSupplierPurchase && selectedSupplierPurchase !== "all"
          ? `Party: ${selectedSupplierPurchase}`
          : undefined,
    })
    if (!ok) toast({
      title: "Print window did not open",
      description: "Allow pop-ups for this application, then try again.",
      variant: "destructive",
    })
  }

  // ------------------------------------------------------------------
  // The sheets modelled on the shop's previous software.
  //
  // These load their own rows when the button is pressed rather than
  // with the page. Two of them sweep the whole history to work out an
  // opening position, and nobody opening the Ledger to glance at a
  // figure should pay for that.
  // ------------------------------------------------------------------

  /** The dates the page is actually showing, and the day before them. */
  const effectiveRange = () => {
    const start = startDate || "2000-01-01"
    const end = endDate || today
    const prev = new Date(start)
    prev.setDate(prev.getDate() - 1)
    return { start, end, prev: prev.toISOString().split("T")[0] }
  }

  const popupBlocked = () =>
    toast({
      title: "Print window did not open",
      description: "Allow pop-ups for this application, then try again.",
      variant: "destructive",
    })

  const reportFailed = (what: string, err: any) => {
    console.error(`${what} failed:`, err?.message ?? err, err?.code ?? "", err?.hint ?? "")
    toast({
      title: `Could not build the ${what}`,
      description: err?.message || "Please try again.",
      variant: "destructive",
    })
  }

  const SALE_COLUMNS =
    "id, sale_date, total_amount, total_discount, cash_received, card_received, " +
    "bank_transfer_received, bkash_received, nagad_received, rocket_received, " +
    "upay_received, total_received, previous_dues, credit_amount"

  const loadSales = (start: string, end: string) =>
    pageAll<any>((from, to) =>
      supabase
        .from("sales")
        .select(SALE_COLUMNS)
        .eq("organization_id", currentShopId)
        .eq("status", "completed")
        .gte("sale_date", start)
        .lte("sale_date", `${end}T23:59:59.999Z`)
        .order("sale_date", { ascending: true })
        .range(from, to),
    )

  const EXPENSE_COLUMNS =
    "id, date, amount, category, custom_category, description, reference, supplier_id, suppliers(name)"

  /**
   * paid_with_voucher_id arrives with script 90. It marks the expense
   * that IS a voucher's paid-on-the-day amount, and the supplier-balance
   * figures must leave those out (see isPaidOnVoucher). A database
   * without the column simply has none of them, so the fallback read
   * gives exactly the right answer rather than a blank report.
   */
  const loadExpenseRows = async (start: string, end: string) => {
    const read = (columns: string) =>
      pageAll<any>((from, to) =>
        supabase
          .from("expenses")
          .select(columns)
          .eq("organization_id", currentShopId)
          .gte("date", start)
          .lte("date", end)
          .order("date", { ascending: true })
          .range(from, to),
      )
    try {
      return await read(`${EXPENSE_COLUMNS}, paid_with_voucher_id`)
    } catch {
      return await read(EXPENSE_COLUMNS)
    }
  }

  /**
   * The money a voucher records as paid on the day it was written.
   *
   * It is a real payment — the Purchase Ledger, the Day Cashbook and
   * cash in hand all count it. But anything that works out a supplier
   * BALANCE from payments against dues must leave it out: the voucher's
   * due_amount is already net of it, so counting the expense as well
   * would invent an advance of exactly that size.
   */
  const isPaidOnVoucher = (e: any) => e?.paid_with_voucher_id != null

  const VOUCHER_COLUMNS =
    "id, voucher_no, voucher_date, supplier, supplier_id, net_amount, party_amount, " +
    "paid_amount, due_amount, due_settled, discount, adjustment, suppliers(name)"

  const loadVouchers = (start: string, end: string) =>
    pageAll<any>((from, to) =>
      supabase
        .from("purchase_vouchers")
        .select(VOUCHER_COLUMNS)
        .eq("organization_id", currentShopId)
        .gte("voucher_date", start)
        .lte("voucher_date", end)
        .order("voucher_date", { ascending: true })
        .range(from, to),
    )

  /**
   * Every delivery taken in during the period.
   *
   * THE PURCHASES ARE THE PERIOD, NOT THE VOUCHERS
   *
   * These reports used to select purchase_vouchers by voucher_date.
   * That quietly answered a different question, and two things fell
   * through it:
   *
   *   * Add Product and sister-shop transfers (scripts 60 and 62)
   *     write a `purchases` row and NO voucher at all, so a shop that
   *     buys either of those ways had almost none of its purchases
   *     counted;
   *
   *   * a voucher whose delivery date sits outside the period was
   *     dropped even though its stock was taken in during it. After a
   *     shop reset that is most of them, because re-entered vouchers
   *     keep their original dates.
   *
   * So the purchases decide what is in the period, and the voucher is
   * looked up afterwards for the money terms. This is the same set of
   * rows the Purchases page totals, which is the figure the shop
   * checks against.
   */
  const loadPeriodPurchases = (start: string, end: string) =>
    pageAll<any>((from, to) =>
      supabase
        .from("purchases")
        .select(
          "id, created_at, cost_price, category, supplier, supplier_id, voucher_id, suppliers(name), color_variants(barcode, quantity)",
        )
        .eq("organization_id", currentShopId)
        .gte("created_at", start)
        .lte("created_at", `${end}T23:59:59.999Z`)
        .order("created_at", { ascending: true })
        .range(from, to),
    )

  /**
   * The period's deliveries, split into the ones a voucher explains
   * and the ones nothing does.
   *
   * A voucher-less purchase is counted as PAID: no voucher means no
   * money terms were recorded, so there is no debt to report. Script
   * 66 took the same view when it backfilled — showing them as owing
   * would invent a balance the shop does not have.
   */
  const loadPurchaseSources = async (start: string, end: string) => {
    const purchases = await loadPeriodPurchases(start, end)

    const voucherIds = Array.from(
      new Set(purchases.map((p) => p.voucher_id).filter(Boolean)),
    ) as number[]

    const vouchers = voucherIds.length
      ? await inChunks<any>(voucherIds, (slice) =>
          pageAll<any>((from, to) =>
            supabase
              .from("purchase_vouchers")
              .select(VOUCHER_COLUMNS)
              .eq("organization_id", currentShopId)
              .in("id", slice)
              .range(from, to),
          ),
        )
      : []

    return { vouchers, unvouchered: purchases.filter((p) => !p.voucher_id) }
  }

  /**
   * What one purchase came to: cost x every unit on it.
   *
   * Summed from each variant's QUANTITY, not counted by rows. A scanned
   * handset is one row per unit, so the two agree for phones; counted
   * stock is one row for the whole count, and counting rows valued ten
   * cables as one.
   */
  const unvoucheredAmount = (p: any) => {
    const variants = Array.isArray(p.color_variants) ? p.color_variants : []
    const units = variants.length
      ? variants.reduce((t: number, v: any) => t + Math.max(1, Number(v.quantity) || 1), 0)
      : 1
    return (Number(p.cost_price) || 0) * units
  }

  /** Reads a long list of ids in bites the request line can carry. */
  const inChunks = async <T,>(
    ids: (string | number)[],
    read: (slice: (string | number)[]) => Promise<T[]>,
    size = 200,
  ): Promise<T[]> => {
    const out: T[] = []
    for (let i = 0; i < ids.length; i += size) {
      out.push(...(await read(ids.slice(i, i + size))))
    }
    return out
  }

  const loadIncomeRows = (start: string, end: string) =>
    pageAll<any>((from, to) =>
      supabase
        .from("income_owner")
        // income_subtype is deliberately NOT asked for: this report
        // splits by TYPE, and a database without script 86 would fail
        // the whole query over a column it never reads.
        .select("id, date, amount, income_type")
        .eq("organization_id", currentShopId)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .range(from, to),
    )

  /**
   * What customers still owed at the end of a given day.
   *
   * Every credit sale up to that date, less whatever has since been
   * settled against it. There is no running balance to read instead.
   */
  const loadCustomerDue = async (upTo: string) => {
    const rows = await pageAll<any>((from, to) =>
      supabase
        .from("sales")
        .select("credit_amount, total_received, previous_dues")
        .eq("organization_id", currentShopId)
        .eq("status", "completed")
        .lte("sale_date", `${upTo}T23:59:59.999Z`)
        .range(from, to),
    )
    // Credit given up to that day, less what had been collected BY that
    // day - collections counted the way the report counts them for a
    // period (money handed over against a balance carried onto a later
    // sale). The sales' own due_settled is not used: it holds what has
    // been collected up to TODAY, so an opening figure for a past date
    // came out too low by every collection made since.
    const credit = rows.reduce((s, r) => s + (Number(r.credit_amount) || 0), 0)
    const collected = rows.reduce(
      (s, r) =>
        s + Math.min(Number(r.total_received) || 0, Number(r.previous_dues) || 0),
      0,
    )
    return Math.max(0, credit - collected)
  }

  /**
   * Stock that went out of, or back onto, the shelves by way of returns
   * since a date, at cost.
   *
   * Stock at the start of a period is worked back from what is on the
   * shelves now, so every movement since then has to be undone - not
   * just sales and purchases. A purchase return took units off the
   * shelf; a sales return put units on it.
   */
  const loadReturnsSince = async (start: string) => {
    const [purchaseItems, salesItems] = await Promise.all([
      pageAll<any>((from, to) =>
        supabase
          .from("purchase_return_items")
          .select("return_quantity, unit_cost, purchase_returns!inner(return_date, deleted_at)")
          .eq("organization_id", currentShopId)
          .is("deleted_at", null)
          .is("purchase_returns.deleted_at", null)
          .gte("purchase_returns.return_date", start)
          .range(from, to),
      ),
      pageAll<any>((from, to) =>
        supabase
          .from("sales_return_items")
          .select("quantity, restock, sold_products(cost_price), sales_returns!inner(return_date, deleted_at)")
          .eq("organization_id", currentShopId)
          .is("deleted_at", null)
          .is("sales_returns.deleted_at", null)
          .gte("sales_returns.return_date", start)
          .range(from, to),
      ),
    ])
    return {
      sentBack: purchaseItems.reduce(
        (t, r) => t + (Number(r.unit_cost) || 0) * (Number(r.return_quantity) || 0),
        0,
      ),
      takenBack: salesItems
        .filter((r) => r.restock !== false)
        .reduce((t, r) => {
          const sold = Array.isArray(r.sold_products) ? r.sold_products[0] : r.sold_products
          return t + (Number(sold?.cost_price) || 0) * (Number(r.quantity) || 0)
        }, 0),
    }
  }

  /** What is on the shelves, at what it cost. */
  const loadStockValue = async () => {
    const rows = await pageAll<any>((from, to) =>
      supabase
        .from("inventory")
        .select("quantity, cost_price")
        .eq("organization_id", currentShopId)
        .gt("quantity", 0)
        .range(from, to),
    )
    return rows.reduce(
      (sum, r) => sum + (Number(r.cost_price) || 0) * (Number(r.quantity) || 0),
      0,
    )
  }

  /** What the goods sold in the period had cost to buy. */
  const loadCostOfSales = async (saleIds: number[]) => {
    if (saleIds.length === 0) return 0
    const rows = await inChunks<any>(saleIds, (slice) =>
      pageAll<any>((from, to) =>
        supabase
          .from("sold_products")
          .select("quantity, cost_price")
          .eq("organization_id", currentShopId)
          .in("sales_id", slice)
          .range(from, to),
      ),
    )
    return rows.reduce(
      (sum, r) => sum + (Number(r.cost_price) || 0) * (Number(r.quantity) || 0),
      0,
    )
  }

  /**
   * Supplier promos on these sales. Stored inside the discount, because
   * it did come off what the customer paid; counted back into the sale
   * for the P&L, because the supplier pays it back.
   */
  const loadPromoOfSales = async (saleIds: number[]) => {
    if (saleIds.length === 0) return 0
    try {
      const rows = await inChunks<any>(saleIds, (slice) =>
        pageAll<any>((from, to) =>
          supabase
            .from("sold_products")
            .select("quantity, promo_amount")
            .eq("organization_id", currentShopId)
            .in("sales_id", slice)
            .range(from, to),
        ),
      )
      return rows.reduce((sum, r) => sum + linePromo(r), 0)
    } catch {
      // A database without script 98 has no promos to count.
      return 0
    }
  }

  /** What suppliers paid in the period to settle promo claims. */
  const loadPromoReceived = async (start: string, end: string) => {
    const { data, error } = await supabase
      .from("supplier_promo_settlements")
      .select("amount, income_owner!inner(date, deleted_at)")
      .eq("organization_id", currentShopId)
      .gte("income_owner.date", start)
      .lte("income_owner.date", end)
      .is("income_owner.deleted_at", null)
    if (error) return 0
    return (data ?? []).reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0)
  }

  const sumOf = <T,>(rows: T[], pick: (r: T) => number) =>
    rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0)

  const salesTotals = (rows: any[]) => ({
    total: sumOf(rows, (s) => s.total_amount),
    discount: sumOf(rows, (s) => s.total_discount),
    cash: sumOf(rows, (s) => s.cash_received),
    bank: rows.reduce((s, r) => s + bankReceived(r), 0),
    dues: sumOf(rows, (s) => s.credit_amount),
    duesReceived: rows.reduce(
      (s, r) =>
        s + Math.min(Number(r.total_received) || 0, Number(r.previous_dues) || 0),
      0,
    ),
  })

  const expenseSplit = (rows: any[]) => ({
    // For the supplier BALANCE, so the day-of payments stay out.
    party: sumOf(
      rows.filter((e) => e.category === "party_payment" && !isPaidOnVoucher(e)),
      (e) => e.amount,
    ),
    own: sumOf(
      rows.filter((e) => e.category !== "party_payment"),
      (e) => e.amount,
    ),
  })

  /**
   * The four ways money leaves the till, for the Profit & Loss.
   *
   * Only `shop` is the cost of RUNNING the shop, and only `shop` is
   * what Net Profit is measured against. The other three are stock
   * bought or the owner drawing money out — real payments, counted in
   * Total Expense, but not a cost of trading.
   */
  const expenseHeads = (rows: any[]) => {
    const isTransfer = (e: any) =>
      e.category === "other" &&
      (e.custom_category ?? "").trim().toLowerCase() ===
        STOCK_TRANSFER_CATEGORY.toLowerCase()

    return {
      supplier: sumOf(
        rows.filter((e) => e.category === "party_payment"),
        (e) => e.amount,
      ),
      owner: sumOf(
        rows.filter((e) => e.category === "owner_payment"),
        (e) => e.amount,
      ),
      transfer: sumOf(rows.filter(isTransfer), (e) => e.amount),
      shop: sumOf(
        rows.filter(
          (e) =>
            e.category !== "party_payment" &&
            e.category !== "owner_payment" &&
            !isTransfer(e),
        ),
        (e) => e.amount,
      ),
    }
  }

  // ---- PARTY DUES PAYMENT REPORT -----------------------------------

  const handlePrintPartyDues = async () => {
    if (!currentShopId) return
    setPrinting("dues")
    try {
      const { start, end } = effectiveRange()
      const [expenses, vouchers] = await Promise.all([
        loadExpenseRows(start, end),
        loadVouchers(start, end),
      ])
      // Payments against DUES. Money paid on the day a voucher was
      // written never became a due — the voucher's own due_amount is
      // already net of it — so listing it here would print it as a
      // payment against debt that was never owed.
      const payments = expenses.filter(
        (e) => e.category === "party_payment" && !isPaidOnVoucher(e),
      )

      const allocations = await inChunks<any>(
        payments.map((p) => p.id),
        (slice) =>
          pageAll<any>((from, to) =>
            supabase
              .from("purchase_voucher_payments")
              .select("expense_id, voucher_id, amount")
              .eq("organization_id", currentShopId)
              .in("expense_id", slice)
              .range(from, to),
          ),
      )

      const voucherById = new Map<number, any>(vouchers.map((v) => [v.id, v]))

      // A payment made this month can clear a delivery from an earlier
      // one, and that voucher is not in the list above. Without this
      // the row would print with no voucher number and no dues.
      const offPeriod = Array.from(
        new Set(
          allocations.map((a) => a.voucher_id).filter((id) => !voucherById.has(id)),
        ),
      )
      if (offPeriod.length > 0) {
        const extra = await inChunks<any>(offPeriod, (slice) =>
          pageAll<any>((from, to) =>
            supabase
              .from("purchase_vouchers")
              .select(VOUCHER_COLUMNS)
              .eq("organization_id", currentShopId)
              .in("id", slice)
              .range(from, to),
          ),
        )
        extra.forEach((v) => voucherById.set(v.id, v))
      }

      const byExpense = new Map<string, any[]>()
      for (const a of allocations) {
        const list = byExpense.get(a.expense_id)
        if (list) list.push(a)
        else byExpense.set(a.expense_id, [a])
      }

      const rows: PartyDuesRow[] = []

      for (const p of payments) {
        const allocs = byExpense.get(p.id) ?? []
        if (allocs.length === 0) {
          // Recorded without naming a delivery. Still money that left
          // the till, so it belongs on a sheet about what was paid.
          rows.push({
            supplier: supplierNameOf(p),
            purchaseVoucherNo: null,
            purchaseDate: null,
            paymentVoucherNo: p.reference,
            paymentDate: p.date,
            dues: 0,
            payment: Number(p.amount) || 0,
          })
          continue
        }
        for (const a of allocs) {
          const v = voucherById.get(a.voucher_id)
          const fromVoucher = v ? supplierNameOf(v) : "(no supplier)"
          rows.push({
            supplier: fromVoucher === "(no supplier)" ? supplierNameOf(p) : fromVoucher,
            purchaseVoucherNo: v?.voucher_no ?? null,
            purchaseDate: v?.voucher_date ?? null,
            paymentVoucherNo: p.reference,
            paymentDate: p.date,
            dues: Number(v?.due_amount) || 0,
            payment: Number(a.amount) || 0,
          })
        }
      }

      // Deliveries taken in this period that nothing has been paid
      // against yet. A report about dues that omitted new debt would
      // be answering half the question.
      const settledHere = new Set(allocations.map((a) => a.voucher_id))
      for (const v of vouchers) {
        if (settledHere.has(v.id)) continue
        if ((Number(v.due_amount) || 0) - (Number(v.due_settled) || 0) <= 0) continue
        rows.push({
          supplier: supplierNameOf(v),
          purchaseVoucherNo: v.voucher_no,
          purchaseDate: v.voucher_date,
          paymentVoucherNo: null,
          paymentDate: null,
          dues: Number(v.due_amount) || 0,
          payment: 0,
        })
      }

      const when = (r: PartyDuesRow) => r.paymentDate || r.purchaseDate || ""
      rows.sort((a, b) => when(a).localeCompare(when(b)))

      if (!printPartyDues({ header, period: periodText(), rows })) popupBlocked()
    } catch (err: any) {
      reportFailed("Party Dues Payment Report", err)
    } finally {
      setPrinting(null)
    }
  }

  // ---- PROFIT & LOSS -----------------------------------------------

  const handlePrintProfitLoss = async () => {
    if (!currentShopId) return
    setPrinting("pl")
    try {
      const { start, end, prev } = effectiveRange()

      const [
        salesNow,
        expensesBefore,
        expensesNow,
        purchasesBefore,
        closingStock,
        periodPurchases,
        incomeNow,
        openingCustomerDue,
        [openingCash, closingCash],
        returnsSince,
      ] = await Promise.all([
        loadSales(start, end),
        loadExpenseRows("2000-01-01", prev),
        loadExpenseRows(start, end),
        // By when the stock came in, not the voucher's own date, so the
        // debt and the stock it bought enter the opening on the same
        // day. PV-000028 is dated 8 Sep but was taken in on 11 Sep.
        loadPurchaseSources("2000-01-01", prev),
        loadStockValue(),
        loadPeriodPurchases(start, end),
        loadIncomeRows(start, end),
        loadCustomerDue(prev),
        // Worked out for THIS report's dates here, not read from the
        // page's state, which is whatever the last load left there.
        loadCashInHandAt(supabase, currentShopId, [prev, end]),
        loadReturnsSince(start),
      ])

      const [costOfSales, salePromo, promoReceived] = await Promise.all([
        loadCostOfSales(salesNow.map((s) => s.id)),
        loadPromoOfSales(salesNow.map((s) => s.id)),
        loadPromoReceived(start, end),
      ])

      // Stock now is the anchor, so everything that happened between
      // the START of the period and TODAY has to be undone - not only up
      // to the end date. A report for last month, run today, used to
      // ignore everything since and open too high or too low by it.
      const reachesToday = end >= today
      const salesSince = reachesToday ? salesNow : await loadSales(start, today)
      const purchasesSince = reachesToday
        ? periodPurchases
        : await loadPeriodPurchases(start, today)
      const costSince = reachesToday
        ? costOfSales
        : await loadCostOfSales(salesSince.map((s) => s.id))

      const now = salesTotals(salesNow)
      const eBefore = expenseSplit(expensesBefore)
      const eNow = expenseHeads(expensesNow)

      // Stock at the start, worked back from what is on the shelves
      // now: whatever is here, plus what was sold out of it, less what
      // came in. There is no stock snapshot to read instead.
      // Voucher-less deliveries are stock too. Leaving them out here
      // made the opening figure too high by exactly what Add Product
      // and the sister shop had brought in.
      // Every unit at its own cost, vouchered or not - the same basis
      // as the cost of what was sold, and as the category totals below.
      // A voucher's net_amount is after discount and adjustment, which
      // the sold cost knows nothing about.
      const boughtSince = purchasesSince.reduce((sum, p) => sum + unvoucheredAmount(p), 0)

      const openingStock = Math.max(
        0,
        closingStock +
          costSince +
          returnsSince.sentBack -
          returnsSince.takenBack -
          boughtSince,
      )

      // Purchases grouped the way the shop buys — Phone, Accessories,
      // Live Demo. Every intake counts, vouchered or not: the Purchase
      // Voucher form makes vouchers, Add Product and sister-shop
      // transfers do not, and a category total that saw only one of
      // those would be short by whatever came the other way.
      const byCategory = new Map<string, number>()
      for (const p of periodPurchases) {
        const key = (p.category ?? "").trim() || "Uncategorised"
        byCategory.set(key, (byCategory.get(key) ?? 0) + unvoucheredAmount(p))
      }
      const purchasesByCategory = Array.from(byCategory, ([category, amount]) => ({
        category,
        amount,
      })).sort((a, b) => b.amount - a.amount)

      // Positive is an advance the shop has paid; negative is money it
      // still owes. Both live on one line, and the report says which.
      const openingSupplierBalance =
        eBefore.party - sumOf(purchasesBefore.vouchers, (v) => v.due_amount)

      const incomeOf = (type: string) =>
        sumOf(
          incomeNow.filter((r: any) => r.income_type === type),
          (r: any) => r.amount,
        )

      // Stock moved to a sister shop goes out at cost, so it is a sale
      // that carries no profit. Shown, not hidden: a month with a big
      // transfer would otherwise read as a month of bad trading.
      const transferValue = sumOf(
        salesNow.filter((sale: any) => sale.transfer_to_org_id),
        (sale: any) => sale.total_amount,
      )

      const data: ProfitLossData = {
        openingStock,
        openingSupplierBalance,
        openingCustomerDue,
        openingCash,

        purchasesByCategory,

        // At full price: the supplier's promo is the supplier's money,
        // not a discount the shop gave.
        saleValue: now.total + salePromo,
        salePromo,
        transferValue,
        productCost: costOfSales,
        // Only what the customer actually handed over. The credit part
        // arrives later as Customer Due Collection, so the full value
        // of a sale is counted exactly once — sometimes across two
        // periods.
        saleReceived: now.total - now.dues,

        ownerInvest: incomeOf("owner_income"),
        supplierPaidToShop: incomeOf("party_income"),
        customerDueCollection: now.duesReceived,

        supplierPayment: eNow.supplier,
        ownerPayment: eNow.owner,
        stockTransferIn: eNow.transfer,
        shopExpense: eNow.shop,
        promoReceived,

        closingCash,
      }

      if (!printProfitLoss({ header, period: periodText(), data })) popupBlocked()
    } catch (err: any) {
      reportFailed("Profit & Loss Report", err)
    } finally {
      setPrinting(null)
    }
  }

  // ---- BALANCE SHEET -----------------------------------------------

  const handlePrintBalanceSheet = async () => {
    if (!currentShopId) return
    setPrinting("bs")
    try {
      const { start, end } = effectiveRange()

      const [sales, expenses, incomes, purchaseSources] = await Promise.all([
        loadSales(start, end),
        loadExpenseRows(start, end),
        loadIncomeRows(start, end),
        loadPurchaseSources(start, end),
      ])
      const { vouchers, unvouchered } = purchaseSources

      const partyPurchases: PartyPurchaseRow[] = [
        ...vouchers.map((v) => ({
          supplier: supplierNameOf(v),
          date: v.voucher_date,
          purchaseAmount: Number(v.party_amount) || 0,
          paid: Number(v.paid_amount) || 0,
          dues: Number(v.due_amount) || 0,
          discount: Number(v.discount) || 0,
          adjustment: Number(v.adjustment) || 0,
        })),
        // Add Product and sister-shop transfers. See
        // loadUnvoucheredPurchases: no voucher means no debt, so these
        // are shown paid rather than owing.
        ...unvouchered.map((p) => {
          const amount = unvoucheredAmount(p)
          return {
            supplier: supplierNameOf(p),
            date: String(p.created_at ?? "").slice(0, 10),
            purchaseAmount: amount,
            paid: amount,
            dues: 0,
            discount: 0,
            adjustment: 0,
          }
        }),
      ]

      // One line per trading day, which is how the sheet is read.
      const byDay = new Map<string, SalesHistoryRow>()
      const duesByDay = new Map<string, { date: string; duesAmount: number; receiptAmount: number }>()

      for (const s of sales) {
        const day = String(s.sale_date).slice(0, 10)

        const row: SalesHistoryRow = byDay.get(day) ?? {
          date: day,
          salesAmount: 0,
          cashPaid: 0,
          bankPaid: 0,
          adjustment: 0,
          discount: 0,
          dues: 0,
        }
        // Gross, so that gross less discount foots to what was charged
        // — the figure the sheet calls Total Sales.
        row.salesAmount += (Number(s.total_amount) || 0) + (Number(s.total_discount) || 0)
        row.cashPaid += Number(s.cash_received) || 0
        row.bankPaid += bankReceived(s)
        row.discount += Number(s.total_discount) || 0
        row.dues += Number(s.credit_amount) || 0
        byDay.set(day, row)

        const applied = Math.min(
          Number(s.total_received) || 0,
          Number(s.previous_dues) || 0,
        )
        if (applied > 0) {
          const d = duesByDay.get(day) ?? { date: day, duesAmount: 0, receiptAmount: 0 }
          d.duesAmount += Number(s.previous_dues) || 0
          d.receiptAmount += applied
          duesByDay.set(day, d)
        }
      }

      // The purchase rows above already show each voucher's paid-on-the-
      // day amount, so its expense must not print a second time here.
      const partyPayments: PartyPaymentRow[] = expenses
        .filter((e) => e.category === "party_payment" && !isPaidOnVoucher(e))
        .map((e) => ({
          supplier: supplierNameOf(e),
          date: e.date,
          amount: Number(e.amount) || 0,
        }))

      const ownExpenses: OwnExpenseRow[] = expenses
        .filter((e) => e.category !== "party_payment")
        .map((e) => ({
          // The shop's own wording wins where it gave one; that is the
          // whole point of the custom head.
          head:
            (e.custom_category || "").trim() ||
            labelFor(
              labels,
              "expense_category",
              e.category,
              EXPENSE_HEADS[e.category] || e.category || "Other",
            ),
          date: e.date,
          // Only a real linked supplier. An own expense's description
          // is a note about what the money bought, not who took it.
          party: joinedSupplierName(e),
          amount: Number(e.amount) || 0,
        }))

      const data: BalanceSheetReportData = {
        partyPurchases,
        salesHistory: Array.from(byDay.values()).sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
        duesReceived: Array.from(duesByDay.values()).sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
        incomeHistory: incomes.map((i) => ({
          date: i.date,
          amount: Number(i.amount) || 0,
        })),
        partyPayments,
        ownExpenses,
      }

      if (!printBalanceSheet({ header, period: periodText(), data })) popupBlocked()
    } catch (err: any) {
      reportFailed("Balance Sheet", err)
    } finally {
      setPrinting(null)
    }
  }

  const handlePrintExpenseVoucher = () => {
    // The shop's own spending, the way its previous software printed it.
    // Supplier payments are settling stock, not running the shop; they
    // have their own sheet in Party Dues Payment.
    const rows = shownExpenseRows
      .filter((e: any) => e.category !== "party_payment")
      .map((e: any) => ({
        type: getExpenseCategory(e),
        voucherNo: e.reference ?? null,
        date: localDay(dayOf(e)),
        person: e.description && e.description !== "No description" ? e.description : null,
        amount: Number(e.amount) || 0,
      }))
    const filters =
      expenseFilterKey !== "all" ? `Expense type: ${shownExpenseGroups[0]?.name ?? ""}` : undefined
    if (!printOwnExpense({ header, period: periodText(), rows, filters })) popupBlocked()
  }

  const handlePrintIncomeVoucher = () => {
    // Laid out as the Own Expense Report is, the other way round: one
    // block per income type, Group Total under each, a Grand Total.
    const rows = shownIncomeRows.map((r: any) => ({
      type: incomeTypeLabel(r.income_type, r.custom_type, labels),
      date: localDay(dayOf(r)),
      from: (r.description || "").trim() || r.supplier_name || null,
      destination: r.destination_type === "bank" ? "Bank" : "Cash",
      amount: Number(r.amount) || 0,
    }))
    const filters =
      incomeFilterKey !== "all" ? `Income type: ${shownIncomeGroups[0]?.name ?? ""}` : undefined
    if (!printIncomeReport({ header, period: periodText(), rows, filters })) popupBlocked()
  }

  const printLedger = (title: string, entries: LedgerEntry[], includeParty: boolean) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast({
        title: "Preview did not open",
        description: "Allow pop-ups for this application, then try again.",
        variant: "destructive",
      });
      return;
    }
    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 15px; font-size: 12px; }
          .header { text-align: center; margin-bottom: 20px; }
          .company-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
          .title { font-size: 14px; font-weight: bold; margin-bottom: 5px; }
          .period { font-size: 11px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; border: 2px solid black; }
          th, td { border: 1px solid black; padding: 6px; text-align: left; font-size: 11px; }
          th { background-color: #f0f0f0; font-weight: bold; text-align: center; }
          .amount-cell { text-align: right; font-family: monospace; }
          .total-row { font-weight: bold; background-color: #f0f0f0; }
          @media print { body { margin: 10px; } }
        ${DOCUMENT_TOOLBAR_CSS}
        </style>
      </head>
      <body>
        ${documentToolbar(title)}
        <div class="header">
          <div class="company-name">${header.name}</div>
          <div class="address">${header.addressLine}</div>
          <div class="title">${title}</div>
          <div class="period">${getDateRangeDescription()}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              ${includeParty ? '<th>Supplier</th>' : ''}
              <th>Description</th>
              <th>Voucher Type</th>
              <th>Dr.</th>
              <th>Cr.</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(entry => `
              <tr>
                <td>${new Date(entry.date).toLocaleDateString('en-GB')}</td>
                ${includeParty ? `<td>${entry.supplier || '—'}</td>` : ''}
                <td>${entry.description}</td>
                <td>${entry.voucherType}</td>
                <td class="amount-cell">${entry.debit > 0 ? entry.debit.toFixed(2) : ''}</td>
                <td class="amount-cell">${entry.credit > 0 ? entry.credit.toFixed(2) : ''}</td>
                <td class="amount-cell">${entry.balance.toFixed(2)}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td colspan="${includeParty ? '4' : '3'}">Total</td>
              <td class="amount-cell">${entries.reduce((s, e) => s + e.debit, 0).toFixed(2)}</td>
              <td class="amount-cell">${entries.reduce((s, e) => s + e.credit, 0).toFixed(2)}</td>
              <td class="amount-cell">${entries.length > 0 ? entries[entries.length - 1].balance.toFixed(2) : '0.00'}</td>
            </tr>
          </tbody>
        </table>

        <div style="text-align: center; margin-top: 20px; font-weight: bold; font-size: 14px;">
          Closing Balance: ৳${entries.length > 0 ? entries[entries.length - 1].balance.toFixed(2) : '0.00'}
        </div>
      </body>
      </html>
    `

    printWindow.document.write(content)
    printWindow.document.close()
  }

  // Export CSV
  const handleExportCSV = (type: 'purchase' | 'expense' | 'income') => {
    let filename = ''
    let rows: string[] = []
    
    try {
      switch(type) {
        case 'purchase':
          filename = 'purchase-ledger'
          rows = filteredPurchaseEntries.map(e => [
            new Date(e.date).toLocaleDateString(),
            e.supplier || '-',
            `"${e.description}"`,
            e.voucherType,
            e.debit || 0,
            e.credit || 0,
            e.balance.toFixed(2)
          ].join(','))
          break
          
        case 'expense':
          filename = 'expense-voucher'
          rows = shownExpenseRows.map((e: any) => [
            new Date(dayOf(e)).toLocaleDateString('en-GB'),
            getExpenseCategory(e),
            `"${e.description}"`,
            e.amount.toFixed(2)
          ].join(','))
          break
          
        case 'income':
          filename = 'income-voucher'
          rows = shownIncomeRows.map((e: any) => [
            new Date(dayOf(e)).toLocaleDateString('en-GB'),
            incomeTypeLabel(e.income_type, e.custom_type, labels),
            e.destination_type === 'bank' ? 'Bank' : 'Cash',
            `"${e.description || '-'}"`,
            e.amount.toFixed(2)
          ].join(','))
          break
      }
      
      let header = ''
      if (type === 'expense') {
        header = 'Date,Category,Description,Amount'
      } else if (type === 'income') {
        header = 'Date,Type,Destination,Description,Amount'
      } else {
        header = 'Date,Party,Description,Voucher Type,Debit,Credit,Balance'
      }
      
      const csv = [header, ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}-${new Date().toISOString().slice(0,10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      
      toast({
        title: "Export successful",
        description: `Exported ${rows.length} entries`
      })
    } catch (err) {
      toast({
        title: "Export failed",
        description: "Could not export data",
        variant: "destructive"
      })
    }
  }

  const formatCurrency = (amount: number) => `৳${amount.toFixed(2)}`

  if (loading && !hasLoaded) {
    return (
      <div className="flex-1 space-y-6 p-8 pt-6">
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading ledger…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Accounting Ledger</h1>
          <ManagerAccessBadge mode="view" />
        </div>
        <Button variant="outline" onClick={() => dateFilterEnabled && loadLedgerData(startDate || '2000-01-01', endDate || today)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Dates and search, on one line */}
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
                  setStartDate(today)
                  setEndDate(today)
                }}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDate("")
                  setEndDate("")
                }}
              >
                Clear
              </Button>
              <span className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                <span>
                  Showing: <span className="font-medium text-foreground">{getDateRangeDescription()}</span>
                </span>
                {loading && (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Updating…
                  </span>
                )}
              </span>
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  aria-label="Search transactions"
                  placeholder="Search transactions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-9 pl-8"
                />
              </div>
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

      {/* Summary — compacted to match the stat strip on Bank Info and
          the other pages; these figures are read once, not fifty times. */}
      <Card>
        <CardContent className="px-4 py-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold">Summary</span>
            <span className="text-xs text-muted-foreground">{getDateRangeDescription()}</span>
          </div>
          <StatStrip
            className="border-0 bg-transparent px-0 py-0"
            stats={[
              {
                label: "Total Revenue",
                value: formatCurrency(profitLoss.revenue),
                tone: "money",
                hint: "Sales + Income",
              },
              {
                label: "Total Expenses",
                value: formatCurrency(profitLoss.expenses),
                tone: "critical",
                hint: "All Operating Costs",
              },
              {
                label: "Net Profit",
                value: formatCurrency(profitLoss.net),
                tone: profitLoss.net >= 0 ? "money" : "critical",
                hint: "Revenue − Expenses",
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="purchase-ledger" className="space-y-6">
        <TabsList>
          <TabsTrigger value="purchase-ledger">Purchase Ledger</TabsTrigger>
          <TabsTrigger value="expense-voucher">Expense Voucher</TabsTrigger>
          <TabsTrigger value="income-voucher">Income Voucher</TabsTrigger>
          <TabsTrigger value="profit-loss">Profit & Loss</TabsTrigger>
          <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
        </TabsList>

        {/* Purchase Ledger */}
        <TabsContent value="purchase-ledger" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Purchase Ledger</CardTitle>
                  <CardDescription>Purchases, supplier payments, and returns</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleExportCSV('purchase')}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handlePrintPartyDues}
                    disabled={printing !== null}
                  >
                    {printing === "dues" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Printer className="mr-2 h-4 w-4" />
                    )}
                    Party Dues Payment
                  </Button>
                  <Button onClick={handlePrintPurchaseLedger}>
                    <Printer className="mr-2 h-4 w-4" />
                    Purchase Ledger
                  </Button>
                </div>
              </div>
              {/* Supplier Filter Dropdown */}
              <div className="mt-4 flex items-center gap-4">
                <Label htmlFor="supplier-filter-purchase" className="whitespace-nowrap">Filter by Supplier:</Label>
                <Select value={selectedSupplierPurchase} onValueChange={setSelectedSupplierPurchase}>
                  <SelectTrigger id="supplier-filter-purchase" className="w-64">
                    <SelectValue placeholder="All Suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suppliers</SelectItem>
                    {getUniqueSuppliers(purchaseEntries).filter(s => s && s.trim() !== '').map(supplier => (
                      <SelectItem key={supplier} value={supplier}>
                        {supplier}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSupplierPurchase !== "all" && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setSelectedSupplierPurchase("all")}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Transactions</TableHead>
                    <TableHead className="text-right">Purchases (Dr)</TableHead>
                    <TableHead className="text-right">Payments (Cr)</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseSummary.opening.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="text-right text-green-600">
                        {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(entry.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {purchaseSummary.suppliers.map((group) => (
                    <TableRow
                      key={supplierKey(group.name)}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setOpenSupplier(group.name)}
                      title="Click to see every transaction"
                    >
                      <TableCell className="font-medium">{group.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {group.entries.length} {group.entries.length === 1 ? 'transaction' : 'transactions'}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {group.debit > 0 ? formatCurrency(group.debit) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {group.credit > 0 ? formatCurrency(group.credit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(group.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {purchaseSummary.others.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="text-right text-green-600">
                        {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(entry.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted font-bold">
                    <TableCell colSpan={2}>Total</TableCell>
                    <TableCell className="text-right text-green-600">
                      {formatCurrency(filteredPurchaseEntries.reduce((s, e) => s + e.debit, 0))}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatCurrency(filteredPurchaseEntries.reduce((s, e) => s + e.credit, 0))}
                    </TableCell>
                    <TableCell className="text-right">
                      {filteredPurchaseEntries.length > 0 ? formatCurrency(filteredPurchaseEntries[filteredPurchaseEntries.length - 1].balance) : formatCurrency(0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {selectedSupplierPurchase !== "all" && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-sm font-semibold text-blue-900">
                    ✓ Showing transactions for: {selectedSupplierPurchase}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <Dialog open={openedSupplier !== null} onOpenChange={(open) => { if (!open) setOpenSupplier(null) }}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{openedSupplier?.name}</DialogTitle>
              <DialogDescription>
                Opening balance, then every purchase, payment and return for this supplier
              </DialogDescription>
            </DialogHeader>
            {openedSupplier && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Voucher Type</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/60">
                    <TableCell colSpan={2}>Opening Balance (Brought Forward)</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell className="text-right text-green-600">
                      {openedSupplier.opening > 0 ? formatCurrency(openedSupplier.opening) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {openedSupplier.opening < 0 ? formatCurrency(Math.abs(openedSupplier.opening)) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(openedSupplier.opening)}
                    </TableCell>
                  </TableRow>
                  {openedSupplier.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{new Date(entry.date).toLocaleDateString('en-GB')}</TableCell>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell>
                        <Badge variant={entry.voucherType === 'Purchase' ? 'default' : 'secondary'}>
                          {entry.voucherType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(entry.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted font-bold">
                    <TableCell colSpan={3}>Total (Balance = closing, incl. opening)</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(openedSupplier.debit)}</TableCell>
                    <TableCell className="text-right text-red-600">{formatCurrency(openedSupplier.credit)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(openedSupplier.balance)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </DialogContent>
        </Dialog>

        {/* Expense Voucher Tab */}
        <TabsContent value="expense-voucher" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Expense Voucher</CardTitle>
                  <CardDescription>All expense transactions for the period</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleExportCSV('expense')}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button onClick={handlePrintExpenseVoucher}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <Label htmlFor="expense-filter" className="whitespace-nowrap">Filter by Category:</Label>
                <Select value={expenseFilterKey} onValueChange={setExpenseFilter}>
                  <SelectTrigger id="expense-filter" className="w-64">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {expenseGroups.map((g) => (
                      <SelectItem key={g.key} value={g.key}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {expenseFilterKey !== "all" && (
                  <Button variant="ghost" size="sm" onClick={() => setExpenseFilter("all")}>
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <VoucherGroupTable
                groups={shownExpenseGroups}
                headLabel="Category"
                amountClass="text-red-600"
                emptyText="No expenses found for this period"
                totalLabel="Total Expenses"
                money={formatCurrency}
                onOpen={setOpenExpenseGroup}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <VoucherGroupDialog
          group={openedExpenseGroup}
          description="Every expense under this head in the period"
          amountClass="text-red-600"
          money={formatCurrency}
          onClose={() => setOpenExpenseGroup(null)}
        />

        {/* Income Voucher Tab */}
        <TabsContent value="income-voucher" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Income Voucher</CardTitle>
                  <CardDescription>All income transactions for the period</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleExportCSV('income')}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button onClick={handlePrintIncomeVoucher}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <Label htmlFor="income-filter" className="whitespace-nowrap">Filter by Type:</Label>
                <Select value={incomeFilterKey} onValueChange={setIncomeFilter}>
                  <SelectTrigger id="income-filter" className="w-64">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {incomeGroups.map((g) => (
                      <SelectItem key={g.key} value={g.key}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {incomeFilterKey !== "all" && (
                  <Button variant="ghost" size="sm" onClick={() => setIncomeFilter("all")}>
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <VoucherGroupTable
                groups={shownIncomeGroups}
                headLabel="Type"
                amountClass="text-green-600"
                emptyText="No income found for this period"
                totalLabel="Total Income"
                money={formatCurrency}
                onOpen={setOpenIncomeGroup}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <VoucherGroupDialog
          group={openedIncomeGroup}
          description="Every income of this type in the period"
          amountClass="text-green-600"
          extra={{
            label: "Destination",
            value: (row) => (row.destination_type === "bank" ? "Bank" : "Cash"),
          }}
          money={formatCurrency}
          onClose={() => setOpenIncomeGroup(null)}
        />

        {/* Profit & Loss */}
        <TabsContent value="profit-loss" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Profit & Loss Statement</CardTitle>
                  <CardDescription>Revenue and expense summary</CardDescription>
                </div>
                <Button onClick={handlePrintProfitLoss} disabled={printing !== null}>
                  {printing === "pl" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-4 w-4" />
                  )}
                  Print
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Revenue</h3>
                  <div className="flex justify-between py-2">
                    <span>Sales Revenue & Income</span>
                    <span className="font-medium">{formatCurrency(profitLoss.revenue)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-semibold">
                    <span>Total Revenue</span>
                    <span>{formatCurrency(profitLoss.revenue)}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-4">Expenses</h3>
                  <div className="flex justify-between py-2">
                    <span>Total Expenses (Including Purchases)</span>
                    <span className="font-medium">{formatCurrency(profitLoss.expenses)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-semibold">
                    <span>Total Expenses</span>
                    <span>{formatCurrency(profitLoss.expenses)}</span>
                  </div>
                </div>

                <div className="border-t-2 pt-4 flex justify-between text-xl font-bold">
                  <span>Net Profit</span>
                  <span className={profitLoss.net >= 0 ? "text-green-600" : "text-red-600"}>
                    {formatCurrency(profitLoss.net)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Balance Sheet */}
        <TabsContent value="balance-sheet" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Balance Sheet</CardTitle>
                  <CardDescription>Financial summary for the period</CardDescription>
                </div>
                <Button onClick={handlePrintBalanceSheet} disabled={printing !== null}>
                  {printing === "bs" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-4 w-4" />
                  )}
                  Print
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {balanceSheetData && (
                <div className="space-y-4">
                  <div className="text-center mb-6">
                    <div className="text-sm text-green-600 mb-2">
                      {getDateRangeDescription()}
                    </div>
                    <div className="text-xl font-bold text-purple-600">BALANCE SHEET</div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between py-3 border-b">
                      <span className="font-medium">Total Purchase Amount</span>
                      <span className="font-semibold">{formatCurrency(balanceSheetData.totalPurchaseAmount)}</span>
                    </div>
                    <div className="flex justify-between py-3 border-b">
                      <span className="font-medium">Total Sales Amount</span>
                      <span className="font-semibold">{formatCurrency(balanceSheetData.totalSalesAmount)}</span>
                    </div>
                    <div className="flex justify-between py-3 border-b">
                      <span className="font-medium">Total Supplier Payment Amount</span>
                      <span className="font-semibold">{formatCurrency(balanceSheetData.totalPartyPaymentAmount)}</span>
                    </div>
                    <div className="flex justify-between py-3 border-b">
                      <span className="font-medium">Total Shop Expense Amount</span>
                      <span className="font-semibold">{formatCurrency(balanceSheetData.totalOwnExpenseAmount)}</span>
                    </div>
                    <div className="flex justify-between py-3 border-b">
                      <span className="font-medium">Total Customer Dues Receive Amt</span>
                      <span className="font-semibold">{formatCurrency(balanceSheetData.totalCustomerDuesReceiveAmount)}</span>
                    </div>
                    <div className="flex justify-between py-3 border-b">
                      <span className="font-medium">Total Income Amount</span>
                      <span className="font-semibold">{formatCurrency(balanceSheetData.totalIncomeAmount)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}