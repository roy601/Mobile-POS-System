"use client"

import { useEffect, useMemo, useState, Fragment } from "react"
import { CalendarDays, DollarSign, ShoppingCart, TrendingUp, Calendar, RefreshCw, Download, ChevronDown, ChevronRight, Printer, Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  codeMatches,
  Highlight,
  HIT_ROW_CLASS,
  HIT_UNIT_CLASS,
  searchKeyOf,
} from "@/components/search-hit"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRangeFilter } from "@/components/date-range-filter"
import {
  printDetailsReport,
  printImeiReport,
  printSalesReport,
  type ReportReturn,
} from "@/lib/sales-reports"
import { createClient } from "@/utils/supabase/component"
import { useToast } from "@/hooks/use-toast"
import { MainNav } from "@/components/main-nav"
import { useRole } from "@/components/role-provider"
import { useLinkedShops } from "@/hooks/use-linked-shops"
import { shopHeader } from "@/lib/utils/shop-header"
import { openPrintableReceipt } from "@/lib/receipt"
import { linePromo, promoAsSaleValue } from "@/lib/promo"
import { StatStrip } from "@/components/stat-strip"
import { SaleEditDialog } from "@/components/sale-edit-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// FIXED: Better type definitions matching actual Supabase response
type CustomerJoined = {
  id: number
  name: string | null
  phone_number: string | null
  email: string | null
}

type SaleCustomerJoined = {
  customer_id?: number | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customers: CustomerJoined[] | null
}

// NEW: Product detail type
type SoldProduct = {
  id: number
  barcode: string | null
  product_name: string
  model_number: string | null
  color: string | null
  quantity: number
  unit_price: number
  discount_percentage: number | null
  discount_amount: number | null
  total_price: number
  cost_price: number | null
  /** Per unit, funded by the supplier. Already counted back into
      total_price and out of discount_amount when the sale is parsed. */
  promo_amount?: number | null
  brand: string | null
  category: string | null
  variant: string | null
  supplier: string | null
}

type SaleRow = {
  id: string | number
  invoice_number: string | null
  transfer_to_org_id: string | null
  created_at: string
  sale_date: string | null
  total_amount: number | null
  total_discount: number | null
  payment_method: string | null
  status: string | null
  // What was actually taken, split by route, plus what was left owing.
  // The Details report states each separately, the way the shop's old
  // software did, so a row can be read against a bank statement.
  cash_received: number | null
  card_received: number | null
  bkash_received: number | null
  nagad_received: number | null
  rocket_received: number | null
  upay_received: number | null
  bank_transfer_received: number | null
  due_amount: number | null
  sale_customers: SaleCustomerJoined[] | null
  sold_products: SoldProduct[] | null
  // The truthful record of how the money arrived: one row per route,
  // so a split shows BRAC-Card and bKash separately rather than as one
  // "bank" figure. Absent on sales taken before script 49.
  sale_payments: SalePaymentRow[] | null
}

type SalePaymentRow = {
  id: number
  method: string
  bank_name: string | null
  channel: string | null
  amount: number | null
}

type UiSale = {
  id: string
  invoiceNumber: string | null
  /** Set when this was stock sent to another shop, not a customer sale. */
  transferToOrgId: string | null
  dateISO: string
  timeLabel: string
  customer: string | null
  customerPhone: string | null
  itemsCount: number
  total: number
  totalDiscount: number
  /** Taken in notes. */
  cashPaid: number
  /** Taken through any bank, card or mobile-money route. */
  bankPaid: number
  /** Left owing on this sale. */
  dues: number
  payment: string | null
  status: string | null
  products: SoldProduct[]
  /** Where each part of the money actually came from. */
  paymentLines: PaymentLineView[]
}

/**
 * One route the money came in by.
 *
 * `fromLines` says whether this is the real per-line record or a
 * reconstruction from the old per-method columns. Sales taken before
 * script 49 have no sale_payments rows at all, and the shop still
 * needs to see how those were paid — so they are rebuilt from
 * cash_received, bkash_received and the rest, which is every fact
 * those rows kept.
 */
type PaymentLineView = {
  id: string
  label: string
  bank: string | null
  amount: number
  fromLines: boolean
}

/** How a stored payment line reads on screen. */
function routeLabel(method: string, channel: string | null): string {
  const c = (channel ?? "").trim()
  if (c) return c
  if (method === "cash") return "Cash"
  if (method === "bank_transfer") return "Bank transfer"
  if (method === "mobile_banking") return "Mobile banking"
  return method || "Other"
}

const supabase = createClient()

