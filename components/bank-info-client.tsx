"use client"

import { useState, useEffect } from "react"
import { Building, CreditCard, DollarSign, Printer } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/utils/supabase/component"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { DateRangeFilter } from "@/components/date-range-filter"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRole } from "@/components/role-provider"
import { ManagerAccessBadge } from "@/components/role-badge"
import { StatStrip } from "@/components/stat-strip"
import { shopHeader } from "@/lib/utils/shop-header"
import { printBankDetails, printBankSummary } from "@/lib/bank-reports"

type BankAccount = {
  id: string
  bankName: string
  accountName: string
  accountNumber: string
  accountType: string
  balance: number
  currency: string
  status: "active" | "inactive"
  branch: string
  swiftCode?: string
  routingNumber?: string
}

type Transaction = {
  id: string
  date: string
  time: string
  bankName: string
  method: string
  amount: number
  description: string
  status: "completed" | "pending" | "failed"
  accountId: string
  imei: string
  /**
   * Which way the money went.
   *
   * This screen used to be built from sales alone, so every row was
   * money coming in. An expense paid by bank transfer, a refund put
   * back on a customer's card, or the owner banking cash never appeared
   * at all — which made the page impossible to reconcile against a real
   * bank statement, because it only ever showed one side.
   */
  direction: "in" | "out"
}

const UNKNOWN_BANK_EARLY = "Not specified"

