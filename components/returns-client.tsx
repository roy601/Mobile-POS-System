"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Eye,
  Filter,
  Package,
  Printer,
  RotateCcw,
  Search,
  ShoppingCart,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SalesReturnForm } from "@/components/sales-return-form"
import { PurchaseReturnForm } from "@/components/purchase-return-form"
import { DateRangeFilter } from "@/components/date-range-filter"
import { createClient } from "@/utils/supabase/component"
import { useToast } from "@/hooks/use-toast"
import { useRole } from "@/components/role-provider"
import { ManagerAccessBadge } from "@/components/role-badge"
import { StatStrip } from "@/components/stat-strip"
import { shopHeader } from "@/lib/utils/shop-header"
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt"

const supabase = createClient()

/** One unit that came back, with everything known about it. */
type ReturnItem = {
  id: string
  barcode: string
  productName: string
  modelNumber: string
  brand: string
  category: string
  variant: string
  color: string
  quantity: number
  unitPrice: number
  amount: number
  condition: string
}

type ReturnRecord = {
  id: string
  type: "sales" | "purchase"
  date: string
  /** SALE-46, or the return's own number where it has one. */
  refNo: string
  counterparty: string
  phone: string
  reason: string
  status: string
  /** Sales returns only: money out, or a swap paid on top of. */
  kind?: "exchange" | "refund"
  amount: number
  quantity: number
  notes: string
  method: string
  items: ReturnItem[]
  /** Exchange only: the handset handed over in place of the one returned. */
  replacement: ReturnItem | null
}

