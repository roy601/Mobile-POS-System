"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Edit, Eye, Package, Calendar, Printer, Download, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  codeMatches,
  Highlight,
  HIT_ROW_CLASS,
  HIT_UNIT_CLASS,
  searchKeyOf,
} from "@/components/search-hit"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"
import { shopHeader } from "@/lib/utils/shop-header"
import { ManagerAccessBadge } from "@/components/role-badge"
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt"
import { esc } from "@/lib/report-chrome"
import { StatStrip } from "@/components/stat-strip"

// FIXED: More defensive type definition with purchase_date
type RawInventoryRow = {
  barcode: string
  product_name: string
  model_number?: string | null
  category?: string | null
  brand?: string | null
  supplier?: string | null
  sale_price?: number | null
  cost_price?: number | null
  quantity?: number | null
  color?: string | null
  variant?: string | null
  imei?: string | null
  purchase_id?: number | null
  purchase_date?: string | null
}

/** One physical unit behind a grouped product row. */
type ProductUnit = {
  barcode: string
  // Which purchase put this unit on the shelf. Edit and delete act on
  // the purchase, because that is what sync_inventory_from_purchase
  // reads back into stock.
  purchaseId: number | null
  quantity: number
  imei: string | null
  purchaseDate: string | null
}

type Product = {
  productName: string
  modelNumber: string | null
  category: string | null
  brand: string | null
  supplier: string | null
  salePrice: number
  costPrice: number | null
  quantity: number
  color: string | null
  // Part of the grouping key: 4/64 and 6/128 of the same handset are
  // different products at different prices and must not merge.
  variant: string | null
  purchaseDate: string | null
  // Distinct purchases behind this grouped row. Usually one; two if
  // the same handset was bought twice, and then a correction has to
  // touch both or the row goes back to disagreeing with itself.
  purchaseIds: number[]
  // Grouping sums the quantity for the table, but a shop still needs
  // to see which individual barcodes make up that number.
  units: ProductUnit[]
}

const supabase = createClient()
const LOW_STOCK_THRESHOLD = 5

/**
 * Every row a query matches, a page at a time.
 *
 * The database hands back at most 1,000 rows per request and says
 * nothing about the rest, so a shop with more stock rows than that saw
 * a list -- and totals -- quietly cut short. Asks again from where the
 * last page ended until a short page says there is no more. The order
 * keeps the pages from overlapping or skipping a row.
 */
const PAGE = 1000
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<{ data: T[]; error: any }> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { data: all, error }
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) return { data: all, error: null }
  }
}

/**
 * Whether the search box is pointing at THIS unit — its barcode or
 * IMEI holds what was typed. A grouped row can hold dozens of handsets,
 * and the search finds the row, not the handset.
 */
const unitMatches = (u: { barcode: string; imei?: string | null }, key: string) =>
  codeMatches(u.barcode, key) || codeMatches(u.imei, key)