export function BankInfoClient() {
  const supabase = createClient()
  const { hasPermission, currentShopId, shops } = useRole()
  // Reports print the shop's own letterhead, not a hard-coded one.
  const header = shopHeader(shops.find((sh) => sh.id === currentShopId))
  const [filterBankName, setFilterBankName] = useState("all")
  const [filterMethod, setFilterMethod] = useState("all")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch transactions from Supabase sales table
  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) {
      setLoading(false)
      return
    }

    async function fetchBankTransactions() {
      setLoading(true)
      try {
        const { data: sales, error } = await supabase
          .from('sales')
          .select('*')
          .eq('organization_id', currentShopId)
          .eq('status', 'completed')
          .order('sale_date', { ascending: false })

        if (error) {
          console.error('Error fetching sales:', error)
          setTransactions([])
          return
        }

        // Transform sales data into transactions
        const newTransactions: Transaction[] = []

        // Payment lines, where they exist.
        //
        // These carry the actual route — BRAC Bank → PULM — which the
        // fixed columns on `sales` cannot express: they have one card
        // column and one bank field, so a split across two banks loses
        // one of them, and a method like PULM has nowhere to go at all.
        //
        // Sales recorded before the lines table existed fall back to the
        // old column logic below, so nothing disappears from the page.
        const linedSaleIds = new Set<number>()
        try {
          const { data: lines } = await supabase
            .from("sale_payments")
            .select("sales_id, method, bank_name, channel, amount, created_at")
            .eq("organization_id", currentShopId)
            .neq("method", "cash")

          const invoiceOf = new Map(
            (sales ?? []).map((s: any) => [s.id, s.invoice_number])
          )

          // A payment line is written the moment the sale is recorded,
          // so its own created_at is the day it was TYPED IN. For a
          // backdated sale that is the wrong day; the sale it belongs
          // to knows the right one.
          const dateOf = new Map(
            (sales ?? []).map((s: any) => [s.id, s.sale_date ?? s.created_at])
          )

          for (const line of lines ?? []) {
            linedSaleIds.add(line.sales_id)
            const when = new Date(dateOf.get(line.sales_id) ?? line.created_at)
            newTransactions.push({
              id: `TXN-LINE-${line.sales_id}-${line.channel ?? line.method}`,
              date: when.toISOString().split("T")[0],
              time: when.toTimeString().slice(0, 5),
              bankName: line.bank_name || UNKNOWN_BANK_EARLY,
              method: line.channel || "Bank Transfer",
              amount: Number(line.amount ?? 0),
              description: `Sale payment — Invoice ${invoiceOf.get(line.sales_id) ?? line.sales_id}`,
              status: "completed",
              accountId: "",
              imei: String(line.sales_id),
              direction: "in",
            })
          }
        } catch (err: any) {
          // The table may not exist yet. The column fallback below still
          // produces a usable page.
          console.warn("Payment lines unavailable:", err?.message ?? err)
        }

        sales?.forEach((sale) => {
          // Already covered in detail by its payment lines.
          if (linedSaleIds.has(sale.id)) return

          // sale_date, not created_at: a sale entered days after it
          // was made shows against the day it was made, so this page
          // reconciles against the Day Cashbook rather than against
          // the day someone happened to type it in.
          const saleDate = new Date(sale.sale_date ?? sale.created_at)
          const date = saleDate.toISOString().split('T')[0]
          const time = saleDate.toTimeString().slice(0, 5)

          // bKash transactions - BRAC Bank
          if (sale.bkash_received > 0) {
            newTransactions.push({
              id: `TXN-BKASH-${sale.id}`,
              date,
              time,
              bankName: 'BRAC Bank Limited - Star Power',
              method: 'bKash',
              amount: sale.bkash_received,
              description: `Sale payment via bKash - Invoice ${sale.invoice_number}`,
              status: 'completed',
              accountId: 'BANK-002',
              imei: sale.id.toString(),
              direction: "in" as const
            })
          }

          // Nagad transactions - BRAC Bank
          if (sale.nagad_received > 0) {
            newTransactions.push({
              id: `TXN-NAGAD-${sale.id}`,
              date,
              time,
              bankName: 'BRAC Bank Limited - Star Power',
              method: 'Nagad',
              amount: sale.nagad_received,
              description: `Sale payment via Nagad - Invoice ${sale.invoice_number}`,
              status: 'completed',
              accountId: 'BANK-002',
              imei: sale.id.toString(),
              direction: "in" as const
            })
          }

          // Rocket transactions - Dutch-Bangla Bank
          if (sale.rocket_received > 0) {
            newTransactions.push({
              id: `TXN-ROCKET-${sale.id}`,
              date,
              time,
              bankName: 'Dutch-Bangla Bank Limited',
              method: 'Rocket',
              amount: sale.rocket_received,
              description: `Sale payment via Rocket - Invoice ${sale.invoice_number}`,
              status: 'completed',
              accountId: 'BANK-001',
              imei: sale.id.toString(),
              direction: "in" as const
            })
          }

          // Upay transactions - UCB Bank
          if (sale.upay_received > 0) {
            newTransactions.push({
              id: `TXN-UPAY-${sale.id}`,
              date,
              time,
              bankName: 'UCB Bank',
              method: 'Upay',
              amount: sale.upay_received,
              description: `Sale payment via Upay - Invoice ${sale.invoice_number}`,
              status: 'completed',
              accountId: 'BANK-003',
              imei: sale.id.toString(),
              direction: "in" as const
            })
          }

          // Card transactions - use card_bank from sale
          if (sale.card_received > 0) {
            newTransactions.push({
              id: `TXN-CARD-${sale.id}`,
              date,
              time,
              bankName: sale.card_bank || 'Unknown Bank',
              method: 'Card Payment',
              amount: sale.card_received,
              description: `Card payment - Invoice ${sale.invoice_number}`,
              status: 'completed',
              accountId: 'BANK-001',
              imei: sale.id.toString(),
              direction: "in" as const
            })
          }

          // Bank transfer transactions - use bank_transfer_bank from sale
          if (sale.bank_transfer_received > 0) {
            newTransactions.push({
              id: `TXN-TRANSFER-${sale.id}`,
              date,
              time,
              bankName: sale.bank_transfer_bank || 'Unknown Bank',
              method: 'Bank Transfer',
              amount: sale.bank_transfer_received,
              description: `Bank transfer - Invoice ${sale.invoice_number}`,
              status: 'completed',
              accountId: 'BANK-001',
              imei: sale.id.toString(),
              direction: "in" as const
            })
          }
        })

        // ----------------------------------------------------------
        // Money that leaves or enters the bank WITHOUT being a sale.
        //
        // Cash-settled rows are skipped throughout: this page is about
        // what a bank statement would show, and cash never touches it.
        //
        // Expenses and income now record which account they used, so
        // they land under the right bank. Returns still do not, and
        // rows entered before that field existed have nothing to read —
        // both show as "Not specified" rather than being attributed to
        // an account they may not have come from.
        // ----------------------------------------------------------
        const stamp = (iso: string) => {
          const d = new Date(iso)
          return { date: d.toISOString().split('T')[0], time: d.toTimeString().slice(0, 5) }
        }
        const UNKNOWN_BANK = UNKNOWN_BANK_EARLY

        const [expensesRes, incomeRes, salesReturnsRes, purchaseReturnsRes] = await Promise.all([
          supabase
            .from('expenses')
            .select('id, date, amount, payment_method, bank_name, description, reference, created_at')
            .eq('organization_id', currentShopId)
            .neq('payment_method', 'cash'),
          supabase
            .from('income_owner')
            .select('id, date, amount, destination_type, bank_name, description, created_at')
            .eq('organization_id', currentShopId)
            .eq('destination_type', 'bank'),
          supabase
            .from('sales_returns')
            .select('id, total_refund_amount, refund_method, created_at')
            .eq('organization_id', currentShopId),
          supabase
            .from('purchase_returns')
            .select('id, total_credit_amount, credit_method, created_at')
            .eq('organization_id', currentShopId),
        ])

        const prettyMethod = (m: string | null) =>
          (m ?? '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown'

        // Expenses paid by card, mobile banking or transfer — money out.
        for (const e of expensesRes.data ?? []) {
          const { date, time } = stamp(e.created_at ?? e.date)
          newTransactions.push({
            id: `TXN-EXP-${e.id}`,
            date, time,
            bankName: e.bank_name || UNKNOWN_BANK,
            method: prettyMethod(e.payment_method),
            amount: Number(e.amount ?? 0),
            description: `Expense — ${e.description ?? e.reference ?? 'no description'}`,
            status: 'completed',
            accountId: '',
            imei: '',
            direction: 'out',
          })
        }

        // Owner or party money banked — money in.
        for (const i of incomeRes.data ?? []) {
          const { date, time } = stamp(i.created_at ?? i.date)
          newTransactions.push({
            id: `TXN-INC-${i.id}`,
            date, time,
            bankName: i.bank_name || UNKNOWN_BANK,
            method: 'Bank Deposit',
            amount: Number(i.amount ?? 0),
            description: `Income — ${i.description ?? 'banked'}`,
            status: 'completed',
            accountId: '',
            imei: '',
            direction: 'in',
          })
        }

        // Customer refunds not paid in cash — money out.
        for (const r of salesReturnsRes.data ?? []) {
          const method = (r.refund_method ?? '').toLowerCase()
          if (!method || method === 'cash') continue
          const { date, time } = stamp(r.created_at)
          newTransactions.push({
            id: `TXN-SRET-${r.id}`,
            date, time,
            bankName: UNKNOWN_BANK,
            method: prettyMethod(r.refund_method),
            amount: Number(r.total_refund_amount ?? 0),
            description: `Sales return refund #${r.id}`,
            status: 'completed',
            accountId: '',
            imei: '',
            direction: 'out',
          })
        }

        // Credit received back from a supplier — money in.
        for (const r of purchaseReturnsRes.data ?? []) {
          const method = (r.credit_method ?? '').toLowerCase()
          if (!method || method === 'cash') continue
          const { date, time } = stamp(r.created_at)
          newTransactions.push({
            id: `TXN-PRET-${r.id}`,
            date, time,
            bankName: UNKNOWN_BANK,
            method: prettyMethod(r.credit_method),
            amount: Number(r.total_credit_amount ?? 0),
            description: `Purchase return credit #${r.id}`,
            status: 'completed',
            accountId: '',
            imei: '',
            direction: 'in',
          })
        }

        newTransactions.sort((a, b) =>
          `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
        )

        setTransactions(newTransactions)
      } catch (error) {
        console.error('Error processing transactions:', error)
        setTransactions([])
      } finally {
        setLoading(false)
      }
    }

    fetchBankTransactions()
  }, [supabase, currentShopId])

  // Methods available under the chosen bank. Derived from the rows on
  // screen rather than from the configured list, so the dropdown can
  // never offer a method that returns nothing.
  const methodOptions = Array.from(
    new Set(
      transactions
        .filter((t) => filterBankName === "all" || t.bankName === filterBankName)
        .map((t) => t.method)
        .filter(Boolean)
    )
  ).sort()

  const filteredTransactions = transactions.filter((transaction) => {
    const matchesBankName = filterBankName === "all" || transaction.bankName === filterBankName
    const matchesMethod = filterMethod === "all" || transaction.method === filterMethod

    // Date range filter
    let matchesDateRange = true
    if (startDate || endDate) {
      const transactionDate = transaction.date
      if (startDate && transactionDate < startDate) {
        matchesDateRange = false
      }
      if (endDate && transactionDate > endDate) {
        matchesDateRange = false
      }
    }

    return matchesBankName && matchesMethod && matchesDateRange
  })

  // In and out are counted separately. Summing them together would
  // report an expense paid by bank transfer as a deposit.
  const totalIn = filteredTransactions
    .filter((t) => t.direction === "in")
    .reduce((sum, t) => sum + t.amount, 0)
  const totalOut = filteredTransactions
    .filter((t) => t.direction === "out")
    .reduce((sum, t) => sum + t.amount, 0)
  const totalAmount = totalIn - totalOut

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>
      case "failed":
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getBankIcon = (method: string) => {
    if (method.toLowerCase().includes("card")) {
      return <CreditCard className="h-4 w-4 text-blue-600" />
    } else if (["bkash", "nagad", "rocket", "upay"].some(m => method.toLowerCase().includes(m))) {
      return <DollarSign className="h-4 w-4 text-green-600" />
    } else {
      return <Building className="h-4 w-4 text-purple-600" />
    }
  }

  // Get unique bank names for filter
  const uniqueBankNames = Array.from(new Set(transactions.map(t => t.bankName))).sort()

  // ------------------------------------------------------------------
  // The two printed sheets
  // ------------------------------------------------------------------

  const periodText = () => {
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    if (startDate && endDate) return `${fmt(startDate)}-- --${fmt(endDate)}`
    if (startDate) return `From ${fmt(startDate)}`
    if (endDate) return `Up to ${fmt(endDate)}`
    return "All dates"
  }

  /**
   * What reached the bank, per account per day.
   *
   * Money IN only. "Bank Cash Information" is the sheet held next to a
   * statement to check what landed; folding outgoings into the same
   * column would net them off and answer a different question. What
   * went out is on the list on screen, which shows both.
   */
  const bankRows = filteredTransactions
    .filter((t) => t.direction === "in")
    .map((t) => ({ date: t.date, bankName: t.bankName, amount: t.amount }))

  const noWindow = () =>
    toast.error("Print window did not open. Allow pop-ups for this application.")

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">Bank Information</h1>
            <ManagerAccessBadge mode="view" />
          </div>
          <p className="text-muted-foreground">
            Track all non-cash transactions from completed sales
          </p>
        </div>
        {/* Two sheets over the same figures: one line per account, or
            one line per account per day. Both follow the filters above,
            so what prints is what is on screen. */}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (!printBankSummary({ header, period: periodText(), rows: bankRows }))
                noWindow()
            }}
            disabled={bankRows.length === 0}
          >
            <Printer className="mr-2 h-4 w-4" />
            Bank Summary
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!printBankDetails({ header, period: periodText(), rows: bankRows }))
                noWindow()
            }}
            disabled={bankRows.length === 0}
          >
            <Printer className="mr-2 h-4 w-4" />
            Details
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="contents">
                <div className="w-full space-y-1 sm:w-[260px]">
                  <Label htmlFor="filter-bank-name" className="text-xs">Bank</Label>
                  <Select
                    value={filterBankName}
                    onValueChange={(v) => {
                      setFilterBankName(v)
                      // The method list belongs to the bank, so a
                      // method left selected from the previous one would
                      // silently match nothing.
                      setFilterMethod("all")
                    }}
                  >
                    <SelectTrigger id="filter-bank-name" className="h-9">
                      <SelectValue placeholder="All Banks" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Banks</SelectItem>
                      {uniqueBankNames.map((bankName) => (
                        <SelectItem key={bankName} value={bankName}>
                          {bankName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Built from the transactions actually present for the
                    chosen bank, so every option returns something. */}
                <div className="w-full space-y-1 sm:w-[200px]">
                  <Label htmlFor="filter-method" className="text-xs">Method</Label>
                  <Select value={filterMethod} onValueChange={setFilterMethod}>
                    <SelectTrigger id="filter-method" className="h-9">
                      <SelectValue placeholder="All Methods" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Methods</SelectItem>
                      {methodOptions.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DateRangeFilter
                startDate={startDate}
                endDate={endDate}
                onStartChange={setStartDate}
                onEndChange={setEndDate}
                idPrefix="bank"
              />
            </div>
          </CardContent>
        </Card>

        {/* Four figures do not need a header block and three
            different type sizes. Compacted to match the stat cards on
            every other page. */}
        <Card>
          <CardContent className="px-4 py-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-semibold">Summary</span>
              <span className="text-xs text-muted-foreground">
                {filteredTransactions.length} transaction
                {filteredTransactions.length === 1 ? "" : "s"} for selected filters
              </span>
            </div>
            <StatStrip
              className="border-0 bg-transparent px-0 py-0"
              stats={[
                { label: "Money in", value: `৳${totalIn.toLocaleString()}`, tone: "money" },
                { label: "Money out", value: `৳${totalOut.toLocaleString()}`, tone: "critical" },
                { label: "Net", value: `৳${(totalIn - totalOut).toLocaleString()}`, tone: "money" },
              ]}
            />
          
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Non-Cash Transactions</CardTitle>
            <CardDescription>
              All card, mobile banking, and bank transfer transactions from completed sales
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Bank Name</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading transactions...
                    </TableCell>
                  </TableRow>
                ) : filteredTransactions.length > 0 ? (
                  filteredTransactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{transaction.date}</p>
                          <p className="text-sm text-muted-foreground">{transaction.time}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getBankIcon(transaction.method)}
                          <span>{transaction.bankName}</span>
                        </div>
                      </TableCell>
                      <TableCell>{transaction.method}</TableCell>
                      {/* Signed and coloured, so a refund is never
                          mistaken for a deposit at a glance. */}
                      <TableCell
                        className={`font-medium ${
                          transaction.direction === "out"
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {transaction.direction === "out" ? "−" : "+"}৳
                        {transaction.amount.toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{transaction.description}</TableCell>
                      <TableCell className="font-mono text-sm">{transaction.imei}</TableCell>
                      <TableCell>{getStatusBadge(transaction.status)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No transactions found matching your criteria.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