function bdAmount(n: number) {
  return `৳${n.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// FIXED: Better parsing with product details and total_discount
function parseSupabaseRows(rows: SaleRow[]): UiSale[] {
  return rows.map((r) => {
    // The day the sale was MADE, which for a backdated sale is not the
    // day the row was written. Falls back to created_at so a row from
    // before dating existed still reads correctly.
    let created: Date
    try {
      created = new Date(r.sale_date ?? r.created_at ?? Date.now())
    } catch {
      created = new Date()
    }
    
    const dateISO = created.toISOString().slice(0, 10)
    const timeLabel = created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

    const sc = Array.isArray(r.sale_customers) && r.sale_customers.length > 0 ? r.sale_customers[0] : null
    let customerName: string | null = null
    
    if (sc) {
      customerName = sc.customer_name || sc.customer_phone
      
      if (!customerName && Array.isArray(sc.customers) && sc.customers.length > 0) {
        const customer = sc.customers[0]
        customerName = customer.name || customer.phone_number
      }
    }

    // A supplier promo is not the shop's discount: it is counted back
    // into the sale's value and out of its discount, here, once, so
    // every total, profit, filter, export and printed report below
    // agrees. What the customer paid is untouched — see promoAsSaleValue.
    const rawProducts = Array.isArray(r.sold_products) ? r.sold_products : []
    const promo = rawProducts.reduce((sum: number, p: any) => sum + linePromo(p), 0)
    const products = rawProducts.map((p: any) => promoAsSaleValue(p))
    const itemsCount = products.length
    const total = Number(r.total_amount ?? 0) + promo
    const totalDiscount = Math.max(0, Number(r.total_discount ?? 0) - promo)

    const cashPaid = Number(r.cash_received ?? 0)
    // Everything that did not come out of the drawer. Card, bKash,
    // Nagad, Rocket, Upay and a plain transfer all reconcile against a
    // statement rather than against the till, so the report states them
    // as one figure.
    const bankPaid =
      Number(r.card_received ?? 0) +
      Number(r.bkash_received ?? 0) +
      Number(r.nagad_received ?? 0) +
      Number(r.rocket_received ?? 0) +
      Number(r.upay_received ?? 0) +
      Number(r.bank_transfer_received ?? 0)

    // The real record where it exists. Ordered biggest first: on a
    // split the shop is looking for which route took the bulk of it.
    const stored = (Array.isArray(r.sale_payments) ? r.sale_payments : [])
      .filter((p: any) => Number(p.amount) > 0)
      .map((p: any) => ({
        id: `line-${p.id}`,
        label: routeLabel(String(p.method ?? ""), p.channel ?? null),
        bank: p.bank_name ?? null,
        amount: Number(p.amount) || 0,
        fromLines: true,
      }))
      .sort((a: PaymentLineView, b: PaymentLineView) => b.amount - a.amount)

    // Nothing stored: rebuild from the columns that were always there,
    // so a sale from before the payment lines existed still shows how
    // it was paid rather than showing nothing.
    const legacy: PaymentLineView[] = stored.length
      ? []
      : (
          [
            ["Cash", r.cash_received],
            ["Card", r.card_received],
            ["bKash", r.bkash_received],
            ["Nagad", r.nagad_received],
            ["Rocket", r.rocket_received],
            ["Upay", r.upay_received],
            ["Bank transfer", r.bank_transfer_received],
          ] as const
        )
          .map(([label, value]) => ({
            id: `legacy-${label}`,
            label,
            bank: null,
            amount: Number(value ?? 0),
            fromLines: false,
          }))
          .filter((line) => line.amount > 0)

    return {
      id: String(r.id),
      invoiceNumber: r.invoice_number ?? null,
      transferToOrgId: r.transfer_to_org_id ?? null,
      dateISO,
      timeLabel,
      customer: customerName,
      customerPhone: sc?.customer_phone ?? null,
      itemsCount,
      total,
      totalDiscount,
      cashPaid,
      bankPaid,
      dues: Number(r.due_amount ?? 0),
      payment: r.payment_method,
      status: r.status,
      products,
      paymentLines: stored.length ? stored : legacy,
    }
  })
}

export default function SalesPageClient() {
  const { toast } = useToast()
  const { currentShopId, shops, accountType } = useRole()
  // Correcting history is the owner's call, and the database says so
  // too — edit_sale and delete_sale refuse a manager.
  const isOwner = accountType === "owner"
  const { linked, nameOf } = useLinkedShops()
  // Reports print the shop's own letterhead, not a hard-coded one.
  const header = shopHeader(shops.find((s) => s.id === currentShopId))

  // filters
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [query, setQuery] = useState("")
  // "customers" hides shop transfers, which is the honest default for
  // revenue and profit: a transfer is stock moved at cost between the
  // owner's own shops, not a sale to the public.
  const [transferFilter, setTransferFilter] = useState<string>("customers")
  const [customerFilter, setCustomerFilter] = useState<string>("all")
  const [productFilter, setProductFilter] = useState<string>("all")
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [variantFilter, setVariantFilter] = useState<string>("all")
  const [brandFilter, setBrandFilter] = useState<string>("all")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")

  // ---- Correcting history, owner only
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    invoice: string | null
    total: number
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // data
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uiSales, setUiSales] = useState<UiSale[]>([])
  
  // expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Which sale's invoice is being built, so its button can say so.
  const [printingId, setPrintingId] = useState<string | null>(null)

  // FIXED: Better data loading with product details and total_discount
  async function loadSales() {
    setLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase
        .from("sales")
        .select(`
          id,
          invoice_number,
          transfer_to_org_id,
          created_at,
          sale_date,
          total_amount,
          total_discount,
          payment_method,
          status,
          cash_received,
          card_received,
          bkash_received,
          nagad_received,
          rocket_received,
          upay_received,
          bank_transfer_received,
          due_amount,
          sale_customers (
            customer_id,
            customer_name,
            customer_phone,
            customer_email,
            customers (
              id, name, phone_number, email
            )
          ),
          sale_payments (
            id,
            method,
            bank_name,
            channel,
            amount
          ),
          sold_products (
            id,
            barcode,
            product_name,
            model_number,
            color,
            quantity,
            unit_price,
            discount_percentage,
            discount_amount,
            total_price,
            cost_price,
            brand,
            category,
            variant,
            supplier,
            promo_amount
          )
        `)
        .eq("organization_id", currentShopId)
        // Ordered by the day each sale was made, so a backdated sale
        // sits where it belongs in the history rather than jumping to
        // the top because it was entered this morning.
        .order("sale_date", { ascending: false })

      if (error) {
        // Spelled out: a PostgrestError's fields are not own-enumerable
        // and a dropped request is a TypeError, so passing the object
        // prints "{}" for both and the one useful sentence is lost.
        console.error(
          "Sales fetch error:",
          (error as any)?.message ?? error,
          (error as any)?.code ? `(${(error as any).code})` : "",
          (error as any)?.hint ?? "",
        )
        throw new Error(`Failed to fetch sales: ${error.message}`)
      }

      const rows = Array.isArray(data) ? data as SaleRow[] : []
      const parsedSales = parseSupabaseRows(rows)
      
      setUiSales(parsedSales)
      setError(null)
      
    } catch (e: any) {
      console.error(
        "Load sales error:",
        (e as any)?.message ?? e,
        (e as any)?.code ? `(${(e as any).code})` : "",
      )
      setError(e.message || "Failed to load sales data")
      setUiSales([])
      
      toast({
        title: "Error loading sales",
        description: e.message || "Failed to fetch sales data",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  // Arriving from a customer's "View Orders": pre-select that customer.
  //
  // Read from window.location rather than useSearchParams, because this
  // page is statically prerendered and useSearchParams would force it
  // out of that — for one optional query parameter. Runs once, so it
  // never fights the shop changing the filter by hand afterwards.
  useEffect(() => {
    if (typeof window === "undefined") return
    const who = new URLSearchParams(window.location.search).get("customer")
    if (who) setCustomerFilter(who)
  }, [])

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) {
      setLoading(false)
      return
    }

    let mounted = true

    const initLoad = async () => {
      await loadSales()
      if (!mounted) return
    }
    
    initLoad()
    return () => {
      mounted = false
    }
  }, [currentShopId])

  // Get unique brands and categories from all products
  /**
   * Shops that can be filtered by.
   *
   * Taken from the connections, not from transfers that already exist —
   * otherwise the list is empty until the first transfer is made, and
   * the shop looks broken at exactly the moment someone goes looking
   * for it. Any shop already transferred to is added too, so a
   * connection removed later does not hide its history.
   */
  const transferShops = useMemo(() => {
    const ids = new Set<string>(linked.map((l) => l.id))
    for (const s of uiSales) if (s.transferToOrgId) ids.add(s.transferToOrgId)
    return Array.from(ids).map(id => ({ id, name: nameOf(id) }))
  }, [uiSales, nameOf, linked])

  // FIXED: Better client-side filtering with date validation and product filters
  /** True when a filter applies to line items rather than to the sale. */
  const productFilterActive =
    brandFilter !== "all" ||
    categoryFilter !== "all" ||
    productFilter !== "all" ||
    supplierFilter !== "all" ||
    variantFilter !== "all"

  type LineFilter = "brand" | "category" | "product" | "supplier" | "variant"

  /**
   * Whether a sold line passes the product filters, optionally ignoring
   * one. Ignoring one is how each box lists only what the OTHER choices
   * still leave: pick Accessories and Products offers accessories.
   */
  const lineMatches = (p: SoldProduct, skip?: LineFilter) =>
    (skip === "brand" || brandFilter === "all" || p.brand === brandFilter) &&
    (skip === "category" || categoryFilter === "all" || p.category === categoryFilter) &&
    (skip === "product" || productFilter === "all" || p.product_name === productFilter) &&
    (skip === "supplier" || supplierFilter === "all" || p.supplier === supplierFilter) &&
    (skip === "variant" || variantFilter === "all" || p.variant === variantFilter)

  /** The sale-level tests: dates, transfers, customer and the search. */
  const saleMatches = (s: UiSale, skipCustomer = false) => {
    let start: Date | null = null
    let end: Date | null = null
    
    try {
      if (startDate) start = new Date(startDate)
      if (endDate) end = new Date(endDate)
    } catch {
      // Invalid dates - ignore filters
    }
    
    const q = query.trim().toLowerCase()

    {
      let saleDate: Date
      try {
        saleDate = new Date(s.dateISO)
      } catch {
        return false
      }
      
      const inStart = !start || saleDate >= start
      const inEnd = !end || saleDate <= end
      
      // Brand and category filters - check if ANY product matches
      const transferOk =
        transferFilter === "all"
          ? true
          : transferFilter === "customers"
            ? !s.transferToOrgId
            : s.transferToOrgId === transferFilter
      const customerOk =
        skipCustomer || customerFilter === "all" || s.customer === customerFilter

      // Search across sale and product fields
      // invoiceNumber was missing, so typing "INV-000001" — the number
      // printed on the customer's own copy, and the first thing anyone
      // reaches for — matched nothing. Only the internal row id did.
      // The phone is here because it is how a shop is asked to find a
      // sale: the customer rings up and gives their number, not an
      // invoice number they threw away.
      const saleSearchText =
        `${s.id} ${s.invoiceNumber ?? ""} ${s.customer ?? ""} ${s.customerPhone ?? ""} ${s.payment ?? ""} ${s.status ?? ""}`.toLowerCase()
      const productSearchText = s.products.map(p =>
        `${p.barcode ?? ""} ${p.product_name} ${p.model_number ?? ""} ${p.color ?? ""} ${p.brand ?? ""} ${p.category ?? ""} ${p.variant ?? ""} ${p.supplier ?? ""}`
      ).join(" ").toLowerCase()

      const matchQ = !q || saleSearchText.includes(q) || productSearchText.includes(q)

      return inStart && inEnd && transferOk && customerOk && matchQ
    }
  }

  const filteredSales = useMemo(() => {
    return uiSales.filter((s) => saleMatches(s))
    // A product filter narrows the LINES, not just the list of sales.
    //
    // Asking for Accessories used to return the whole invoice as soon
    // as one accessory was on it — so a report of accessory sales
    // carried the handset's ৳21,999 with it, and every total on the
    // page was the wrong question answered confidently. Now an invoice
    // that mixes categories contributes only the lines that match, and
    // its figures are re-derived from those lines.
    .flatMap((s) => {
      if (!productFilterActive) return [s]

      const matching = s.products.filter((p) => lineMatches(p))

      if (matching.length === 0) return []

      // Totals come from the lines on show. sale.total is the whole
      // invoice — including anything filtered out, and any balance
      // carried onto it — so it cannot stand in for part of one.
      const lineTotal = matching.reduce((sum, p) => sum + Number(p.total_price ?? 0), 0)
      const lineDiscount = matching.reduce(
        (sum, p) => sum + Number(p.discount_amount ?? 0) * Number(p.quantity ?? 0),
        0
      )

      return [{ ...s, products: matching, itemsCount: matching.length, total: lineTotal, totalDiscount: lineDiscount }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiSales, startDate, endDate, query, transferFilter, customerFilter, brandFilter, categoryFilter, productFilter, supplierFilter, variantFilter, productFilterActive])

  // Each box lists only the values the OTHER filters still leave, so a
  // choice can never lead to an empty table — the same as Inventory and
  // Purchases.
  const { brands, categories, customers, productNames, suppliers, variants } = useMemo(() => {
    const collect = (skip: LineFilter, pick: (p: SoldProduct) => string | null | undefined) => {
      const set = new Set<string>()
      for (const sale of uiSales) {
        if (!saleMatches(sale)) continue
        for (const p of sale.products) {
          const v = pick(p)
          if (v && lineMatches(p, skip)) set.add(v)
        }
      }
      return Array.from(set).sort()
    }

    // Walk-in sales have no customer, so they are simply absent from
    // the list rather than appearing as a blank option.
    const customerSet = new Set<string>()
    for (const sale of uiSales) {
      if (!sale.customer || !saleMatches(sale, true)) continue
      if (productFilterActive && !sale.products.some((p) => lineMatches(p))) continue
      customerSet.add(sale.customer)
    }

    return {
      brands: ["All Brands", ...collect("brand", (p) => p.brand)],
      categories: ["All Categories", ...collect("category", (p) => p.category)],
      customers: Array.from(customerSet).sort(),
      productNames: collect("product", (p) => p.product_name),
      suppliers: collect("supplier", (p) => p.supplier),
      variants: collect("variant", (p) => p.variant),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiSales, startDate, endDate, query, transferFilter, customerFilter, brandFilter, categoryFilter, productFilter, supplierFilter, variantFilter, productFilterActive])

  /** The search as matching sees it, for marking the handset it found. */
  const searchKey = searchKeyOf(query)

  // A barcode or IMEI search that lands on a few sales opens them, so
  // the handset that was typed for is on screen without a click. More
  // than three is a partial number still being typed, and opening a
  // page of invoices would bury the table.
  const barcodeHitIds = useMemo(
    () =>
      filteredSales
        .filter((s) => s.products.some((p) => codeMatches(p.barcode, searchKey)))
        .map((s) => s.id),
    [filteredSales, searchKey],
  )
  const barcodeHitKey = barcodeHitIds.join("|")
  useEffect(() => {
    if (barcodeHitIds.length === 0 || barcodeHitIds.length > 3) return
    setExpandedRows((prev) => {
      const next = new Set(prev)
      barcodeHitIds.forEach((id) => next.add(id))
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodeHitKey])

  // UPDATED: Calculate total items sold (sum of quantities) instead of transaction count
  const totalTransactions = filteredSales.length
  const totalItemsSold = filteredSales.reduce((sum, s) => {
    return sum + s.products.reduce((itemSum, p) => itemSum + Number(p.quantity || 0), 0)
  }, 0)
  const totalRevenue = filteredSales.reduce((sum, s) => sum + (Number.isFinite(s.total) ? s.total : 0), 0)
  const todayISO = new Date().toISOString().slice(0, 10)
  const todaySales = filteredSales.filter((s) => s.dateISO === todayISO).length
  
  // UPDATED: Calculate total profit using revenue - cost formula
  const totalProfit = useMemo(() => {
    return filteredSales.reduce((sum, sale) => {
      // Calculate total cost for all products in the sale
      const totalCost = sale.products.reduce((costSum, product) => {
        const costPrice = Number(product.cost_price) || 0
        const quantity = Number(product.quantity) || 0
        return costSum + (costPrice * quantity)
      }, 0)
      
      // Profit = Revenue - Total Cost
      const saleProfit = sale.total - totalCost
      
      return sum + saleProfit
    }, 0)
  }, [filteredSales])

  const clearFilters = () => {
    setStartDate("")
    setEndDate("")
    setQuery("")
    setTransferFilter("customers")
    setCustomerFilter("all")
    setBrandFilter("all")
    setCategoryFilter("all")
    setProductFilter("all")
    setSupplierFilter("all")
    setVariantFilter("all")
  }

  /**
   * Re-open the invoice for one sale, any time after the fact.
   *
   * Customers come back weeks later having lost the paper, and until
   * now the only invoice this software could produce was the one
   * printed the moment the sale completed. The document is rebuilt from
   * the sale record, so a reprint shows what was sold then, not what
   * the product looks like in stock today.
   */
  const handleDeleteSale = async () => {
    if (!pendingDelete || !currentShopId) return
    setDeleting(true)
    try {
      const { data, error } = await supabase.rpc("delete_sale", {
        p_organization_id: currentShopId,
        p_sale_id: Number(pendingDelete.id),
      })

      if (error) {
        console.error("delete_sale failed:", error)
        toast({
          title: "Could not remove the sale",
          description: error.message,
          variant: "destructive",
        })
        return
      }

      const result = data as { success: boolean; message?: string } | null
      if (!result?.success) {
        toast({
          title: "Could not remove the sale",
          description: result?.message ?? "Nothing was changed.",
          variant: "destructive",
        })
        return
      }

      toast({ title: "Sale removed", description: result.message })
      setPendingDelete(null)
      loadSales()
    } finally {
      setDeleting(false)
    }
  }

  const printInvoice = async (saleId: string) => {
    setPrintingId(saleId)
    try {
      const result = await openPrintableReceipt({
        supabase,
        saleId: Number(saleId),
        organizationId: currentShopId,
        shop: shops.find((s) => s.id === currentShopId),
      })

      if (!result.ok) {
        toast({
          title: "Invoice did not open",
          description:
            result.reason === "popup-blocked"
              ? "Allow pop-ups for this application, then try again."
              : "Could not build the invoice for that sale.",
          variant: "destructive",
        })
      }
    } finally {
      setPrintingId(null)
    }
  }

  const toggleRow = (saleId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(saleId)) {
        next.delete(saleId)
      } else {
        next.add(saleId)
      }
      return next
    })
  }

  // NEW: Custom print function for sales history
  // ------------------------------------------------------------------
  // The three printed sheets
  // ------------------------------------------------------------------

  const periodText = () => {
    if (startDate && endDate)
      return `${new Date(startDate).toLocaleDateString("en-GB")} --- ${new Date(endDate).toLocaleDateString("en-GB")}`
    if (startDate) return `From ${new Date(startDate).toLocaleDateString("en-GB")}`
    if (endDate) return `Up to ${new Date(endDate).toLocaleDateString("en-GB")}`
    return "All Time"
  }

  const filterText = () => {
    const bits = [
      customerFilter !== "all" ? `Customer: ${customerFilter}` : "",
      productFilter !== "all" ? `Product: ${productFilter}` : "",
      supplierFilter !== "all" ? `Supplier: ${supplierFilter}` : "",
      variantFilter !== "all" ? `Variant: ${variantFilter}` : "",
      brandFilter !== "all" ? `Brand: ${brandFilter}` : "",
      categoryFilter !== "all" ? `Category: ${categoryFilter}` : "",
      query ? `Search: "${query}"` : "",
    ].filter(Boolean)
    return bits.join("  •  ")
  }

  const noWindow = () =>
    toast({
      title: "Print window did not open",
      description: "Allow pop-ups for this application, then try again.",
      variant: "destructive",
    })

  /**
   * What came back over the same period.
   *
   * Read at print time rather than kept in state: it is wanted on one
   * sheet only, and loading it with every visit to the Sales page would
   * be a query nobody asked for.
   */
  const loadReturnsForPeriod = async (): Promise<ReportReturn> => {
    if (!currentShopId) return { qty: 0, amount: 0 }

    let q = supabase
      .from("sales_returns")
      .select("return_date, total_refund_amount, sales_return_items(quantity, deleted_at)")
      .eq("organization_id", currentShopId)
      .is("deleted_at", null)

    if (startDate) q = q.gte("return_date", startDate)
    if (endDate) q = q.lte("return_date", endDate)

    const { data, error } = await q
    if (error) {
      // A missing returns figure is one line of a sheet, not a reason
      // to refuse to print it.
      console.warn("Could not read sales returns:", error.message)
      return { qty: 0, amount: 0 }
    }

    let qty = 0
    let amount = 0
    for (const r of (data ?? []) as any[]) {
      amount += Number(r.total_refund_amount) || 0
      for (const it of r.sales_return_items ?? []) {
        if (it.deleted_at) continue
        qty += Number(it.quantity) || 0
      }
    }
    return { qty, amount }
  }

  const handlePrintSalesReport = async () => {
    const returns = await loadReturnsForPeriod()
    const ok = printSalesReport({
      header,
      period: periodText(),
      filters: filterText(),
      sales: filteredSales,
      returns,
    })
    if (!ok) noWindow()
  }

  const handlePrintDetails = () => {
    const ok = printDetailsReport({
      header,
      period: periodText(),
      filters: filterText(),
      sales: filteredSales,
    })
    if (!ok) noWindow()
  }

  const handlePrintImei = () => {
    const ok = printImeiReport({
      header,
      period: periodText(),
      filters: filterText(),
      sales: filteredSales,
    })
    if (!ok) noWindow()
  }

  const handleExportCSV = () => {
    try {
      const rows: string[] = []
      
      filteredSales.forEach(s => {
        // Calculate total cost for the sale
        const totalCost = s.products.reduce((sum, p) => {
          const costPrice = Number(p.cost_price) || 0
          const quantity = Number(p.quantity) || 0
          return sum + (costPrice * quantity)
        }, 0)
        
        // Sale-level profit
        const saleProfit = s.total - totalCost
        
        s.products.forEach((p, idx) => {
          const costPrice = Number(p.cost_price) || 0
          const quantity = Number(p.quantity) || 0
          const lineCost = costPrice * quantity
          
          // Proportionally distribute the total discount across products based on their total_price
          const totalProductValue = s.products.reduce((sum, prod) => sum + Number(prod.total_price), 0)
          const proportionalDiscount = totalProductValue > 0 
            ? (Number(p.total_price) / totalProductValue) * s.totalDiscount 
            : 0
          
          // Line profit with proportional discount
          const lineProfit = p.total_price - lineCost - proportionalDiscount
          
          rows.push([
            s.id,
            s.dateISO,
            s.timeLabel,
            `"${s.customer || ''}"`,
            `"${p.product_name}"`,
            `"${p.model_number || ''}"`,
            `"${p.color || ''}"`,
            `"${p.barcode || ''}"`,
            `"${p.brand || ''}"`,
            `"${p.category || ''}"`,
            p.quantity,
            p.unit_price.toFixed(2),
            costPrice.toFixed(2),
            p.total_price.toFixed(2),
            proportionalDiscount.toFixed(2),
            lineProfit.toFixed(2),
            `"${s.payment || ''}"`,
            `"${s.status || ''}"`,
            idx === 0 ? s.total.toFixed(2) : '', // Sale total on first product
            idx === 0 ? s.totalDiscount.toFixed(2) : '', // Total discount on first product
            idx === 0 ? saleProfit.toFixed(2) : '' // Sale profit on first product
          ].join(','))
        })
      })
      
      const csv = [
        'Sale ID,Date,Time,Customer,Product Name,Model,Color,Barcode,Brand,Category,Qty,Unit Price,Cost Price,Line Total,Line Discount,Line Profit,Payment Method,Status,Sale Total,Sale Discount,Sale Profit',
        ...rows
      ].join('\n')
      
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sales-report-${new Date().toISOString().slice(0,10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      
      toast({
        title: "Export successful",
        description: `Exported ${filteredSales.length} sales with product details and profit`
      })
    } catch (error) {
      toast({
        title: "Export failed",
        description: "Could not export sales data",
        variant: "destructive"
      })
    }
  }

  // FIXED: Handle loading state
  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Sales</h2>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-1">
                <CardTitle className="text-sm font-medium">Loading...</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-xl font-bold">—</div>
              </CardContent>
            </Card>
          ))}
        </div>
        
        <Card>
          <CardContent className="p-8 text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading sales data...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Sales</h2>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={loadSales} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          <Button 
            variant="outline" 
            onClick={handleExportCSV}
            disabled={filteredSales.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          {/* Three sheets, three questions. One report could not serve
              all of them: what sold by brand, every line with who
              bought it and how, and which serials left the shop. */}
          <Button
            onClick={handlePrintSalesReport}
            disabled={filteredSales.length === 0}
          >
            <Printer className="mr-2 h-4 w-4" />
            Sales Report
          </Button>
          <Button
            variant="outline"
            onClick={handlePrintDetails}
            disabled={filteredSales.length === 0}
          >
            <Printer className="mr-2 h-4 w-4" />
            Details
          </Button>
          <Button
            variant="outline"
            onClick={handlePrintImei}
            disabled={filteredSales.length === 0}
          >
            <Printer className="mr-2 h-4 w-4" />
            IMEI Wise
          </Button>
        </div>
      </div>

      {/* Filter Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3">
            {/* Dates and search on one line */}
            <div className="flex flex-wrap items-center gap-3">
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
              idPrefix="sales"
            />
                <Input
                  id="search"
                  aria-label="Search"
                  placeholder="Search barcode, invoice, customer, product…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 min-w-[220px] flex-1"
                />
            </div>

            {/* Customer, Category, Product, Brand, Supplier, Variant */}
            <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 xl:grid-cols-8">
              <div className="min-w-0">
                <Label htmlFor="customer-filter" className="text-xs">Customer</Label>
                <Select value={customerFilter} onValueChange={setCustomerFilter}>
                  <SelectTrigger id="customer-filter" className="mt-1 h-9">
                    <SelectValue placeholder="All Customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {customers.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label htmlFor="transfer-filter" className="text-xs">Sales type</Label>
                <Select value={transferFilter} onValueChange={setTransferFilter}>
                  <SelectTrigger id="transfer-filter" className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customers">Customer sales</SelectItem>
                    <SelectItem value="all">All, including shop transfers</SelectItem>
                    {transferShops.map(sh => (
                      <SelectItem key={sh.id} value={sh.id}>{sh.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label htmlFor="category-filter" className="text-xs">Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger id="category-filter" className="mt-1 h-9">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.filter(c => c !== "All Categories").map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label htmlFor="product-filter" className="text-xs">Product Name</Label>
                <Select value={productFilter} onValueChange={setProductFilter}>
                  <SelectTrigger id="product-filter" className="mt-1 h-9">
                    <SelectValue placeholder="All Products" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Products</SelectItem>
                    {productNames.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label htmlFor="brand-filter" className="text-xs">Brand</Label>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger id="brand-filter" className="mt-1 h-9">
                    <SelectValue placeholder="All Brands" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Brands</SelectItem>
                    {brands.filter(b => b !== "All Brands").map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label htmlFor="supplier-filter" className="text-xs">Supplier</Label>
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger id="supplier-filter" className="mt-1 h-9">
                    <SelectValue placeholder="All Suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suppliers</SelectItem>
                    {suppliers.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label htmlFor="variant-filter" className="text-xs">Variant</Label>
                <Select value={variantFilter} onValueChange={setVariantFilter}>
                  <SelectTrigger id="variant-filter" className="mt-1 h-9">
                    <SelectValue placeholder="All Variants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Variants</SelectItem>
                    {variants.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button variant="outline" className="h-9" onClick={clearFilters}>
                Clear Filters
              </Button>
            </div>
          </div>

          {(startDate || endDate || query || transferFilter !== "all" || customerFilter !== "all" || brandFilter !== "all" || categoryFilter !== "all" || productFilter !== "all" || supplierFilter !== "all" || variantFilter !== "all") && (
            <div className="mt-2 text-xs text-muted-foreground">
              Showing {filteredSales.length} of {uiSales.length} transactions
              {transferFilter === "customers" && " • customer sales only"}
              {transferFilter !== "customers" && transferFilter !== "all" &&
                ` • sent to ${transferShops.find(sh => sh.id === transferFilter)?.name ?? "shop"}`}
              {customerFilter !== "all" && ` • Customer: ${customerFilter}`}
              {productFilter !== "all" && ` • Product: ${productFilter}`}
              {brandFilter !== "all" && ` • Brand: ${brandFilter}`}
              {supplierFilter !== "all" && ` • Supplier: ${supplierFilter}`}
              {variantFilter !== "all" && ` • Variant: ${variantFilter}`}
              {categoryFilter !== "all" && ` • Category: ${categoryFilter}`}
              {query && ` • matching "${query}"`}
            </div>
          )}
        </CardContent>
      </Card>

      <StatStrip
        stats={[
          { label: "Items sold", value: totalItemsSold.toLocaleString() },
          { label: "Transactions", value: totalTransactions },
          { label: "Revenue", value: bdAmount(totalRevenue), tone: "money" },
          { label: "Profit", value: bdAmount(totalProfit), tone: "money" },
          { label: "Today", value: todaySales },
        ]}
      />

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sales History</CardTitle>
          <CardDescription>
            {error 
              ? `Error: ${error}`
              : startDate || endDate || query || brandFilter !== "all" || categoryFilter !== "all"
                ? `Filtered sales transactions (${filteredSales.length} results) - Click rows to see product details`
                : "Complete list of all sales transactions - Click rows to see product details"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-red-700">Failed to load: {error}</div>
                <Button onClick={loadSales} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Invoice / ID</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="p-6 text-sm text-muted-foreground">
                      {error ? "Failed to load sales data." : "No sales found for the selected filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSales.map((sale, idx) => {
                    // Calculate sale profit
                    const totalCost = sale.products.reduce((sum, p) => {
                      const costPrice = Number(p.cost_price) || 0
                      const quantity = Number(p.quantity) || 0
                      return sum + (costPrice * quantity)
                    }, 0)
                    const saleProfit = sale.total - totalCost
                    // The handset the search typed for, if it is on this sale.
                    const hit = sale.products.find((p) => codeMatches(p.barcode, searchKey))

                    return (
                      <Fragment key={`sale-${sale.id}-${idx}`}>
                        <TableRow
                          className={`cursor-pointer ${hit ? HIT_ROW_CLASS : "hover:bg-muted/50"}`}
                          onClick={() => toggleRow(sale.id)}
                        >
                          <TableCell>
                            {expandedRows.has(sale.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{sale.invoiceNumber ?? `#${sale.id}`}</span>
                              {sale.invoiceNumber && (
                                <span className="text-xs text-muted-foreground">#{sale.id}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm">{sale.dateISO}</span>
                              <span className="text-xs text-muted-foreground">{sale.timeLabel}</span>
                            </div>
                          </TableCell>
                          <TableCell>{sale.customer ?? "—"}</TableCell>
                          <TableCell>
                            {sale.itemsCount} item{sale.itemsCount === 1 ? "" : "s"}
                            {hit && (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {hit.product_name}{" "}
                                <span className="font-mono text-foreground">
                                  <Highlight text={hit.barcode ?? ""} term={searchKey} />
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{sale.payment ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                sale.status === "completed"
                                  ? "outline"
                                  : sale.status === "refunded"
                                  ? "destructive"
                                  : sale.status === "pending"
                                  ? "secondary"
                                  : "secondary"
                              }
                            >
                              {sale.status ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{bdAmount(sale.total)}</TableCell>
                          <TableCell className="text-right text-red-600">{bdAmount(sale.totalDiscount)}</TableCell>
                          <TableCell className="text-right font-bold text-green-600">{bdAmount(saleProfit)}</TableCell>
                          {/* stopPropagation: the row itself toggles the
                              product details, and printing an invoice
                              should not also expand the row. */}
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={printingId === sale.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  printInvoice(sale.id)
                                }}
                              >
                                <Printer className="mr-1.5 h-3.5 w-3.5" />
                                {printingId === sale.id ? "Opening…" : "Invoice"}
                              </Button>

                              {/* Correcting or removing a recorded sale
                                  is the owner's call. The database
                                  refuses a manager outright, so this is
                                  convenience, not the guard. */}
                              {isOwner && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    title="Correct this sale"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditingSaleId(Number(sale.id))
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
                                    title="Remove this sale"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setPendingDelete({
                                        id: sale.id,
                                        invoice: sale.invoiceNumber,
                                        total: sale.total,
                                      })
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        
                        {/* Expanded Product Details */}
                        {expandedRows.has(sale.id) && (
                          <TableRow>
                            <TableCell colSpan={11} className="bg-muted/30 p-0">
                              <div className="p-4">
                                <div className="mb-3 flex items-center justify-between">
                                  <h4 className="text-sm font-semibold">Products in this sale:</h4>
                                  <div className="text-sm text-muted-foreground">
                                    Sale Discount: <span className="font-semibold text-red-600">{bdAmount(sale.totalDiscount)}</span>
                                    {" • "}
                                    Sale Profit: <span className="font-semibold text-green-600">{bdAmount(saleProfit)}</span>
                                  </div>
                                </div>
                                <div className="rounded-md border bg-background">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead>Model</TableHead>
                                        <TableHead>Variant</TableHead>
                                        <TableHead>Color</TableHead>
                                        <TableHead>Brand</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead className="text-center">Qty</TableHead>
                                        <TableHead className="text-right">Unit Price</TableHead>
                                        <TableHead className="text-right">Cost Price</TableHead>
                                        <TableHead className="text-right">Line Total</TableHead>
                                        <TableHead className="text-right">Line Cost</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {sale.products.map((product) => {
                                        const costPrice = Number(product.cost_price) || 0
                                        const quantity = Number(product.quantity) || 0
                                        const lineCost = costPrice * quantity
                                        
                                        return (
                                          <TableRow
                                            key={product.id}
                                            className={
                                              codeMatches(product.barcode, searchKey)
                                                ? HIT_UNIT_CLASS
                                                : undefined
                                            }
                                          >
                                            <TableCell className="font-medium">{product.product_name}</TableCell>
                                            <TableCell>
                                              {product.barcode ? (
                                                <Highlight text={product.barcode} term={searchKey} />
                                              ) : (
                                                "—"
                                              )}
                                            </TableCell>
                                            <TableCell>{product.model_number ?? "—"}</TableCell>
                                            <TableCell className="font-medium">{product.variant ?? "—"}</TableCell>
                                            <TableCell>{product.color ?? "—"}</TableCell>
                                            <TableCell>{product.brand ?? "—"}</TableCell>
                                            <TableCell>{product.category ?? "—"}</TableCell>
                                            <TableCell className="text-center">{product.quantity}</TableCell>
                                            <TableCell className="text-right">{bdAmount(product.unit_price)}</TableCell>
                                            <TableCell className="text-right">{bdAmount(costPrice)}</TableCell>
                                            <TableCell className="text-right font-medium">{bdAmount(product.total_price)}</TableCell>
                                            <TableCell className="text-right text-muted-foreground">{bdAmount(lineCost)}</TableCell>
                                          </TableRow>
                                        )
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>

                                {/* How this sale was actually paid.
                                    On a split the shop needs to see
                                    which route took how much — the
                                    invoice only ever showed one total,
                                    so a part-cash part-bKash sale could
                                    not be checked against either. */}
                                <div className="mt-4">
                                  <h4 className="mb-2 text-sm font-semibold">
                                    How this was paid:
                                  </h4>
                                  <div className="rounded-md border bg-background">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Method</TableHead>
                                          <TableHead>Bank / account</TableHead>
                                          <TableHead className="text-right">Amount</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {sale.paymentLines.length === 0 ? (
                                          <TableRow>
                                            <TableCell
                                              colSpan={3}
                                              className="text-center text-muted-foreground"
                                            >
                                              Nothing was taken against this sale
                                              {sale.dues > 0 ? " — the whole amount is owing." : "."}
                                            </TableCell>
                                          </TableRow>
                                        ) : (
                                          sale.paymentLines.map((line) => (
                                            <TableRow key={line.id}>
                                              <TableCell className="font-medium">
                                                {line.label}
                                              </TableCell>
                                              <TableCell>{line.bank ?? "—"}</TableCell>
                                              <TableCell className="text-right font-medium">
                                                {bdAmount(line.amount)}
                                              </TableCell>
                                            </TableRow>
                                          ))
                                        )}

                                        <TableRow className="bg-muted/50">
                                          <TableCell colSpan={2} className="font-semibold">
                                            Received
                                          </TableCell>
                                          <TableCell className="text-right font-semibold">
                                            {bdAmount(sale.cashPaid + sale.bankPaid)}
                                          </TableCell>
                                        </TableRow>
                                        {sale.dues > 0 && (
                                          <TableRow>
                                            <TableCell colSpan={2} className="font-semibold">
                                              Dues
                                            </TableCell>
                                            <TableCell className="text-right font-semibold text-red-600">
                                              {bdAmount(sale.dues)}
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                  {sale.paymentLines.some((l) => !l.fromLines) && (
                                    <p className="mt-1.5 text-xs text-muted-foreground">
                                      Taken before this shop recorded each route
                                      separately, so this is rebuilt from the
                                      totals kept at the time — the bank behind a
                                      card or transfer was not stored then.
                                    </p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ---- Correct a sale. Owner only; the database checks again. ---- */}
      <SaleEditDialog
        saleId={editingSaleId}
        open={editingSaleId !== null}
        onOpenChange={(o) => !o && setEditingSaleId(null)}
        onSaved={loadSales}
      />

      {/* ---- Remove a sale ----

          Spelled out rather than a bare "Are you sure": what comes back
          is the part nobody thinks about, and it is the part that makes
          this safe to do. */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingDelete?.invoice ?? "this sale"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {bdAmount(pendingDelete?.total ?? 0)} will come off the day's
                  takings, and the sale disappears from the cashbook, the
                  ledger, Bank Info and every report.
                </p>
                <p>
                  Every unit on it goes back into stock, and anything the
                  customer still owed on it comes off their balance.
                </p>
                <p className="font-medium text-foreground">
                  This cannot be undone.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                handleDeleteSale()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Removing…" : "Remove sale"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}