const money = (n: unknown) =>
  `৳${(Number(n) || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

const day = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB") : "—"

/** Everything the shop knows about a barcode, for filling the gaps. */
type Details = {
  productName?: string
  modelNumber?: string
  brand?: string
  category?: string
  variant?: string
  color?: string
}

export function ReturnsClient() {
  const { toast } = useToast()
  const { currentShopId, shops } = useRole()

  const [tab, setTab] = useState<"sales" | "purchase">("sales")

  const [searchTerm, setSearchTerm] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [selectedParty, setSelectedParty] = useState("All")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedBrand, setSelectedBrand] = useState("All")
  const [selectedModel, setSelectedModel] = useState("All")
  const [selectedVariant, setSelectedVariant] = useState("All")

  const [showSalesReturn, setShowSalesReturn] = useState(false)
  const [showPurchaseReturn, setShowPurchaseReturn] = useState(false)
  const [openRecord, setOpenRecord] = useState<ReturnRecord | null>(null)

  const [returns, setReturns] = useState<ReturnRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const shop = useMemo(
    () => shops.find((s) => s.id === currentShopId),
    [shops, currentShopId],
  )

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  const load = useCallback(async () => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      // ---- Sales returns
      const { data: sales, error: salesErr } = await supabase
        .from("sales_returns")
        .select(`
          id, return_date, original_sale_id, customer_name, customer_phone,
          return_reason, total_refund_amount, return_kind, price_difference,
          exchange_barcode, refund_method, notes, status,
          sales_return_items (
            id, barcode, product_name, model_number, color,
            quantity, unit_price, total_refund_amount, condition
          )
        `)
        .eq("organization_id", currentShopId)
        .order("return_date", { ascending: false })

      if (salesErr) {
        toast({
          title: "Failed to load sales returns",
          description: salesErr.message,
          variant: "destructive",
        })
      }

      // ---- Purchase returns
      //
      // return_no arrives with script 72. The app updates independently
      // of the database, so ask for it and fall back to the columns
      // that were always there — otherwise a till on the new build
      // shows no returns at all until someone opens the SQL editor.
      const purchaseColumns = (withNo: boolean) => `
          id, return_date, ${withNo ? "return_no," : ""} original_purchase_id,
          supplier, return_reason, credit_method, notes,
          total_credit_amount, status,
          purchase_return_items (
            id, barcode, product_name, model_number, color,
            return_quantity, unit_cost, total_credit_amount, condition
          )
        `

      let { data: purchases, error: purchaseErr } = await supabase
        .from("purchase_returns")
        .select(purchaseColumns(true))
        .eq("organization_id", currentShopId)
        .order("return_date", { ascending: false })

      if (
        purchaseErr &&
        (purchaseErr.code === "42703" ||
          purchaseErr.code === "PGRST204" ||
          /return_no/i.test(purchaseErr.message ?? ""))
      ) {
        ;({ data: purchases, error: purchaseErr } = await supabase
          .from("purchase_returns")
          .select(purchaseColumns(false))
          .eq("organization_id", currentShopId)
          .order("return_date", { ascending: false }))
      }

      if (purchaseErr) {
        toast({
          title: "Failed to load purchase returns",
          description: purchaseErr.message,
          variant: "destructive",
        })
      }

      // ---- Brand, category and variant
      //
      // Neither return-items table carries them, so they are looked up
      // by barcode — and they have to be, because the shop wants to
      // filter returns by exactly those three.
      //
      // Only the barcodes actually on a return are fetched. Pulling
      // the whole of inventory to answer a question about twelve
      // handsets would be slower and would still miss anything sold
      // out of stock since.
      const codes = new Set<string>()
      for (const r of (sales ?? []) as any[]) {
        for (const it of r.sales_return_items ?? []) if (it.barcode) codes.add(it.barcode)
        if (r.exchange_barcode) codes.add(r.exchange_barcode)
      }
      for (const r of (purchases ?? []) as any[]) {
        for (const it of r.purchase_return_items ?? []) if (it.barcode) codes.add(it.barcode)
      }

      const details = await loadDetails(currentShopId, Array.from(codes))

      // What the return row says, topped up with what only the product
      // record knows. The return's own wording wins where it has any:
      // it is what was written down at the time.
      const fill = (barcode: string, base: Details): Details => {
        const known = details.get(barcode) ?? {}
        return {
          productName: base.productName || known.productName || "",
          modelNumber: base.modelNumber || known.modelNumber || "",
          brand: known.brand || "",
          category: known.category || "",
          variant: known.variant || "",
          color: base.color || known.color || "",
        }
      }

      const mappedSales: ReturnRecord[] = ((sales ?? []) as any[]).map((r) => {
        const rawItems = (r.sales_return_items ?? []) as any[]
        const items: ReturnItem[] = rawItems.map((it) => {
          const d = fill(it.barcode ?? "", {
            productName: it.product_name,
            modelNumber: it.model_number,
            color: it.color,
          })
          return {
            id: String(it.id),
            barcode: it.barcode ?? "",
            productName: d.productName ?? "",
            modelNumber: d.modelNumber ?? "",
            brand: d.brand ?? "",
            category: d.category ?? "",
            variant: d.variant ?? "",
            color: d.color ?? "",
            quantity: Number(it.quantity ?? 0),
            unitPrice: Number(it.unit_price ?? 0),
            amount: Number(it.total_refund_amount ?? 0),
            condition: it.condition ?? "",
          }
        })

        const isExchange = (r.return_kind ?? "refund") === "exchange"

        // The handset given out in its place. This is the question the
        // shop actually asks of an exchange months later — which unit
        // went out against which one that came back — and the screen
        // could not answer it at all.
        let replacement: ReturnItem | null = null
        if (isExchange && r.exchange_barcode) {
          const d = details.get(r.exchange_barcode) ?? {}
          replacement = {
            id: `rep-${r.id}`,
            barcode: r.exchange_barcode,
            productName: d.productName ?? "",
            modelNumber: d.modelNumber ?? "",
            brand: d.brand ?? "",
            category: d.category ?? "",
            variant: d.variant ?? "",
            color: d.color ?? "",
            quantity: 1,
            unitPrice: Number(r.price_difference ?? 0),
            amount: Number(r.price_difference ?? 0),
            condition: "",
          }
        }

        return {
          id: String(r.id),
          type: "sales" as const,
          date: r.return_date ?? "",
          refNo: r.original_sale_id != null ? `SALE-${r.original_sale_id}` : "SALE-—",
          counterparty: r.customer_name || r.customer_phone || "—",
          phone: r.customer_phone ?? "",
          reason: r.return_reason ?? "—",
          status: r.status ?? "pending",
          kind: isExchange ? ("exchange" as const) : ("refund" as const),
          // An exchange refunds nothing. The figure that matters is
          // what the customer paid on top.
          amount: isExchange
            ? Number(r.price_difference ?? 0)
            : Number(r.total_refund_amount ?? 0),
          quantity: items.reduce((s, it) => s + it.quantity, 0),
          notes: r.notes ?? "",
          method: r.refund_method ?? "",
          items,
          replacement,
        }
      })

      const mappedPurchases: ReturnRecord[] = ((purchases ?? []) as any[]).map((r) => {
        const rawItems = (r.purchase_return_items ?? []) as any[]
        const items: ReturnItem[] = rawItems.map((it) => {
          const d = fill(it.barcode ?? "", {
            productName: it.product_name,
            modelNumber: it.model_number,
            color: it.color,
          })
          return {
            id: String(it.id),
            barcode: it.barcode ?? "",
            productName: d.productName ?? "",
            modelNumber: d.modelNumber ?? "",
            brand: d.brand ?? "",
            category: d.category ?? "",
            variant: d.variant ?? "",
            color: d.color ?? "",
            quantity: Number(it.return_quantity ?? 0),
            unitPrice: Number(it.unit_cost ?? 0),
            amount: Number(it.total_credit_amount ?? 0),
            condition: it.condition ?? "",
          }
        })

        return {
          id: String(r.id),
          type: "purchase" as const,
          date: r.return_date ?? "",
          // The return's own number where it has one. A return can now
          // carry several products from several purchases, so naming it
          // after one of them stopped meaning anything.
          refNo:
            r.return_no ??
            (r.original_purchase_id != null ? `PUR-${r.original_purchase_id}` : "PUR-—"),
          counterparty: r.supplier ?? "—",
          phone: "",
          reason: r.return_reason ?? "—",
          status: r.status ?? "pending",
          amount: Number(r.total_credit_amount ?? 0),
          quantity: items.reduce((s, it) => s + it.quantity, 0),
          notes: r.notes ?? "",
          method: r.credit_method ?? "",
          items,
          replacement: null,
        }
      })

      setReturns([...mappedSales, ...mappedPurchases])
    } finally {
      setIsLoading(false)
    }
  }, [currentShopId, toast])

  useEffect(() => {
    load()
  }, [load])

  // ------------------------------------------------------------------
  // Filtering
  // ------------------------------------------------------------------

  const ofType = useMemo(
    () => returns.filter((r) => r.type === tab),
    [returns, tab],
  )

  const optionsFrom = (pick: (it: ReturnItem) => string) => {
    const set = new Set<string>()
    for (const r of ofType) for (const it of r.items) {
      const v = (pick(it) ?? "").trim()
      if (v) set.add(v)
    }
    return ["All", ...Array.from(set).sort()]
  }

  const partyOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of ofType) if (r.counterparty && r.counterparty !== "—") set.add(r.counterparty)
    return ["All", ...Array.from(set).sort()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ofType])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const categoryOptions = useMemo(() => optionsFrom((it) => it.category), [ofType])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const brandOptions = useMemo(() => optionsFrom((it) => it.brand), [ofType])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const modelOptions = useMemo(() => optionsFrom((it) => it.modelNumber), [ofType])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const variantOptions = useMemo(() => optionsFrom((it) => it.variant), [ofType])

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()

    const itemMatches = (r: ReturnRecord, pick: (it: ReturnItem) => string, want: string) =>
      want === "All" || r.items.some((it) => (pick(it) ?? "").trim() === want)

    return ofType.filter((r) => {
      // return_date is a plain date, so string comparison is both
      // correct and free of timezone drift.
      const d = (r.date ?? "").slice(0, 10)
      if (startDate && d < startDate) return false
      if (endDate && d > endDate) return false

      if (selectedParty !== "All" && r.counterparty !== selectedParty) return false
      if (!itemMatches(r, (it) => it.category, selectedCategory)) return false
      if (!itemMatches(r, (it) => it.brand, selectedBrand)) return false
      if (!itemMatches(r, (it) => it.modelNumber, selectedModel)) return false
      if (!itemMatches(r, (it) => it.variant, selectedVariant)) return false

      if (!term) return true

      // Everything on the return, including the barcode of every unit
      // and of the handset swapped in — that is what someone has in
      // their hand when they come asking.
      const haystack = [
        r.refNo,
        r.counterparty,
        r.phone,
        r.reason,
        r.notes,
        r.replacement?.barcode ?? "",
        r.replacement?.productName ?? "",
        ...r.items.flatMap((it) => [
          it.barcode,
          it.productName,
          it.modelNumber,
          it.brand,
          it.category,
          it.variant,
          it.color,
        ]),
      ]
        .join(" ")
        .toLowerCase()

      return haystack.includes(term)
    })
  }, [
    ofType,
    searchTerm,
    startDate,
    endDate,
    selectedParty,
    selectedCategory,
    selectedBrand,
    selectedModel,
    selectedVariant,
  ])

  const resetFilters = () => {
    setSearchTerm("")
    setStartDate("")
    setEndDate("")
    setSelectedParty("All")
    setSelectedCategory("All")
    setSelectedBrand("All")
    setSelectedModel("All")
    setSelectedVariant("All")
  }

  // Everything resets when the tab changes: a brand that exists on
  // purchase returns may not exist on sales returns, and a filter left
  // behind would silently show an empty list.
  useEffect(() => {
    resetFilters()
  }, [tab])

  // ------------------------------------------------------------------
  // Printing
  // ------------------------------------------------------------------

  const period = () => {
    if (startDate && endDate) return `${day(startDate)} to ${day(endDate)}`
    if (startDate) return `From ${day(startDate)}`
    if (endDate) return `Up to ${day(endDate)}`
    return "All dates"
  }

  const openWindow = () => {
    const win = window.open("", "_blank", "width=1000,height=700")
    if (!win) {
      toast({
        title: "Print window did not open",
        description: "Allow pop-ups for this application, then try again.",
        variant: "destructive",
      })
      return null
    }
    return win
  }

  const REPORT_CSS = `
    body { font-family: Arial, sans-serif; margin: 15px; font-size: 12px; }
    .header { text-align: center; margin-bottom: 16px; }
    .company-name { font-size: 18px; font-weight: bold; }
    .title { font-size: 16px; font-weight: bold; margin: 8px 0 4px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; border: 2px solid #000; }
    th, td { border: 1px solid #000; padding: 5px; font-size: 11px; vertical-align: top; }
    th { background: #f0f0f0; text-align: center; }
    .num { text-align: right; font-family: monospace; }
    .serial { font-family: monospace; font-size: 10px; }
    .group-head td { background: #e8e8e8; font-weight: bold; }
    tr.total td { background: #f6f6f6; font-weight: bold; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 10px 0; }
    .meta span { color: #555; }
    .section-title { font-weight: bold; margin-top: 14px; }
    .totals { width: 340px; margin-left: auto; border: none; }
    .totals td { border: none; padding: 3px 6px; font-size: 12px; }
    .totals td.num { font-weight: bold; }
    .totals tr.grand td { border-top: 2px solid #000; font-size: 13px; font-weight: bold; }
    @media print { body { margin: 10px; } }
  `

  /** The filtered list, as a report. */
  const printList = () => {
    const win = openWindow()
    if (!win) return

    const info = shopHeader(shop)
    const isSales = tab === "sales"
    const title = isSales ? "Sales Return Report" : "Purchase Return Report"

    const totalQty = filtered.reduce((s, r) => s + r.quantity, 0)
    const totalAmount = filtered.reduce((s, r) => s + r.amount, 0)

    const rows = filtered
      .map(
        (r) => `
        <tr>
          <td>${esc(r.refNo)}</td>
          <td>${day(r.date)}</td>
          <td>${esc(r.counterparty)}</td>
          <td>${r.items
            .map(
              (it) =>
                `${esc(it.productName)}${it.modelNumber ? ` — ${esc(it.modelNumber)}` : ""}${
                  it.barcode ? `<br><span class="serial">${esc(it.barcode)}</span>` : ""
                }`,
            )
            .join("<br>")}</td>
          ${
            isSales
              ? `<td>${
                  r.replacement
                    ? `${esc(r.replacement.productName)}<br><span class="serial">${esc(
                        r.replacement.barcode,
                      )}</span>`
                    : "—"
                }</td>`
              : ""
          }
          <td class="num">${r.quantity}</td>
          <td class="num">${money(r.amount)}</td>
          <td>${esc(r.reason)}</td>
        </tr>`,
      )
      .join("")

    const cols = isSales ? 8 : 7

    win.document.write(`<!DOCTYPE html><html><head>
      <title>${title}</title>
      <style>${REPORT_CSS}${DOCUMENT_TOOLBAR_CSS}</style>
      </head><body>
      ${documentToolbar(title)}
      <div class="header">
        <div class="company-name">${info.name}</div>
        <div>${info.addressLine}</div>
        <div class="title">${title}</div>
        <div>Period: ${period()}</div>
      </div>

      <table>
        <thead><tr>
          <th>Return No</th><th>Date</th>
          <th>${isSales ? "Customer" : "Supplier"}</th>
          <th>Items returned</th>
          ${isSales ? "<th>Exchanged for</th>" : ""}
          <th>Qty</th>
          <th>${isSales ? "Amount" : "Credit"}</th>
          <th>Reason</th>
        </tr></thead>
        <tbody>
          ${rows || `<tr><td colspan="${cols}">No returns.</td></tr>`}
          <tr class="total">
            <td colspan="${cols - 3}">TOTAL (${filtered.length} return${
              filtered.length === 1 ? "" : "s"
            })</td>
            <td class="num">${totalQty}</td>
            <td class="num">${money(totalAmount)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:20px;text-align:center;font-size:11px;color:#666;">
        Generated on ${new Date().toLocaleString("en-GB")}
      </div>
      </body></html>`)
    win.document.close()
  }

  /** One return, in full. */
  const printOne = (r: ReturnRecord) => {
    const win = openWindow()
    if (!win) return

    const info = shopHeader(shop)
    const isSales = r.type === "sales"
    const title = `${isSales ? "Sales Return" : "Purchase Return"} ${r.refNo}`

    const itemRows = r.items
      .map(
        (it, i) => `
        <tr>
          <td>${i + 1}</td>
          <td class="serial">${esc(it.barcode) || "—"}</td>
          <td>${esc(it.productName) || "—"}</td>
          <td>${esc(it.brand) || "—"}</td>
          <td>${esc(it.modelNumber) || "—"}</td>
          <td>${esc(it.category) || "—"}</td>
          <td>${esc(it.variant) || "—"}</td>
          <td>${esc(it.color) || "—"}</td>
          <td class="num">${it.quantity}</td>
          <td class="num">${money(it.unitPrice)}</td>
          <td class="num">${money(it.amount)}</td>
        </tr>`,
      )
      .join("")

    // The whole point of an exchange record: which unit went out
    // against which one that came back.
    const exchangeBlock = r.replacement
      ? `
      <div class="section-title">Exchanged for</div>
      <table>
        <thead><tr>
          <th>IME No</th><th>Product</th><th>Brand</th><th>Model</th>
          <th>Category</th><th>Variant</th><th>Colour</th>
        </tr></thead>
        <tbody><tr>
          <td class="serial">${esc(r.replacement.barcode) || "—"}</td>
          <td>${esc(r.replacement.productName) || "—"}</td>
          <td>${esc(r.replacement.brand) || "—"}</td>
          <td>${esc(r.replacement.modelNumber) || "—"}</td>
          <td>${esc(r.replacement.category) || "—"}</td>
          <td>${esc(r.replacement.variant) || "—"}</td>
          <td>${esc(r.replacement.color) || "—"}</td>
        </tr></tbody>
      </table>`
      : ""

    win.document.write(`<!DOCTYPE html><html><head>
      <title>${title}</title>
      <style>${REPORT_CSS}${DOCUMENT_TOOLBAR_CSS}</style>
      </head><body>
      ${documentToolbar(r.refNo)}
      <div class="header">
        <div class="company-name">${info.name}</div>
        <div>${info.addressLine}</div>
        <div class="title">${isSales ? "Sales Return" : "Purchase Return"}</div>
      </div>

      <div class="meta">
        <div><span>Return No:</span> <b>${esc(r.refNo)}</b></div>
        <div><span>Date:</span> ${day(r.date)}</div>
        <div><span>${isSales ? "Customer" : "Supplier"}:</span> <b>${esc(r.counterparty)}</b></div>
        ${r.phone ? `<div><span>Phone:</span> ${esc(r.phone)}</div>` : ""}
        <div><span>Reason:</span> ${esc(r.reason)}</div>
        ${r.method ? `<div><span>${isSales ? "Refund" : "Credit"} method:</span> ${esc(r.method)}</div>` : ""}
        ${r.kind === "exchange" ? `<div><span>Kind:</span> <b>Exchange</b></div>` : ""}
      </div>

      <div class="section-title">Items returned</div>
      <table>
        <thead><tr>
          <th>#</th><th>IME No</th><th>Product</th><th>Brand</th><th>Model</th>
          <th>Category</th><th>Variant</th><th>Colour</th>
          <th>Qty</th><th>Unit</th><th>Amount</th>
        </tr></thead>
        <tbody>
          ${itemRows || `<tr><td colspan="11">No items recorded.</td></tr>`}
          <tr class="total">
            <td colspan="8">Total</td>
            <td class="num">${r.quantity}</td>
            <td></td>
            <td class="num">${money(r.items.reduce((s, it) => s + it.amount, 0))}</td>
          </tr>
        </tbody>
      </table>

      ${exchangeBlock}

      <table class="totals">
        <tr class="grand">
          <td>${
            r.kind === "exchange"
              ? "Customer paid"
              : isSales
                ? "Refunded"
                : "Credit"
          }</td>
          <td class="num">${money(r.amount)}</td>
        </tr>
      </table>

      ${r.notes ? `<div class="section-title">Notes</div><div>${esc(r.notes)}</div>` : ""}

      <div style="margin-top:24px;text-align:center;font-size:11px;color:#666;">
        Generated on ${new Date().toLocaleString("en-GB")}
      </div>
      </body></html>`)
    win.document.close()
  }

  // ------------------------------------------------------------------

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase()
    if (s === "completed" || s === "processed")
      return <Badge className="bg-green-100 text-green-800">Completed</Badge>
    if (s === "processing")
      return <Badge className="bg-yellow-100 text-yellow-800">Processing</Badge>
    if (s === "pending") return <Badge className="bg-red-100 text-red-800">Pending</Badge>
    if (s === "cancelled") return <Badge variant="secondary">Cancelled</Badge>
    return <Badge variant="secondary">{status}</Badge>
  }

  const filterRow = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label htmlFor="returns-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              id="returns-search"
              placeholder="Barcode / IMEI, product, model, brand, name…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* It labels its own two boxes, so it gets none from here. */}
        <div className="xl:col-span-2">
          <DateRangeFilter
            idPrefix="returns"
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            showSummary={false}
          />
        </div>

        <div>
          <Label htmlFor="returns-party">{tab === "sales" ? "Customer" : "Supplier"}</Label>
          <Select value={selectedParty} onValueChange={setSelectedParty}>
            <SelectTrigger id="returns-party">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {partyOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div>
          <Label htmlFor="returns-category">Category</Label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger id="returns-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="returns-brand">Brand</Label>
          <Select value={selectedBrand} onValueChange={setSelectedBrand}>
            <SelectTrigger id="returns-brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {brandOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="returns-model">Model</Label>
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger id="returns-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="returns-variant">Variant</Label>
          <Select value={selectedVariant} onValueChange={setSelectedVariant}>
            <SelectTrigger id="returns-variant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {variantOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" onClick={resetFilters} className="flex-1">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button onClick={printList} disabled={filtered.length === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>
    </div>
  )

  const recordsTable = (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Return No</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>{tab === "sales" ? "Customer" : "Supplier"}</TableHead>
            <TableHead>Items</TableHead>
            {tab === "sales" && <TableHead>Exchanged for</TableHead>}
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">
              {tab === "sales" ? "Amount" : "Credit"}
            </TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[70px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                Loading returns…
              </TableCell>
            </TableRow>
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                No returns found matching your criteria
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => (
              <TableRow key={`${r.type}-${r.id}`}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {r.refNo}
                    {r.kind === "exchange" && (
                      <Badge variant="secondary" className="text-[10px]">
                        Exchange
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{r.date?.slice(0, 10) || "—"}</TableCell>
                <TableCell>{r.counterparty}</TableCell>
                <TableCell>
                  {r.items.length === 0 ? (
                    "—"
                  ) : (
                    <div className="space-y-0.5">
                      {r.items.slice(0, 2).map((it) => (
                        <div key={it.id} className="leading-tight">
                          {it.productName || "—"}
                          {it.barcode && (
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {it.barcode}
                            </div>
                          )}
                        </div>
                      ))}
                      {r.items.length > 2 && (
                        <div className="text-xs text-muted-foreground">
                          +{r.items.length - 2} more
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>
                {tab === "sales" && (
                  <TableCell>
                    {r.replacement ? (
                      <div className="leading-tight">
                        {r.replacement.productName || "—"}
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {r.replacement.barcode}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.kind === "exchange" ? (
                    Number(r.amount || 0) > 0 ? (
                      <span className="text-green-600">+{money(r.amount)}</span>
                    ) : (
                      <span className="text-muted-foreground">Even swap</span>
                    )
                  ) : (
                    money(r.amount)
                  )}
                </TableCell>
                <TableCell>{r.reason}</TableCell>
                <TableCell>{getStatusBadge(r.status)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="See everything on this return"
                    onClick={() => setOpenRecord(r)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Returns Management</h1>
          <ManagerAccessBadge mode="limited" />
        </div>
        <div className="flex gap-2">
          {/* Sales returns are the common case, so this one carries the
              fill. */}
          <Button onClick={() => setShowSalesReturn(true)} className="shadow-sm">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Sales Return
          </Button>
          <Button variant="outline" onClick={() => setShowPurchaseReturn(true)}>
            <Package className="mr-2 h-4 w-4" />
            Purchase Return
          </Button>
        </div>
      </div>

      {/* The two are different documents answering different questions
          — one is about a customer, the other about a supplier — and
          mixing them in one list meant every filter had to apply to
          both. Separated, each gets the columns it actually needs. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="sales">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Sales Returns
          </TabsTrigger>
          <TabsTrigger value="purchase">
            <Package className="mr-2 h-4 w-4" />
            Purchase Returns
          </TabsTrigger>
        </TabsList>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Filter className="mr-2 h-5 w-5" />
              Filters &amp; Search
            </CardTitle>
          </CardHeader>
          <CardContent>{filterRow}</CardContent>
        </Card>

        <TabsContent value="sales" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sales Returns</CardTitle>
            </CardHeader>
            <CardContent>{recordsTable}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchase" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Purchase Returns</CardTitle>
            </CardHeader>
            <CardContent>{recordsTable}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <StatStrip
        stats={[
          { label: "Sales returns", value: returns.filter((r) => r.type === "sales").length },
          { label: "Purchase returns", value: returns.filter((r) => r.type === "purchase").length },
          { label: "Showing", value: filtered.length },
          {
            label: tab === "sales" ? "Refunds & swaps" : "Credits",
            value: money(filtered.reduce((s, r) => s + r.amount, 0)),
            tone: "money",
          },
        ]}
      />

      {/* ---- One return, in full ---- */}
      <Dialog open={!!openRecord} onOpenChange={(o) => !o && setOpenRecord(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[980px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {openRecord?.refNo}
              {openRecord?.kind === "exchange" && (
                <Badge variant="secondary" className="text-[10px]">
                  Exchange
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {openRecord?.counterparty} • {day(openRecord?.date)} •{" "}
              {openRecord?.reason}
            </DialogDescription>
          </DialogHeader>

          {openRecord && (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">#</TableHead>
                      <TableHead>IME No</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead>Colour</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openRecord.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-6 text-center text-muted-foreground">
                          No items recorded against this return.
                        </TableCell>
                      </TableRow>
                    ) : (
                      openRecord.items.map((it, i) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {it.barcode || "—"}
                          </TableCell>
                          <TableCell>{it.productName || "—"}</TableCell>
                          <TableCell>{it.brand || "—"}</TableCell>
                          <TableCell>{it.modelNumber || "—"}</TableCell>
                          <TableCell>{it.category || "—"}</TableCell>
                          <TableCell>{it.variant || "—"}</TableCell>
                          <TableCell>{it.color || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(it.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(it.amount)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Which unit went out against the one that came back.
                  This is the question an exchange gets asked months
                  later, and the screen could not answer it at all. */}
              {openRecord.replacement && (
                <div className="overflow-x-auto rounded-md border">
                  <div className="border-b px-3 py-2 text-sm font-medium">
                    Exchanged for
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>IME No</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead>Colour</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">
                          {openRecord.replacement.barcode || "—"}
                        </TableCell>
                        <TableCell>{openRecord.replacement.productName || "—"}</TableCell>
                        <TableCell>{openRecord.replacement.brand || "—"}</TableCell>
                        <TableCell>{openRecord.replacement.modelNumber || "—"}</TableCell>
                        <TableCell>{openRecord.replacement.category || "—"}</TableCell>
                        <TableCell>{openRecord.replacement.variant || "—"}</TableCell>
                        <TableCell>{openRecord.replacement.color || "—"}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
                <Line label="Return no" value={openRecord.refNo} />
                <Line label="Date" value={day(openRecord.date)} />
                <Line
                  label={openRecord.type === "sales" ? "Customer" : "Supplier"}
                  value={openRecord.counterparty}
                />
                {openRecord.phone && <Line label="Phone" value={openRecord.phone} />}
                <Line label="Reason" value={openRecord.reason} />
                {openRecord.method && (
                  <Line
                    label={openRecord.type === "sales" ? "Refund method" : "Credit method"}
                    value={openRecord.method}
                  />
                )}
                <Line label="Total quantity" value={String(openRecord.quantity)} />
                <Line
                  label={
                    openRecord.kind === "exchange"
                      ? "Customer paid"
                      : openRecord.type === "sales"
                        ? "Refunded"
                        : "Credit"
                  }
                  value={money(openRecord.amount)}
                  strong
                />
                {openRecord.notes && (
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Notes: </span>
                    {openRecord.notes}
                  </div>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => openRecord && printOne(openRecord)}
              disabled={!openRecord}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print this return
            </Button>
            <Button onClick={() => setOpenRecord(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sales Return Dialog */}
      <Dialog
        open={showSalesReturn}
        onOpenChange={(o) => {
          setShowSalesReturn(o)
          if (!o) load()
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Process Sales Return</DialogTitle>
          </DialogHeader>
          <SalesReturnForm onClose={() => setShowSalesReturn(false)} />
        </DialogContent>
      </Dialog>

      {/* Purchase Return Dialog */}
      <Dialog
        open={showPurchaseReturn}
        onOpenChange={(o) => {
          setShowPurchaseReturn(o)
          if (!o) load()
        }}
      >
        {/* Wider than the sales one: a return can now carry a full
            product-entry row for whatever the supplier sent back. */}
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Process Purchase Return</DialogTitle>
          </DialogHeader>
          <PurchaseReturnForm onClose={() => setShowPurchaseReturn(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Line({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  )
}

/**
 * Brand, category and variant for a set of barcodes.
 *
 * inventory first, because it carries all six fields for anything the
 * shop currently stocks. sold_products fills in whatever inventory no
 * longer has — a handset sold and since removed still has to show its
 * brand on a return from six months ago.
 *
 * Chunked, because a shop with a few hundred returns would otherwise
 * build a URL long enough for PostgREST to reject outright.
 */
async function loadDetails(
  organizationId: string,
  codes: string[],
): Promise<Map<string, Details>> {
  const out = new Map<string, Details>()
  if (codes.length === 0) return out

  const CHUNK = 150

  for (let i = 0; i < codes.length; i += CHUNK) {
    const slice = codes.slice(i, i + CHUNK)

    const [{ data: inv }, { data: sold }] = await Promise.all([
      supabase
        .from("inventory")
        .select("barcode, product_name, model_number, brand, category, variant, color")
        .eq("organization_id", organizationId)
        .in("barcode", slice),
      supabase
        .from("sold_products")
        .select("barcode, product_name, model_number, brand, category, variant, color")
        .eq("organization_id", organizationId)
        .in("barcode", slice),
    ])

    for (const row of (sold ?? []) as any[]) {
      if (!row.barcode) continue
      out.set(row.barcode, {
        productName: row.product_name ?? "",
        modelNumber: row.model_number ?? "",
        brand: row.brand ?? "",
        category: row.category ?? "",
        variant: row.variant ?? "",
        color: row.color ?? "",
      })
    }

    // Overwrites the sold_products entry where inventory has one: it is
    // the fuller record, and for the replacement handset on an exchange
    // it is the only one.
    for (const row of (inv ?? []) as any[]) {
      if (!row.barcode) continue
      const prev = out.get(row.barcode) ?? {}
      out.set(row.barcode, {
        productName: row.product_name || prev.productName || "",
        modelNumber: row.model_number || prev.modelNumber || "",
        brand: row.brand || prev.brand || "",
        category: row.category || prev.category || "",
        variant: row.variant || prev.variant || "",
        color: row.color || prev.color || "",
      })
    }
  }

  return out
}