export function InventoryClient() {
  const { toast } = useToast()
  const { hasPermission, currentShopId, accountType, shops } = useRole()
  // Reports print the shop's own letterhead, not a hard-coded one.
  const header = shopHeader(shops.find((s) => s.id === currentShopId))
  const isOwner = accountType === "owner"
  // Bumped after an owner edit or delete so the table reflects it
  // without a full page reload.
  const [reloadKey, setReloadKey] = useState(0)

  // Date filtering
  const today = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")
  // Always on: the dates are always shown, and leaving them empty
  // shows every date -- which is all the old tick box did when off.
  const dateFilterEnabled = true

  const [searchTerm, setSearchTerm] = useState("")
  // The stock report reads sales and returns, which the page does not
  // otherwise load. Fetched only when the report is asked for, so the
  // Inventory screen itself stays as quick as it is.
  const [stockReportBusy, setStockReportBusy] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [productFilter, setProductFilter] = useState("all")
  const [modelFilter, setModelFilter] = useState("all")
  const [variantFilter, setVariantFilter] = useState("all")
  const [rows, setRows] = useState<RawInventoryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) {
      setIsLoading(false)
      return
    }

    let mounted = true

    async function loadInventory() {
      setIsLoading(true)
      setError(null)

      try {
        // FIXED: Try inventory view first, fallback to building from raw tables
        let invData: any[] = []
        
        const { data: viewData, error: viewError } = await readAll<any>((from, to) =>
          supabase
            .from("inventory")
            .select("barcode, purchase_id, product_name, model_number, category, brand, supplier, sale_price, cost_price, quantity, color, variant, imei")
            .eq("organization_id", currentShopId)
            .order("barcode")
            .range(from, to),
        )

        if (viewError) {
          console.warn("Inventory view failed, trying to build from tables:", viewError)
          
          // FIXED: Fallback - build inventory from purchases + color_variants with purchase date
          const { data: rawData, error: rawError } = await readAll<any>((from, to) =>
            supabase
            .from("color_variants")
            .select(`
              barcode,
              color,
              variant,
              quantity,
              imei,
              purchase_id,
              purchases!inner (
                product_name,
                model_number,
                category,
                brand,
                supplier,
                cost_price,
                sale_price,
                created_at
              )
            `)
            .eq("organization_id", currentShopId)
            .order("id")
            .range(from, to),
          )

          if (rawError) {
            console.error("Fallback query also failed:", rawError)
            throw new Error(`Failed to load inventory data: ${rawError.message}`)
          }

          // Transform raw data to inventory format
          invData = (rawData ?? []).map((item: any) => {
            const purchase = item.purchases
            return {
              barcode: item.barcode || '',
              product_name: purchase?.product_name || 'Unknown Product',
              model_number: purchase?.model_number || null,
              category: purchase?.category || null,
              brand: purchase?.brand || null,
              supplier: purchase?.supplier || null,
              sale_price: purchase?.sale_price || null,
              cost_price: purchase?.cost_price || null,
              quantity: item.quantity || 0,
              color: item.color || null,
              variant: item.variant || null,
              imei: item.imei || null,
              // Carried on the fallback path too, or Edit and Delete
              // would silently do nothing whenever the main query failed
              // and this branch ran instead.
              purchase_id: item.purchase_id ?? null,
              purchase_date: purchase?.created_at || null
            }
          })
        } else {
          // If using inventory view, we need to get purchase dates separately
          invData = viewData ?? []
          
          // Try to enrich with purchase dates
          const { data: purchaseData } = await readAll<any>((from, to) =>
            supabase
              .from("color_variants")
              .select(`
                barcode,
                purchases!inner (
                  created_at
                )
              `)
              .eq("organization_id", currentShopId)
              .order("id")
              .range(from, to),
          )
          
          if (purchaseData) {
            const purchaseDateMap = new Map()
            purchaseData.forEach((item: any) => {
              if (item.barcode && item.purchases?.created_at) {
                purchaseDateMap.set(item.barcode, item.purchases.created_at)
              }
            })
            
            invData = invData.map((item: any) => ({
              ...item,
              purchase_date: purchaseDateMap.get(item.barcode) || null
            }))
          }
        }

        // FIXED: Defensive normalization with better error handling
        const safeRows: RawInventoryRow[] = Array.isArray(invData)
          ? invData.map((r: any) => ({
              barcode: String(r?.barcode ?? ""),
              product_name: String(r?.product_name ?? "Unknown Product"),
              model_number: r?.model_number ?? null,
              category: r?.category ?? null,
              brand: r?.brand ?? null,
              supplier: r?.supplier ?? null,
              sale_price: r?.sale_price != null ? Number(r.sale_price) : null,
              cost_price: r?.cost_price != null ? Number(r.cost_price) : null,
              quantity: r?.quantity != null ? Number(r.quantity) : 0,
              color: r?.color ?? null,
              variant: r?.variant ?? null,
              imei: r?.imei ?? null,
              purchase_id: r?.purchase_id != null ? Number(r.purchase_id) : null,
              purchase_date: r?.purchase_date ?? null
            }))
          : []

        if (!mounted) return
        setRows(safeRows)
        setError(null)

      } catch (error: any) {
        console.error("Inventory load error:", error)
        if (!mounted) return
        
        setError(error.message || "Failed to load inventory data")
        toast({
          title: "Failed to load inventory",
          description: error.message || "Unknown error occurred",
          variant: "destructive",
        })
        setRows([])
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    loadInventory()
    return () => {
      mounted = false
    }
  }, [toast, currentShopId, reloadKey])

  // UPDATED: Apply flexible date filter to rows
  const dateFilteredRows = useMemo(() => {
    // If date filter is not enabled, show all rows
    if (!dateFilterEnabled) {
      return rows
    }

    // If no dates are selected, show all rows
    if (!startDate && !endDate) {
      return rows
    }

    return rows.filter((r) => {
      if (!r.purchase_date) return false
      const purchaseDate = new Date(r.purchase_date).toISOString().split('T')[0]
      
      // If only "To Date" is set, show all up to that date (from beginning to endDate)
      if (!startDate && endDate) {
        return purchaseDate <= endDate
      }
      
      // If only "From Date" is set, show all from that date onwards (from startDate to now)
      if (startDate && !endDate) {
        return purchaseDate >= startDate
      }
      
      // If both dates are set, show within range
      return purchaseDate >= startDate && purchaseDate <= endDate
    })
  }, [rows, dateFilterEnabled, startDate, endDate])

  // Get the date range description
  const getDateRangeDescription = () => {
    if (!dateFilterEnabled) return null
    if (!startDate && !endDate) return "All dates"
    if (!startDate && endDate) return `All inventory up to ${new Date(endDate).toLocaleDateString('en-GB')}`
    if (startDate && !endDate) return `All inventory from ${new Date(startDate).toLocaleDateString('en-GB')} onwards`
    return `${new Date(startDate).toLocaleDateString('en-GB')} to ${new Date(endDate).toLocaleDateString('en-GB')}`
  }

  // FIXED: Better grouping logic with validation
  const products: Product[] = useMemo(() => {
    const map = new Map<string, Product>()
    
    for (const r of dateFilteredRows) {
      if (!r.product_name) continue // Skip invalid entries
      
      // CATEGORY IS PART OF THE IDENTITY.
      //
      // Without it, a handset held as a demo unit and the same handset
      // held for sale merged into ONE product, and the merged row took
      // the category of whichever came back from the database first.
      // Star Power 02 had four demo units swallowed into "Phone" rows
      // this way: filtering to "Demo Phone" showed 9 of the 13 that were
      // really there, and because the group keeps the first row's cost
      // price, demo units bought at ৳9,130 were valued at the ৳15,641
      // paid for the retail ones — ৳32,944 of stock value that did not
      // exist.
      //
      // Two things sharing a name, model, colour and variant are still
      // two different things if the shop files them differently.
      const key = [
        r.product_name.trim().toLowerCase(),
        (r.model_number ?? "").trim().toLowerCase(),
        (r.brand ?? "").trim().toLowerCase(),
        (r.color ?? "").trim().toLowerCase(),
        (r.variant ?? "").trim().toLowerCase(),
        (r.category ?? "").trim().toLowerCase(),
      ].join("|")

      const qty = Math.max(0, Number(r.quantity ?? 0)) // Ensure non-negative
      const sale = Math.max(0, Number(r.sale_price ?? 0))
      const cost = r.cost_price != null ? Math.max(0, Number(r.cost_price)) : null

      const existing = map.get(key)
      if (!existing) {
        map.set(key, {
          productName: r.product_name,
          modelNumber: r.model_number ?? null,
          category: r.category ?? null,
          brand: r.brand ?? null,
          supplier: r.supplier ?? null,
          salePrice: sale,
          costPrice: cost,
          quantity: qty,
          color: r.color ?? null,
          variant: r.variant ?? null,
          purchaseDate: r.purchase_date ?? null,
          purchaseIds: r.purchase_id != null ? [r.purchase_id] : [],
          units: [
            {
              barcode: r.barcode,
              purchaseId: r.purchase_id ?? null,
              quantity: qty,
              imei: r.imei ?? null,
              purchaseDate: r.purchase_date ?? null,
            },
          ],
        })
      } else {
        existing.units.push({
          barcode: r.barcode,
          purchaseId: r.purchase_id ?? null,
          quantity: qty,
          imei: r.imei ?? null,
          purchaseDate: r.purchase_date ?? null,
        })
        if (r.purchase_id != null && !existing.purchaseIds.includes(r.purchase_id)) {
          existing.purchaseIds.push(r.purchase_id)
        }
        existing.quantity += qty
        // Use highest sale price if multiple entries
        if (sale > existing.salePrice) existing.salePrice = sale
        if (existing.costPrice == null && cost != null) existing.costPrice = cost
        // Keep most recent purchase date
        if (r.purchase_date && (!existing.purchaseDate || r.purchase_date > existing.purchaseDate)) {
          existing.purchaseDate = r.purchase_date
        }
      }
    }
    return Array.from(map.values())
  }, [dateFilteredRows])

  // FIXED: Better filtering with null safety
  // A product with no category still has to be reachable from the
  // Category box. It used to be listed as "Uncategorized" and then
  // compared against a null category, so picking it found nothing —
  // the one option guaranteed to fail. Both sides go through here.
  const categoryOf = (p: Product) => (p.category ?? "").trim() || "Uncategorized"

  const matchesSearch = (p: Product, term: string) =>
    !term ||
    p.productName.toLowerCase().includes(term) ||
    (p.modelNumber ?? "").toLowerCase().includes(term) ||
    (p.brand ?? "").toLowerCase().includes(term) ||
    (p.color ?? "").toLowerCase().includes(term) ||
    (p.variant ?? "").toLowerCase().includes(term) ||
    (p.category ?? "").toLowerCase().includes(term) ||
    (p.supplier ?? "").toLowerCase().includes(term) ||
    // A row here is a group of identical units, so the barcode lives
    // on the units beneath it. Searching the group's own fields alone
    // meant the one number printed on the box — the fastest thing to
    // type, and the only one that identifies a single handset — found
    // nothing.
    p.units.some(
      (u) =>
        u.barcode.toLowerCase().includes(term) ||
        (u.imei ?? "").toLowerCase().includes(term)
    )

  /**
   * Everything matching the filters, optionally ignoring one of them.
   *
   * `skip` is what makes the four boxes behave: each one lists the
   * values still reachable under the OTHER three, so a shop can never
   * pick a combination that shows an empty table. Without it, choosing
   * a category leaves the Model box offering models from every other
   * category, all of which lead nowhere.
   */
  const selectProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return (skip?: "category" | "product" | "model" | "variant") =>
      products.filter((p) => {
        if (!matchesSearch(p, term)) return false
        if (skip !== "category" && categoryFilter !== "all" && categoryOf(p) !== categoryFilter)
          return false
        if (skip !== "product" && productFilter !== "all" && p.productName !== productFilter)
          return false
        if (skip !== "model" && modelFilter !== "all" && (p.modelNumber ?? "") !== modelFilter)
          return false
        if (skip !== "variant" && variantFilter !== "all" && (p.variant ?? "") !== variantFilter)
          return false
        return true
      })
  }, [products, searchTerm, categoryFilter, productFilter, modelFilter, variantFilter])

  const filteredProducts = useMemo(() => selectProducts(), [selectProducts])

  /** The search as the matching sees it, for marking what it found. */
  const searchKey = searchKeyOf(searchTerm)

  const sortedUnique = (values: (string | null | undefined)[]) =>
    Array.from(new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    )

  const categories = useMemo(
    () => sortedUnique(selectProducts("category").map(categoryOf)),
    [selectProducts]
  )

  const productNameOptions = useMemo(
    () => sortedUnique(selectProducts("product").map((p) => p.productName)),
    [selectProducts]
  )

  const modelOptions = useMemo(
    () => sortedUnique(selectProducts("model").map((p) => p.modelNumber)),
    [selectProducts]
  )

  // Built from stock on hand, because each shop carries its own set of
  // RAM/ROM configurations.
  const variantOptions = useMemo(
    () => sortedUnique(selectProducts("variant").map((p) => p.variant)),
    [selectProducts]
  )

  // A choice that its own box no longer offers — pick a category, and
  // the model you had chosen is not sold in it — would leave the table
  // empty with no clue why. Drop it instead.
  useEffect(() => {
    if (categoryFilter !== "all" && !categories.includes(categoryFilter)) setCategoryFilter("all")
    if (productFilter !== "all" && !productNameOptions.includes(productFilter))
      setProductFilter("all")
    if (modelFilter !== "all" && !modelOptions.includes(modelFilter)) setModelFilter("all")
    if (variantFilter !== "all" && !variantOptions.includes(variantFilter)) setVariantFilter("all")
  }, [
    categories, productNameOptions, modelOptions, variantOptions,
    categoryFilter, productFilter, modelFilter, variantFilter,
  ])

  /** What is narrowing the list, in words, for the printed sheet. */
  const activeFilterText = useMemo(() => {
    const parts: string[] = []
    if (categoryFilter !== "all") parts.push(`Category: ${categoryFilter}`)
    if (productFilter !== "all") parts.push(`Product: ${productFilter}`)
    if (modelFilter !== "all") parts.push(`Model: ${modelFilter}`)
    if (variantFilter !== "all") parts.push(`Variant: ${variantFilter}`)
    if (searchTerm.trim()) parts.push(`Search: "${searchTerm.trim()}"`)
    return parts.join("  •  ")
  }, [categoryFilter, productFilter, modelFilter, variantFilter, searchTerm])

  // Every figure on the strip counts what is on screen. They used to
  // count the whole shop, so filtering to one model still reported the
  // full stock value — and the printed report, which lists the
  // filtered rows, footed them with the unfiltered totals.
  const totalValue = useMemo(
    () => filteredProducts.reduce((sum, p) => sum + (p.costPrice || 0) * (p.quantity || 0), 0),
    [filteredProducts]
  )

  const totalSaleValue = useMemo(
    () => filteredProducts.reduce((sum, p) => sum + (p.salePrice || 0) * (p.quantity || 0), 0),
    [filteredProducts]
  )

  const demoCount = useMemo(
    () => products.filter((p) => {
      const category = (p.category ?? "").toLowerCase()
      return category.includes("demo")
    }).length,
    [products]
  )

  const lowStockCount = useMemo(
    () => filteredProducts.filter(p => p.quantity <= LOW_STOCK_THRESHOLD && p.quantity > 0).length,
    [filteredProducts]
  )

  const outOfStockCount = useMemo(
    () => filteredProducts.filter(p => p.quantity === 0).length,
    [filteredProducts]
  )

  const totalQuantity = useMemo(
    () => filteredProducts.reduce((sum, p) => sum + p.quantity, 0),
    [filteredProducts]
  )

  const getStockStatus = (p: Product) => {
    if (p.quantity === 0) return { label: "Out of Stock", variant: "destructive" as const }
    if (p.quantity <= LOW_STOCK_THRESHOLD) return { label: "Low Stock", variant: "secondary" as const }
    return { label: "In Stock", variant: "outline" as const }
  }

  // ---- Owner: correcting and removing a product
  //
  // Both act on the PURCHASE behind the row, not on the stock row.
  // sync_inventory_from_purchase reads the purchase back into every
  // inventory row it created, so writing to inventory directly would
  // be undone the next time anything touched that purchase.
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [editForm, setEditForm] = useState({
    product_name: "",
    model_number: "",
    category: "",
    brand: "",
    supplier: "",
    cost_price: "",
    sale_price: "",
  })
  const [savingProduct, setSavingProduct] = useState(false)
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null)
  const [deletingProduct, setDeletingProduct] = useState(false)

  const handleEditProduct = (product: Product) => {
    // Editing a product changes pricing and stock records, so it is
    // owner-only. Managers can still sell and receive stock, which
    // moves quantities through the POS and purchase flows.
    if (!isOwner) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to edit products.",
        variant: "destructive",
      })
      return
    }
    if (product.purchaseIds.length === 0) {
      toast({
        title: "Cannot edit",
        description: "This stock has no purchase record behind it, so there is nothing to correct.",
        variant: "destructive",
      })
      return
    }
    setEditProduct(product)
    setEditForm({
      product_name: product.productName ?? "",
      model_number: product.modelNumber ?? "",
      category: product.category ?? "",
      brand: product.brand ?? "",
      supplier: product.supplier ?? "",
      cost_price: product.costPrice != null ? String(product.costPrice) : "",
      sale_price: product.salePrice != null ? String(product.salePrice) : "",
    })
  }

  const saveProductEdit = async () => {
    if (!editProduct || !currentShopId) return
    setSavingProduct(true)
    try {
      const failures: string[] = []

      // A grouped row can sit on more than one purchase. Correcting
      // only the first would leave the row disagreeing with itself the
      // moment it reloaded.
      for (const purchaseId of editProduct.purchaseIds) {
        const { data, error } = await supabase.rpc("update_purchase", {
          p_organization_id: currentShopId,
          p_purchase_id: purchaseId,
          p_fields: {
            product_name: editForm.product_name.trim(),
            model_number: editForm.model_number.trim(),
            category: editForm.category.trim(),
            brand: editForm.brand.trim(),
            supplier: editForm.supplier.trim(),
            cost_price: editForm.cost_price === "" ? null : Number(editForm.cost_price),
            sale_price: editForm.sale_price === "" ? null : Number(editForm.sale_price),
          },
        })
        if (error) failures.push(error.message)
        else if (!data?.success) failures.push(data?.message ?? "refused")
      }

      if (failures.length > 0) {
        toast({
          title: "Not saved",
          description: failures[0],
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Product updated",
        description: "Purchase and stock records were both updated.",
      })
      setEditProduct(null)
      setReloadKey((k) => k + 1)
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "Could not save.", variant: "destructive" })
    } finally {
      setSavingProduct(false)
    }
  }

  const confirmDeleteProduct = async () => {
    if (!deleteProduct || !currentShopId) return
    setDeletingProduct(true)
    try {
      const failures: string[] = []
      let removed = 0

      for (const purchaseId of deleteProduct.purchaseIds) {
        const { data, error } = await supabase.rpc("delete_purchase", {
          p_organization_id: currentShopId,
          p_purchase_id: purchaseId,
        })
        if (error) failures.push(error.message)
        else if (!data?.success) failures.push(data?.message ?? "refused")
        else removed += Number(data.stock_removed ?? 0)
      }

      if (failures.length > 0) {
        toast({
          title: "Not deleted",
          description: failures[0],
          variant: "destructive",
        })
        setReloadKey((k) => k + 1)
        return
      }

      toast({
        title: "Product deleted",
        description: `${removed} stock record(s) removed.`,
      })
      setDeleteProduct(null)
      setReloadKey((k) => k + 1)
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "Could not delete.", variant: "destructive" })
    } finally {
      setDeletingProduct(false)
    }
  }

  // The table groups units into one row, so "view" has to open up the
  // group and show which physical items sit behind the quantity.
  const [viewProduct, setViewProduct] = useState<Product | null>(null)

  // Opening a product found by its barcode or IMEI brings that unit
  // into view. A group of forty handsets would otherwise open at the
  // top, with the one that was typed for somewhere below the fold.
  const unitListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!viewProduct || !searchKey) return
    // After the dialog has laid out its rows.
    const t = window.setTimeout(() => {
      unitListRef.current
        ?.querySelector<HTMLElement>("[data-search-hit]")
        ?.scrollIntoView({ block: "center" })
    }, 60)
    return () => window.clearTimeout(t)
  }, [viewProduct, searchKey])

  const handleViewProduct = (product: Product) => {
    setViewProduct(product)
  }

  // Print inventory report - UPDATED with flexible date range text
  /**
   * Stock report: what came in, what went out, what is left.
   *
   * HOW THE COLUMNS RELATE
   *
   *   Opening Stock   every unit ever bought in
   *   − Previous Sales      sold before the report period
   *   − Today Sales         sold inside it
   *   + Sales Return        came back from customers
   *   − Purchase Return     went back to the supplier
   *   = Balance             what is on the shelf now
   *
   * Opening is DERIVED rather than read: color_variants.quantity is
   * decremented as units sell, so the original figure is not stored
   * anywhere. Working back from the balance is what makes every row
   * add up — and a stock sheet whose rows do not add up is worse than
   * no sheet at all.
   *
   * The two returns columns are all-time, not period-only, for the
   * same reason: a return that happened before the period would
   * otherwise sit inside Opening while appearing in no column, and the
   * arithmetic on the page would silently fail to balance.
   *
   * Values are quantity × cost price — what the stock is worth to the
   * shop, not what it might fetch.
   */
  const handlePrintStockReport = async () => {
    if (!currentShopId) return

    setStockReportBusy(true)
    try {
      const from = startDate || ""
      const to = endDate || new Date().toISOString().split("T")[0]

      const keyOf = (name?: string | null, model?: string | null, color?: string | null) =>
        `${(name ?? "").trim().toLowerCase()}|${(model ?? "").trim().toLowerCase()}|${(color ?? "").trim().toLowerCase()}`

      const [soldRes, salesReturnRes, purchaseReturnRes] = await Promise.all([
        supabase
          .from("sold_products")
          .select("product_name, model_number, color, quantity, sales!inner(sale_date, status)")
          .eq("organization_id", currentShopId)
          .eq("sales.status", "completed"),
        supabase
          .from("sales_return_items")
          .select("product_name, model_number, color, quantity")
          .eq("organization_id", currentShopId),
        supabase
          .from("purchase_return_items")
          .select("product_name, model_number, color, return_quantity")
          .eq("organization_id", currentShopId),
      ])

      if (soldRes.error) throw new Error(soldRes.error.message)

      const prevSales = new Map<string, number>()
      const periodSales = new Map<string, number>()

      for (const row of (soldRes.data ?? []) as any[]) {
        const sale = Array.isArray(row.sales) ? row.sales[0] : row.sales
        const when = String(sale?.sale_date ?? "").slice(0, 10)
        if (!when) continue

        const key = keyOf(row.product_name, row.model_number, row.color)
        const qty = Number(row.quantity) || 0
        // Anything on or before the end of the period counts; the split
        // is simply whether it falls inside the period or before it.
        if (when > to) continue
        // With no start date every sale up to the end date counts as
        // the period's, and Previous Sales is empty — which is the
        // honest reading of "everything up to this date".
        const bucket = from && when < from ? prevSales : periodSales
        bucket.set(key, (bucket.get(key) ?? 0) + qty)
      }

      const salesReturns = new Map<string, number>()
      for (const row of (salesReturnRes.data ?? []) as any[]) {
        const key = keyOf(row.product_name, row.model_number, row.color)
        salesReturns.set(key, (salesReturns.get(key) ?? 0) + (Number(row.quantity) || 0))
      }

      const purchaseReturns = new Map<string, number>()
      for (const row of (purchaseReturnRes.data ?? []) as any[]) {
        const key = keyOf(row.product_name, row.model_number, row.color)
        purchaseReturns.set(
          key,
          (purchaseReturns.get(key) ?? 0) + (Number(row.return_quantity) || 0)
        )
      }

      type Line = {
        brand: string
        model: string
        color: string
        openQty: number
        prevQty: number
        todayQty: number
        srQty: number
        prQty: number
        balQty: number
        cost: number
      }

      const groups = new Map<string, Line[]>()

      for (const p of filteredProducts) {
        const key = keyOf(p.productName, p.modelNumber, p.color)
        const cost = Number(p.costPrice) || 0
        const balQty = Number(p.quantity) || 0
        const prevQty = prevSales.get(key) ?? 0
        const todayQty = periodSales.get(key) ?? 0
        const srQty = salesReturns.get(key) ?? 0
        const prQty = purchaseReturns.get(key) ?? 0

        const line: Line = {
          brand: p.brand || "—",
          model: p.modelNumber || p.productName,
          color: p.color || "—",
          openQty: balQty + prevQty + todayQty - srQty + prQty,
          prevQty,
          todayQty,
          srQty,
          prQty,
          balQty,
          cost,
        }

        const category = p.category || "Uncategorised"
        if (!groups.has(category)) groups.set(category, [])
        groups.get(category)!.push(line)
      }

      const v = (qty: number, cost: number) => (qty * cost).toFixed(2)
      const grand = { open: 0, prev: 0, today: 0, sr: 0, pr: 0, bal: 0, openV: 0, balV: 0 }

      const groupsHtml = Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, lines]) => {
          const sorted = [...lines].sort(
            (a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model)
          )

          // Every column footed for this category, not just the two the
          // grand total carries. The values are summed line by line
          // because each line has its own cost — a category subtotal
          // quantity multiplied by any single cost would be a number
          // that matches nothing.
          const sub = {
            open: 0, openV: 0,
            pr: 0, prV: 0,
            prev: 0, prevV: 0,
            sr: 0, srV: 0,
            today: 0, todayV: 0,
            bal: 0, balV: 0,
          }

          const body = sorted
            .map((l) => {
              grand.open += l.openQty
              grand.prev += l.prevQty
              grand.today += l.todayQty
              grand.sr += l.srQty
              grand.pr += l.prQty
              grand.bal += l.balQty
              grand.openV += l.openQty * l.cost
              grand.balV += l.balQty * l.cost

              sub.open += l.openQty
              sub.openV += l.openQty * l.cost
              sub.pr += l.prQty
              sub.prV += l.prQty * l.cost
              sub.prev += l.prevQty
              sub.prevV += l.prevQty * l.cost
              sub.sr += l.srQty
              sub.srV += l.srQty * l.cost
              sub.today += l.todayQty
              sub.todayV += l.todayQty * l.cost
              sub.bal += l.balQty
              sub.balV += l.balQty * l.cost

              return `
                <tr>
                  <td>${l.brand}</td>
                  <td>${l.model}</td>
                  <td>${l.color}</td>
                  <td class="q">${l.openQty}</td>
                  <td class="m">${v(l.openQty, l.cost)}</td>
                  <td class="q">${l.prQty}</td>
                  <td class="m">${v(l.prQty, l.cost)}</td>
                  <td class="q">${l.prevQty}</td>
                  <td class="m">${v(l.prevQty, l.cost)}</td>
                  <td class="q">${l.srQty}</td>
                  <td class="m">${v(l.srQty, l.cost)}</td>
                  <td class="q">${l.todayQty}</td>
                  <td class="m">${v(l.todayQty, l.cost)}</td>
                  <td class="q b">${l.balQty}</td>
                  <td class="m b">${v(l.balQty, l.cost)}</td>
                </tr>`
            })
            .join("")

          return `
            <div class="group-title">${category}</div>
            <table class="stock">
              <thead>
                <tr class="grp">
                  <th colspan="3">ITEM NAME</th>
                  <th colspan="2">OPENING STOCK</th>
                  <th colspan="2">Purchase Return</th>
                  <th colspan="2">Previous Sales</th>
                  <th colspan="2">Sales Return</th>
                  <th colspan="2">Period Sales</th>
                  <th colspan="2">Balance</th>
                </tr>
                <tr class="sub">
                  <th>Brand Name</th><th>Model</th><th>Color</th>
                  <th>Quantity</th><th>Values</th>
                  <th>Quantity</th><th>Values</th>
                  <th>Quantity</th><th>Values</th>
                  <th>Quantity</th><th>Values</th>
                  <th>Quantity</th><th>Values</th>
                  <th>Quantity</th><th>Values</th>
                </tr>
              </thead>
              <tbody>
                ${body}
                <tr class="cat-total">
                  <td colspan="3">${category} total</td>
                  <td class="q">${sub.open}</td>
                  <td class="m">${sub.openV.toFixed(2)}</td>
                  <td class="q">${sub.pr}</td>
                  <td class="m">${sub.prV.toFixed(2)}</td>
                  <td class="q">${sub.prev}</td>
                  <td class="m">${sub.prevV.toFixed(2)}</td>
                  <td class="q">${sub.sr}</td>
                  <td class="m">${sub.srV.toFixed(2)}</td>
                  <td class="q">${sub.today}</td>
                  <td class="m">${sub.todayV.toFixed(2)}</td>
                  <td class="q">${sub.bal}</td>
                  <td class="m">${sub.balV.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>`
        })
        .join("")

      const printWindow = window.open("", "_blank")
      if (!printWindow) {
        toast({
          title: "Allow pop-ups",
          description: "The report opens in a new window.",
          variant: "destructive",
        })
        return
      }

      const rangeText = from
        ? `${new Date(from).toLocaleDateString("en-GB")} -- ${new Date(to).toLocaleDateString("en-GB")}`
        : `Up to ${new Date(to).toLocaleDateString("en-GB")}`

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Stock Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 12px; font-size: 11px; }
            .header { text-align: center; margin-bottom: 14px; }
            .company-name { font-size: 17px; font-weight: bold; color: #b00; }
            .address { font-size: 9px; }
            .title { font-size: 20px; font-weight: bold; margin: 6px 0; }
            .rule { border-bottom: 2px solid #b00; margin: 4px auto 8px; width: 90%; }
            .period { font-size: 13px; font-weight: bold; margin-bottom: 6px; }
            .group-title { text-align: center; font-weight: bold; color: #1a49b0; font-size: 14px; margin: 16px 0 4px; }
            table.stock { width: 100%; border-collapse: collapse; border: 2px solid #1a49b0; }
            table.stock th, table.stock td { border: 1px solid #9ab; padding: 3px 4px; font-size: 9.5px; }
            tr.grp th { background: #fff; color: #000; font-weight: bold; text-align: center; font-size: 10.5px; }
            tr.sub th { color: #b00; font-weight: bold; text-align: center; font-size: 9px; }
            td { color: #000; text-align: center; }
            td.q { text-align: center; }
            td.m { text-align: right; font-family: monospace; }
            td.b { font-weight: bold; }
            tr.cat-total td { font-weight: bold; background: #eef2fb; border-top: 2px solid #1a49b0; }
            tr.cat-total td:first-child { text-align: right; color: #1a49b0; }
            .totals { margin-top: 14px; width: 100%; border-collapse: collapse; }
            .totals td { padding: 4px 6px; font-size: 11px; font-weight: bold; border-top: 2px solid #b00; }
            .empty { text-align: center; padding: 30px; color: #666; }
            @media print { body { margin: 8px; } }
          ${DOCUMENT_TOOLBAR_CSS}
          </style>
        </head>
        <body>
          ${documentToolbar("Stock Report")}
          <div class="header">
            <div class="company-name">${header.name}</div>
            <div class="address">${header.addressLine}</div>
            <div class="title">STOCK REPORT</div>
            <div class="rule"></div>
            <div class="period">${rangeText}</div>
          </div>

          ${groupsHtml || '<div class="empty">No stock to report.</div>'}

          <table class="totals">
            <tbody>
              <tr>
                <td>Grand Total</td>
                <td>Opening ${grand.open} (${grand.openV.toFixed(2)})</td>
                <td>Purchase Return ${grand.pr}</td>
                <td>Previous Sales ${grand.prev}</td>
                <td>Sales Return ${grand.sr}</td>
                <td>Period Sales ${grand.today}</td>
                <td>Balance ${grand.bal} (${grand.balV.toFixed(2)})</td>
              </tr>
            </tbody>
          </table>

        </body>
        </html>
      `)
      printWindow.document.close()
    } catch (err: any) {
      console.error("Stock report error:", err)
      toast({
        title: "Could not build the stock report",
        description: err?.message ?? "Unexpected error.",
        variant: "destructive",
      })
    } finally {
      setStockReportBusy(false)
    }
  }

  // Export CSV - UPDATED with flexible date range in filename
  const handleExportCSV = () => {
    try {
      let dateRangeText = 'all_time'
      if (dateFilterEnabled) {
        if (!startDate && endDate) {
          dateRangeText = `upto_${endDate}`
        } else if (startDate && !endDate) {
          dateRangeText = `from_${startDate}`
        } else if (startDate && endDate) {
          dateRangeText = `${startDate}_to_${endDate}`
        }
      }

      const rows = filteredProducts.map((p) => {
        const status = getStockStatus(p)
        return [
          `"${p.productName}"`,
          `"${p.modelNumber ?? ""}"`,
          `"${p.category ?? ""}"`,
          `"${p.brand ?? ""}"`,
          `"${p.variant ?? ""}"`,
          `"${p.color ?? ""}"`,
          `"${p.supplier ?? ""}"`,
          p.costPrice ?? 0,
          p.salePrice,
          p.quantity,
          `"${status.label}"`
        ].join(',')
      })

      const header = 'Product Name,Model,Category,Brand,Variant,Color,Supplier,Cost Price,Sale Price,Quantity,Status'
      const csv = [header, ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inventory-${dateRangeText}-${new Date().toISOString().slice(0,10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      toast({
        title: "Export successful",
        description: `Exported ${rows.length} products`
      })
    } catch (err) {
      toast({
        title: "Export failed",
        description: "Could not export data",
        variant: "destructive"
      })
    }
  }

  // FIXED: Handle loading state
  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
            <p className="text-muted-foreground">Loading inventory data...</p>
          </div>
        </div>
        
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-1">
                <CardTitle className="text-sm font-medium">Loading...</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-xl font-bold">—</div>
                <p className="text-xs text-muted-foreground">Please wait...</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // FIXED: Handle error state
  if (error) {
    return (
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
            <p className="text-muted-foreground">Failed to load inventory data</p>
          </div>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">Error Loading Inventory</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <Button onClick={() => window.location.reload()} variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3"><h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1><ManagerAccessBadge mode="limited" /></div>
          <p className="text-muted-foreground">Manage your product inventory and stock levels</p>
        </div>
      </div>

      {/* Purchase-date filter, on one line. It used to be a titled card
          a hand tall that held nothing but a tick box until it was used. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <span className="flex items-center gap-1 text-sm font-medium">
            <Calendar className="h-4 w-4" />
            Purchase date
          </span>
          <>
              <Label htmlFor="start-date" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 w-40"
                placeholder="Leave empty for all"
              />
              <Label htmlFor="end-date" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 w-40"
                placeholder="Leave empty for all"
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
              <span className="text-xs text-muted-foreground">
                Showing: <span className="font-medium text-foreground">{getDateRangeDescription()}</span>
              </span>
          </>
        </CardContent>
      </Card>

      <StatStrip
        stats={[
          { label: "Products", value: filteredProducts.length },
          { label: "Units", value: totalQuantity },
          { label: "Cost value", value: `৳${totalValue.toLocaleString()}` },
          { label: "Sale value", value: `৳${totalSaleValue.toLocaleString()}`, tone: "money" },
          { label: "Low stock", value: lowStockCount, tone: "warn" },
          { label: "Out of stock", value: outOfStockCount, tone: "critical" },
        ]}
      />

      {/* Filters and Actions
          Wraps rather than shrinks: four dropdowns and three buttons do
          not fit one row on a smaller shop monitor, and squashing them
          is what made the nav unreadable before. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by barcode, name, model, brand, variant, colour…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {productNameOptions.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={modelFilter} onValueChange={setModelFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            {modelOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={variantFilter} onValueChange={setVariantFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Variant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Variants</SelectItem>
            {variantOptions.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(categoryFilter !== "all" ||
          productFilter !== "all" ||
          modelFilter !== "all" ||
          variantFilter !== "all") && (
          <Button
            variant="ghost"
            onClick={() => {
              setCategoryFilter("all")
              setProductFilter("all")
              setModelFilter("all")
              setVariantFilter("all")
            }}
          >
            Clear filters
          </Button>
        )}
        <Button variant="outline" onClick={handleExportCSV}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
        <Button onClick={handlePrintStockReport} disabled={stockReportBusy}>
          <Printer className="mr-2 h-4 w-4" />
          {stockReportBusy ? "Building…" : "Stock Report"}
        </Button>
      </div>

      {/* Products Table */}
      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>
            {`${filteredProducts.length} of ${products.length} grouped products ${startDate || endDate ? `(date filtered)` : ''}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Cost Price</TableHead>
                <TableHead>Sale Price</TableHead>
                <TableHead>Qty (Grouped)</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground">
                    No products match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map((p, idx) => {
                  const stockStatus = getStockStatus(p)
                  // The handsets in this group the search typed for.
                  const hits = p.units.filter((u) => unitMatches(u, searchKey))
                  const first = hits[0]
                  // Show whichever number actually matched.
                  const shown = first
                    ? codeMatches(first.barcode, searchKey)
                      ? { label: "Barcode", value: first.barcode }
                      : { label: "IMEI", value: first.imei ?? "" }
                    : null
                  return (
                    <TableRow
                      key={`${p.productName}|${p.modelNumber}|${p.brand}|${p.variant}|${p.color}|${idx}`}
                      className={hits.length > 0 ? HIT_ROW_CLASS : undefined}
                    >
                      <TableCell className="font-medium">
                        {p.productName}
                        {shown && (
                          <button
                            type="button"
                            onClick={() => handleViewProduct(p)}
                            title="Show this unit"
                            className="mt-1 block text-left text-xs font-normal text-muted-foreground hover:underline"
                          >
                            {shown.label}{" "}
                            <span className="font-mono text-foreground">
                              <Highlight text={shown.value} term={searchKey} />
                            </span>
                            {hits.length > 1 ? ` +${hits.length - 1} more` : ""}
                          </button>
                        )}
                      </TableCell>
                      <TableCell>{p.modelNumber ?? "—"}</TableCell>
                      <TableCell>{p.category ?? "Uncategorized"}</TableCell>
                      <TableCell>{p.brand ?? "—"}</TableCell>
                      <TableCell className="font-medium">{p.variant ?? "—"}</TableCell>
                      <TableCell>{p.color ?? "—"}</TableCell>
                      <TableCell>{p.costPrice != null ? `৳${p.costPrice.toLocaleString()}` : "—"}</TableCell>
                      <TableCell>৳{p.salePrice.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{p.quantity}</span>
                          <Badge variant={stockStatus.variant} className="text-xs">
                            {stockStatus.label}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>{p.supplier ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleViewProduct(p)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {/* Owner only. The database refuses these for
                              anyone else, so hiding them is courtesy
                              rather than the guard. */}
                          {isOwner && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Correct this product"
                                onClick={() => handleEditProduct(p)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Delete this product"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteProduct(p)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Individual units behind a grouped row. The table shows one line
          per product with a summed quantity; a shop still needs to know
          exactly which barcodes make up that number — to find a handset
          on the shelf, or check which one is already sold. */}
      <Dialog open={!!viewProduct} onOpenChange={(open) => !open && setViewProduct(null)}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {viewProduct?.productName}
              {viewProduct?.modelNumber ? ` — ${viewProduct.modelNumber}` : ""}
            </DialogTitle>
            <DialogDescription>
              {[viewProduct?.brand, viewProduct?.color, viewProduct?.category]
                .filter(Boolean)
                .join(" • ")}
              {viewProduct ? ` • ${viewProduct.units.length} unit${viewProduct.units.length === 1 ? "" : "s"}` : ""}
            </DialogDescription>
          </DialogHeader>

          {viewProduct && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 rounded-lg border p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">In stock</p>
                  <p className="font-semibold">{viewProduct.quantity}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cost price</p>
                  <p className="font-semibold">
                    {viewProduct.costPrice != null ? `৳${viewProduct.costPrice.toLocaleString()}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Sale price</p>
                  <p className="font-semibold">৳{viewProduct.salePrice.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Supplier</p>
                  <p className="font-semibold">{viewProduct.supplier ?? "—"}</p>
                </div>
              </div>

              {(() => {
                const found = viewProduct.units.filter((u) => unitMatches(u, searchKey)).length
                return found > 0 ? (
                  <p className="-mb-2 text-sm">
                    <span className="font-medium">
                      {found} unit{found === 1 ? "" : "s"}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      match{found === 1 ? "es" : ""} “{searchTerm.trim()}” — highlighted below.
                    </span>
                  </p>
                ) : null
              })()}

              <div ref={unitListRef} className="max-h-[360px] overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>IMEI</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewProduct.units.map((u, i) => {
                      const hit = unitMatches(u, searchKey)
                      return (
                      <TableRow
                        key={u.barcode || i}
                        data-search-hit={hit ? "" : undefined}
                        className={hit ? HIT_UNIT_CLASS : undefined}
                      >
                        <TableCell className={hit ? "font-semibold" : "text-muted-foreground"}>
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {u.barcode ? <Highlight text={u.barcode} term={searchKey} /> : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {u.imei ? <Highlight text={u.imei} term={searchKey} /> : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.purchaseDate ? new Date(u.purchaseDate).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {u.quantity > 0 ? (
                            <Badge variant="outline">In stock</Badge>
                          ) : (
                            <Badge variant="destructive">Sold</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Correct a product. Saves to the purchase behind it, which the
          sync trigger reads back into every stock row it created. */}
      <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Correct product</DialogTitle>
            <DialogDescription>
              {editProduct?.purchaseIds.length === 1
                ? "Applies to every unit from this purchase."
                : `Applies to all ${editProduct?.purchaseIds.length ?? 0} purchases behind this row.`}
              {" "}Stock quantity is not editable here — it moves through sales and returns.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ip-name">Product name*</Label>
              <Input
                id="ip-name"
                value={editForm.product_name}
                onChange={(e) => setEditForm((f) => ({ ...f, product_name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="ip-model">Model</Label>
              <Input
                id="ip-model"
                value={editForm.model_number}
                onChange={(e) => setEditForm((f) => ({ ...f, model_number: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="ip-brand">Brand</Label>
              <Input
                id="ip-brand"
                value={editForm.brand}
                onChange={(e) => setEditForm((f) => ({ ...f, brand: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="ip-category">Category</Label>
              <Input
                id="ip-category"
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="ip-supplier">Supplier</Label>
              <Input
                id="ip-supplier"
                value={editForm.supplier}
                onChange={(e) => setEditForm((f) => ({ ...f, supplier: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="ip-cost">Cost price</Label>
              <Input
                id="ip-cost"
                type="number"
                step="0.01"
                value={editForm.cost_price}
                onChange={(e) => setEditForm((f) => ({ ...f, cost_price: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="ip-sale">Sale price</Label>
              <Input
                id="ip-sale"
                type="number"
                step="0.01"
                value={editForm.sale_price}
                onChange={(e) => setEditForm((f) => ({ ...f, sale_price: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditProduct(null)} disabled={savingProduct}>
              Cancel
            </Button>
            <Button
              onClick={saveProductEdit}
              disabled={savingProduct || !editForm.product_name.trim()}
            >
              {savingProduct ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteProduct} onOpenChange={(open) => !open && setDeleteProduct(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Delete this product?</DialogTitle>
            <DialogDescription>
              {deleteProduct?.productName}
              {deleteProduct?.modelNumber ? ` (${deleteProduct.modelNumber})` : ""} — {deleteProduct?.quantity ?? 0}{" "}
              unit(s) and the purchase behind them will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            If any unit has already been sold, the database will refuse — correct the
            product instead, so the invoices keep pointing at something real.
          </p>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteProduct(null)}
              disabled={deletingProduct}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteProduct} disabled={deletingProduct}>
              {deletingProduct ? "Deleting…" : "Delete product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}