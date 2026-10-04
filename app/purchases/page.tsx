"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  ShoppingBag,
  Calendar,
  Building2,
  DollarSign,
  X,
  Pencil,
  Trash2,
  Printer,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  codeMatches,
  Highlight,
  HIT_UNIT_CLASS,
  searchKeyOf,
} from "@/components/search-hit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MainNav } from "@/components/main-nav";
import { UserNav } from "@/components/user-nav";
import { PurchaseVoucherForm } from "@/components/purchase-voucher-form";
import { PurchaseVouchersClient } from "@/components/purchase-vouchers-client";
import { SupplierPromosClient } from "@/components/supplier-promos-client";
import { type VoucherRow, outstandingOf } from "@/lib/purchase-voucher";
import { DateRangeFilter } from "@/components/date-range-filter";
import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
import { shopHeader } from "@/lib/utils/shop-header";
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { StatStrip } from "@/components/stat-strip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PurchaseRow = {
  id: number;
  supplier_id: string | null;
  supplier: string | null;
  voucher_id: number | null;
  // A joined relation comes back as an object for a to-one link, but is
  // typed as an array. Accept both so the cast below is honest about
  // what the query actually returns.
  suppliers: { name: string | null } | { name: string | null }[] | null;
  product_name: string | null;
  model_number: string | null;
  category: string | null;
  brand: string | null;
  cost_price: number | null;
  sale_price: number | null;
  description: string | null;
  created_at: string;
  color_variants?:
    | {
        color: string | null;
        barcode: string | null;
        imei?: string | null;
        variant: string | null;
        quantity?: number | null;
      }[]
    | null;
};

/**
 * Read the supplier's name off a joined row.
 *
 * The join arrives as an object for a to-one link but is typed as an
 * array, and which shape you get depends on how the select is written.
 * Reading the wrong one silently yields undefined, which is how raw
 * UUIDs ended up displayed where supplier names belonged.
 */
function supplierNameOf(p: { suppliers?: PurchaseRow["suppliers"] }) {
  const joined = p.suppliers;
  if (!joined) return null;
  return (Array.isArray(joined) ? joined[0]?.name : joined.name) ?? null;
}

type DisplayRow = {
  key: string;
  // Edit and delete act on the PURCHASE, not this display row: one
  // purchase produces a row per colour, and correcting the product
  // means correcting all of them at once.
  purchase_id: number;
  sale_price: number | null;
  barcode: string;
  /** Usually the same number as the barcode; kept so it can be searched. */
  imei: string | null;
  product_name: string | null;
  model_number: string | null;
  category: string | null;
  brand: string | null;
  color: string | null;
  variant: string | null;
  supplier: string | null;
  cost_price: number | null;
  /**
   * Units on this row. One for a scanned handset; the whole count for
   * counted stock, which is stored as a single row. See lineCost.
   */
  quantity: number;
  created_at: string;
  /** Which delivery it arrived on, so the report can add up the
      discount, adjustment and dues agreed for that delivery. */
  voucher_id: number | null;
};

const supabase = createClient();

/**
 * What one row of stock cost: unit cost times the units on it.
 *
 * Every total on this page used to add up cost_price per ROW. For a
 * handset that is right — one row, one unit. Counted stock is one row
 * for the whole count, so ten cables bought for 1,900 were totalled as
 * 190. Across both shops that understated purchases by more than 76,000.
 */
function lineCost(r: { cost_price: number | null; quantity: number }) {
  return (Number(r.cost_price) || 0) * (r.quantity || 1);
}

function formatBDT(n: number | null | undefined) {
  const val = typeof n === "number" ? n : 0;
  return `৳${val.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The calendar day a timestamp falls on, in the shop's own time zone,
 * as "YYYY-MM-DD" — the same shape the date inputs give back, so the
 * two compare as plain strings. Empty for a value that is not a date.
 */
function localDay(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function PurchasesPage() {
  const searchParams = useSearchParams();
  const { currentShopId, accountType, shops } = useRole();
  const { toast } = useToast();
  // Correcting or removing a purchase rewrites stock records, so it is
  // the owner's call. The database refuses it for anyone else too.
  const isOwner = accountType === "owner";
  const [activeTab, setActiveTab] = useState<
    "purchases" | "vouchers" | "promos" | "add-product"
  >("purchases");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [purchases, setPurchases] = useState<
    { id: number; supplier: string | null; created_at: string }[]
  >([]);

  // Search and filters
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [productNameFilter, setProductNameFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [variantFilter, setVariantFilter] = useState<string>("all");

  // Date range filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Owner: correcting and removing a purchase
  const [editRow, setEditRow] = useState<DisplayRow | null>(null);
  const [editForm, setEditForm] = useState({
    product_name: "",
    model_number: "",
    category: "",
    brand: "",
    supplier: "",
    cost_price: "",
    sale_price: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<DisplayRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const openEdit = (r: DisplayRow) => {
    setEditRow(r);
    setEditForm({
      product_name: r.product_name ?? "",
      model_number: r.model_number ?? "",
      category: r.category ?? "",
      brand: r.brand ?? "",
      supplier: r.supplier ?? "",
      cost_price: r.cost_price != null ? String(r.cost_price) : "",
      sale_price: r.sale_price != null ? String(r.sale_price) : "",
    });
  };

  /**
   * Save a correction.
   *
   * Goes to the PURCHASE, not to the stock rows. sync_inventory_from_purchase
   * then pushes the change into every inventory row it created, so the
   * product reads the same on Purchases, Inventory and the till. Writing
   * to inventory directly would leave the purchase disagreeing with it,
   * and the next sync would put the old values back.
   */
  const saveEdit = async () => {
    if (!editRow || !currentShopId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("update_purchase", {
        p_organization_id: currentShopId,
        p_purchase_id: editRow.purchase_id,
        p_fields: {
          product_name: editForm.product_name.trim(),
          model_number: editForm.model_number.trim(),
          category: editForm.category.trim(),
          brand: editForm.brand.trim(),
          supplier: editForm.supplier.trim(),
          cost_price:
            editForm.cost_price === "" ? null : Number(editForm.cost_price),
          sale_price:
            editForm.sale_price === "" ? null : Number(editForm.sale_price),
        },
      });
      if (error) throw error;
      // The function reports a refusal in its result rather than
      // raising, so ignoring this would show"saved" on a save that
      // the database declined.
      if (!data?.success) {
        toast({
          title: "Not saved",
          description: data?.message ?? "The purchase could not be updated.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Purchase updated",
        description: "Stock records were updated to match.",
      });
      setEditRow(null);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not save.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow || !currentShopId) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc("delete_purchase", {
        p_organization_id: currentShopId,
        p_purchase_id: deleteRow.purchase_id,
      });
      if (error) throw error;
      if (!data?.success) {
        toast({
          title: "Not deleted",
          description: data?.message ?? "The purchase could not be deleted.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Purchase deleted",
        description: `${data.stock_removed ?? 0} stock record(s) removed with it.`,
      });
      setDeleteRow(null);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not delete.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  // open add-product via header button or ?tab=add-product
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "add-product") setActiveTab("add-product");
  }, [searchParams]);

  // fetch ALL purchases with nested color_variants, paginated (uses cost_price)
  useEffect(() => {
    let mounted = true;

    async function fetchAllPurchases() {
      setLoading(true);
      setError(null);

      const pageSize = 1000;
      let from = 0;
      let all: PurchaseRow[] = [];

      // voucher_id arrives with script 66. The app updates independently
      // of the database, so a till on the new build against an older
      // database must still be able to list its stock — asking for a
      // column that is not there is a hard failure, and this is the main
      // Purchases table, not a corner of it.
      let withVoucher = true;

      const columns = (voucher: boolean) => `
          id,
          supplier_id,
          supplier,
          ${voucher ? "voucher_id," : ""}
          suppliers(name),
          product_name,
          model_number,
          category,
          brand,
          cost_price,
          sale_price,
          description,
          created_at,
          color_variants(color, barcode, imei, variant, quantity)
        `;

      while (true) {
        let { data, error } = await supabase
          .from("purchases")
          .select(columns(withVoucher))
          .eq("organization_id", currentShopId)
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1);

        if (
          error &&
          withVoucher &&
          (error.code === "42703" ||
            error.code === "PGRST204" ||
            /voucher_id/i.test(error.message ?? ""))
        ) {
          withVoucher = false;
          ({ data, error } = await supabase
            .from("purchases")
            .select(columns(false))
            .eq("organization_id", currentShopId)
            .order("created_at", { ascending: false })
            .range(from, from + pageSize - 1));
        }

        if (error) {
          if (mounted) setError(error.message);
          break;
        }

        all = all.concat((data ?? []) as unknown as PurchaseRow[]);
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }

      if (!mounted) return;

      // summary cards base
      setPurchases(
        all.map((p) => ({
          id: p.id,
          supplier: p.supplier ?? null,
          created_at: p.created_at,
        })),
      );

      // table rows (one per color; if no variant, a single row with color"—")
      const flattened: DisplayRow[] = all.flatMap((p) => {
        const base = {
          product_name: p.product_name ?? null,
          model_number: p.model_number ?? null,
          category: p.category ?? null,
          brand: p.brand ?? null,
          supplier: supplierNameOf(p) ?? p.supplier ?? null,
          cost_price: p.cost_price != null ? Number(p.cost_price) : null,
          sale_price: p.sale_price != null ? Number(p.sale_price) : null,
          created_at: p.created_at,
          voucher_id: p.voucher_id ?? null,
        };
        const colors = p.color_variants ?? [];
        if (colors.length === 0) {
          return [
            {
              key: `p-${p.id}-none`,
              purchase_id: p.id,
              ...base,
              color: null,
              variant: null,
              barcode: "",
              imei: null,
              quantity: 1,
            },
          ];
        }
        return colors.map((cv, idx) => ({
          key: `p-${p.id}-${idx}`,
          purchase_id: p.id,
          ...base,
          color: cv.color ?? null,
          variant: cv.variant ?? null,
          barcode: cv.barcode ?? "",
          imei: cv.imei ?? null,
          quantity: Math.max(1, Number(cv.quantity) || 1),
        }));
      });

      setRows(flattened);
      setLoading(false);
    }

    fetchAllPurchases();
    return () => {
      mounted = false;
    };
  }, [currentShopId, reloadKey]);

  // ------------------------------------------------------------------
  // What the printed report closes with
  //
  // A purchase report that stops at the cost of the goods is only half
  // the story: the shop also agreed a discount, added carriage, sent
  // some of it back, and still owes for part of it. Those live on the
  // voucher and on the returns, so both are read once here and summed
  // for whatever the report is showing.
  // ------------------------------------------------------------------
  const [vouchers, setVouchers] = useState<Map<number, VoucherRow>>(new Map());
  const [returns, setReturns] = useState<
    { return_date: string; qty: number; amount: number }[]
  >([]);

  useEffect(() => {
    if (!currentShopId) return;
    let alive = true;

    (async () => {
      const [{ data: vs }, { data: rs }] = await Promise.all([
        supabase
          .from("purchase_vouchers")
          .select(
            "id, voucher_no, voucher_date, supplier, supplier_id, total_quantity, net_amount, discount, adjustment, party_amount, paid_amount, due_amount, due_settled, remarks",
          )
          .eq("organization_id", currentShopId)
          .is("deleted_at", null),
        supabase
          .from("purchase_returns")
          .select(
            "return_date, total_credit_amount, purchase_return_items(return_quantity, deleted_at)",
          )
          .eq("organization_id", currentShopId)
          .is("deleted_at", null),
      ]);

      if (!alive) return;

      setVouchers(
        new Map(((vs ?? []) as VoucherRow[]).map((v) => [v.id, v])),
      );

      setReturns(
        ((rs ?? []) as any[]).map((r) => ({
          return_date: r.return_date,
          qty: (r.purchase_return_items ?? [])
            .filter((i: any) => !i.deleted_at)
            .reduce((sum: number, i: any) => sum + (Number(i.return_quantity) || 0), 0),
          amount: Number(r.total_credit_amount) || 0,
        })),
      );
    })();

    return () => {
      alive = false;
    };
  }, [currentShopId, reloadKey]);

  /** The search as matching sees it, for marking the handset it found. */
  const searchKey = searchKeyOf(query);

  type FilterKey = "category" | "product" | "model" | "brand" | "supplier" | "variant";

  /**
   * Whether a row passes every filter, optionally ignoring one.
   *
   * `skip` is what makes the boxes narrow each other: each list offers
   * only the values still reachable under the OTHER choices, so picking
   * Accessories leaves Products showing accessories, not every product
   * the shop has ever bought.
   */
  const passes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (r: DisplayRow, skip?: FilterKey) => {
      // Compared as calendar days in the shop's own time, not as
      // instants. new Date("2026-09-20") is MIDNIGHT UTC, so "To 20 Sep"
      // used to stop at the first second of the 20th and drop everything
      // bought during it — the same date in From and To showed nothing.
      // And created_at is UTC while Bangladesh is six hours ahead, so a
      // purchase at 2am on the 20th was filed under the 19th.
      const day = localDay(r.created_at);
      if (!day) return false;
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;

      if (skip !== "category" && categoryFilter !== "all" && (r.category ?? "") !== categoryFilter)
        return false;
      if (skip !== "product" && productNameFilter !== "all" && (r.product_name ?? "") !== productNameFilter)
        return false;
      if (skip !== "model" && modelFilter !== "all" && (r.model_number ?? "").trim() !== modelFilter)
        return false;
      if (skip !== "brand" && brandFilter !== "all" && (r.brand ?? "") !== brandFilter)
        return false;
      if (skip !== "supplier" && supplierFilter !== "all" && (r.supplier ?? "") !== supplierFilter)
        return false;
      if (skip !== "variant" && variantFilter !== "all" && (r.variant ?? "") !== variantFilter)
        return false;

      if (!q) return true;
      const haystack =
        `${r.barcode ?? ""} ${r.imei ?? ""} ${r.product_name ?? ""} ${r.model_number ?? ""} ${r.category ?? ""} ${r.brand ?? ""} ${r.variant ?? ""} ${r.color ?? ""} ${r.supplier ?? ""}`.toLowerCase();
      return haystack.includes(q);
    };
  }, [
    query,
    categoryFilter,
    productNameFilter,
    modelFilter,
    brandFilter,
    supplierFilter,
    variantFilter,
    startDate,
    endDate,
  ]);

  /** The values of one column still reachable under the other filters. */
  const optionsFor = (skip: FilterKey, pick: (r: DisplayRow) => string | null) =>
    Array.from(
      new Set(
        rows
          .filter((r) => passes(r, skip))
          .map((r) => (pick(r) ?? "").trim())
          .filter(Boolean),
      ),
    ).sort();

  // filter option lists
  const categories = useMemo(
    () => ["All Categories", ...optionsFor("category", (r) => r.category)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, passes],
  );
  const productNames = useMemo(
    () => ["All Products", ...optionsFor("product", (r) => r.product_name)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, passes],
  );
  const models = useMemo(
    () => optionsFor("model", (r) => r.model_number),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, passes],
  );
  const brands = useMemo(
    () => ["All Brands", ...optionsFor("brand", (r) => r.brand)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, passes],
  );
  const suppliers = useMemo(
    () => ["All Suppliers", ...optionsFor("supplier", (r) => r.supplier)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, passes],
  );
  const variants = useMemo(
    () => ["All Variants", ...optionsFor("variant", (r) => r.variant)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, passes],
  );

  // apply filters + search + date range
  const filtered = useMemo(() => rows.filter((r) => passes(r)), [rows, passes]);

  // summary cards

  /**
   * How many purchases the filtered rows came from.
   *
   * This used to build the set from `r.key.split("-")` — which returns
   * an ARRAY, and every array is a different object, so nothing ever
   * deduplicated and the figure was really a row count wearing the
   * "Purchases" label. A delivery of one model in six colours reported
   * as six purchases.
   */
  const totalPurchases = useMemo(
    () => new Set(filtered.map((r) => r.purchase_id)).size,
    [filtered],
  );

  /**
   * How many physical units those purchases brought in.
   *
   * Sits next to the purchase count because they answer different
   * questions and the shop needs both: this is the figure that should
   * agree with Units on the Inventory screen, once anything sold is
   * taken off.
   */
  // Units, not rows. Ten cables are one row and ten units.
  const totalUnits = useMemo(
    () => filtered.reduce((sum, r) => sum + r.quantity, 0),
    [filtered],
  );

  // Total purchase value from filtered rows
  const totalPurchaseValue = useMemo(() => {
    return filtered.reduce((sum, r) => sum + lineCost(r), 0);
  }, [filtered]);

  const thisMonthPurchases = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return purchases.filter((p) => {
      const d = new Date(p.created_at);
      return d.getFullYear() === y && d.getMonth() === m;
    }).length;
  }, [purchases]);

  /**
   * Counted from the filtered rows, like everything else on the strip.
   *
   * It used to count every supplier the shop has ever used, whatever
   * was on screen — so filtering to one category left three of the four
   * figures following the filter and this one reporting the whole shop.
   */
  const totalSuppliers = useMemo(() => {
    const s = new Set(
      filtered.map((r) => (r.supplier ?? "").trim()).filter(Boolean),
    );
    return s.size;
  }, [filtered]);

  /**
   * Print the purchase list exactly as it is filtered on screen.
   *
   * Uses the shared document toolbar, so this report gets the same
   * Print and Download PDF buttons as every other one rather than a
   * second, slightly different implementation.
   */
  const handlePrintPurchases = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Print window did not open",
        description: "Allow pop-ups for this application, then try again.",
        variant: "destructive",
      });
      return;
    }

    const shopInfo = shopHeader(shops.find((sh) => sh.id === currentShopId));

    let period = "All dates";
    if (startDate && endDate) {
      period = `${new Date(startDate).toLocaleDateString("en-GB")} to ${new Date(endDate).toLocaleDateString("en-GB")}`;
    } else if (startDate) {
      period = `From ${new Date(startDate).toLocaleDateString("en-GB")}`;
    } else if (endDate) {
      period = `Up to ${new Date(endDate).toLocaleDateString("en-GB")}`;
    }

    const activeBits = [
      categoryFilter !== "all" ? `Category: ${categoryFilter}` : "",
      productNameFilter !== "all" ? `Product: ${productNameFilter}` : "",
      modelFilter !== "all" ? `Model: ${modelFilter}` : "",
      brandFilter !== "all" ? `Brand: ${brandFilter}` : "",
      supplierFilter !== "all" ? `Supplier: ${supplierFilter}` : "",
      variantFilter !== "all" ? `Variant: ${variantFilter}` : "",
      query ? `Search:"${query}"` : "",
    ]
      .filter(Boolean)
      .join(" •");

    const totalCost = filtered.reduce((sum, r) => sum + lineCost(r), 0);

    // ---- What the vouchers behind these purchases agreed
    //
    // Counted once per voucher, however many of its products the
    // filters left on screen. A voucher's discount was agreed for the
    // whole delivery and cannot be split across its lines, so a
    // report narrowed to one category still shows the discount of
    // every voucher it touched — which is why the block below says
    // how many vouchers that is.
    const touched = new Map<number, VoucherRow>();
    for (const r of filtered) {
      if (r.voucher_id == null) continue;
      const v = vouchers.get(r.voucher_id);
      if (v) touched.set(v.id, v);
    }
    const voucherList = Array.from(touched.values());
    const totalDiscount = voucherList.reduce((s, v) => s + (Number(v.discount) || 0), 0);
    const totalAdjustment = voucherList.reduce(
      (s, v) => s + (Number(v.adjustment) || 0),
      0,
    );
    const totalDues = voucherList.reduce((s, v) => s + outstandingOf(v), 0);

    // ---- Returns to the supplier over the same period
    const periodReturns = returns.filter((r) => {
      if (startDate && r.return_date < startDate) return false;
      if (endDate && r.return_date > endDate) return false;
      return true;
    });
    const returnQty = periodReturns.reduce((s, r) => s + r.qty, 0);
    const returnAmount = periodReturns.reduce((s, r) => s + r.amount, 0);

    const actualTotal =
      totalCost - returnAmount - totalDiscount + totalAdjustment;

    // ---- Grouped by category, the way the sales report is
    const groups = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const key = (r.category ?? "").trim() || "Uncategorised";
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }

    const groupedRows = Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, list]) => {
        const groupTotal = list.reduce((sum, r) => sum + lineCost(r), 0);
        return `
          <tr class="group-head"><td colspan="10">${category}</td></tr>
          ${list
            .map(
              (r) => `
            <tr>
              <td>${r.product_name ?? "-"}</td>
              <td>${r.brand ?? "-"}</td>
              <td>${r.category ?? "-"}</td>
              <td>${r.model_number ?? "-"}</td>
              <td>${r.variant ?? "-"}</td>
              <td>${r.color ?? "-"}</td>
              <td>${r.barcode || "-"}</td>
              <td>${r.supplier ?? "-"}</td>
              <td class="amount-cell">${formatBDT(r.cost_price)}</td>
              <td>${new Date(r.created_at).toLocaleDateString("en-GB")}</td>
            </tr>`,
            )
            .join("")}
          <tr class="group-total">
            <td colspan="8">Group Total — ${category} (${list.length} item${
              list.length === 1 ? "" : "s"
            })</td>
            <td class="amount-cell">${formatBDT(groupTotal)}</td>
            <td></td>
          </tr>`;
      })
      .join("");

    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Purchase Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 15px; font-size: 12px; }
          .header { text-align: center; margin-bottom: 20px; }
          .company-name { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
          .title { font-size: 16px; font-weight: bold; margin: 8px 0 4px; }
          .period { font-size: 12px; }
          .filters { font-size: 11px; color: #666; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin: 18px 0; border: 2px solid black; }
          th, td { border: 1px solid black; padding: 6px; text-align: left; font-size: 11px; }
          th { background-color: #f0f0f0; font-weight: bold; text-align: center; }
          .amount-cell { text-align: right; font-family: monospace; }
          .total-row { font-weight: bold; background-color: #f0f0f0; }
          .group-head td { background-color: #e8e8e8; font-weight: bold; }
          .group-total td { background-color: #f6f6f6; font-weight: bold; }
          .totals { width: 380px; margin-left: auto; border: none; }
          .totals td { border: none; padding: 3px 6px; font-size: 12px; }
          .totals td.amount-cell { font-weight: bold; }
          .totals tr.rule td { border-top: 1px solid black; }
          .totals tr.grand td { border-top: 2px solid black; font-size: 13px; font-weight: bold; }
          .totals .hint { font-size: 10px; color: #666; font-weight: normal; }
          @media print { body { margin: 10px; } }
        ${DOCUMENT_TOOLBAR_CSS}
        </style>
      </head>
      <body>
        ${documentToolbar("Purchase Report")}
        <div class="header">
          <div class="company-name">${shopInfo.name}</div>
          <div class="address">${shopInfo.addressLine}</div>
          <div class="title">Purchase Report</div>
          <div class="period">Period: ${period}</div>
          ${activeBits ? `<div class="filters">${activeBits}</div>` : ""}
        </div>

        <table>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Brand</th>
              <th>Category</th>
              <th>Model</th>
              <th>Variant</th>
              <th>Color</th>
              <th>Barcode</th>
              <th>Supplier</th>
              <th>Cost Price</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${groupedRows}
            <tr class="total-row">
              <td colspan="8">GRAND TOTAL (${filtered.length} item${filtered.length === 1 ? "" : "s"})</td>
              <td class="amount-cell">${formatBDT(totalCost)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <table class="totals">
          <tr><td>Grand Total</td><td class="amount-cell">${formatBDT(totalCost)}</td></tr>
          <tr>
            <td>Purchase Return (-) <span class="hint">${returnQty} unit${returnQty === 1 ? "" : "s"}</span></td>
            <td class="amount-cell">${formatBDT(returnAmount)}</td>
          </tr>
          <tr><td>Total Discount (-)</td><td class="amount-cell">${formatBDT(totalDiscount)}</td></tr>
          <tr><td>Adjustment Total</td><td class="amount-cell">${formatBDT(totalAdjustment)}</td></tr>
          <tr class="rule">
            <td>Total Dues (-) <span class="hint">across ${voucherList.length} voucher${voucherList.length === 1 ? "" : "s"}</span></td>
            <td class="amount-cell">${formatBDT(totalDues)}</td>
          </tr>
          <tr class="grand"><td>Actual Total</td><td class="amount-cell">${formatBDT(actualTotal)}</td></tr>
        </table>

        <div style="margin-top: 24px; text-align: center; font-size: 11px; color: #666;">
          Generated on ${new Date().toLocaleString("en-GB")}
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(content);
    printWindow.document.close();
  };

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setQuery("");
    setCategoryFilter("all");
    setProductNameFilter("all");
    setModelFilter("all");
    setBrandFilter("all");
    setSupplierFilter("all");
  };

  const hasActiveFilters =
    startDate ||
    endDate ||
    query ||
    categoryFilter !== "all" ||
    productNameFilter !== "all" ||
    modelFilter !== "all" ||
    brandFilter !== "all" ||
    supplierFilter !== "all";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-40">
        <div className="flex h-16 items-center gap-3 px-4">
          {/* The nav takes whatever is left and shrinks into it. The
              old three-column grid gave it its natural width and let it
              overflow, so on a narrower monitor the last destinations
              were simply cut off the end. */}
          <MainNav className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">
            Purchase Management
          </h2>
          {/* single Add Product button */}
          <Button onClick={() => setActiveTab("add-product")}>
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>

        <StatStrip
          stats={[
            { label: "Purchases", value: loading ? "—" : totalPurchases },
            { label: "Units", value: loading ? "—" : totalUnits },
            {
              label: "Purchase value",
              value: loading ? "—" : formatBDT(totalPurchaseValue),
              tone: "money",
            },
            { label: "Suppliers", value: loading ? "—" : totalSuppliers },
          ]}
        />

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="purchases">Purchases</TabsTrigger>
            {/* The same stock, grouped the way it arrived: one
                supplier's delivery, one agreed amount, one balance. */}
            <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
            {/* The discounts a supplier funds, and what they still owe
                for them. Here rather than under Sales because it is
                money between the shop and its supplier. */}
            <TabsTrigger value="promos">Promos</TabsTrigger>
            {/* no"Add Product" tab trigger; use the header button only */}
          </TabsList>

          {/* Purchases table with Supplier + Cost Price */}
          <TabsContent value="purchases" className="space-y-4">
            <div className="flex flex-col gap-4">
              {/* The shared control, as used on Sales, Expenses, Income
                  and Bank Info — labelled dates with Today and Clear,
                  rather than this page's own bare inputs. */}
              <div className="flex flex-wrap items-end gap-3">
                <DateRangeFilter
                  idPrefix="purchases"
                  startDate={startDate}
                  endDate={endDate}
                  onStartChange={setStartDate}
                  onEndChange={setEndDate}
                  showSummary={false}
                />
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    <X className="mr-2 h-4 w-4" />
                    Clear Filters
                  </Button>
                )}
                {/* Prints exactly what is filtered on screen, so the
                    paper matches what the shop is looking at. */}
                <Button
                  size="sm"
                  onClick={handlePrintPurchases}
                  disabled={filtered.length === 0}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print Report
                </Button>
              </div>

              {/* Search and Filter Controls */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search products, brand, variant, category, supplier…"
                      className="pl-8 w-[220px] lg:w-[320px]"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>

                  <Select
                    value={categoryFilter}
                    onValueChange={(v) => setCategoryFilter(v)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories
                        .filter((c) => c !== "All Categories")
                        .map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {/* Between Categories and Brands, as the shop asked:
                      they narrow by what the product IS before whose
                      brand it is. */}
                  <Select
                    value={productNameFilter}
                    onValueChange={(v) => {
                      setProductNameFilter(v);
                      // The model chosen belonged to the old product.
                      setModelFilter("all");
                    }}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Product Name" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Products</SelectItem>
                      {productNames
                        .filter((n) => n !== "All Products")
                        .map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={modelFilter}
                    onValueChange={(v) => setModelFilter(v)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Models</SelectItem>
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={brandFilter}
                    onValueChange={(v) => setBrandFilter(v)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Brand" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Brands</SelectItem>
                      {brands
                        .filter((b) => b !== "All Brands")
                        .map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={supplierFilter}
                    onValueChange={(v) => setSupplierFilter(v)}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Suppliers</SelectItem>
                      {suppliers
                        .filter((s) => s !== "All Suppliers")
                        .map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {/* Built from what is actually in stock rather than a
                      fixed list, since every shop stocks its own set of
                      configurations. */}
                  <Select
                    value={variantFilter}
                    onValueChange={(v) => setVariantFilter(v)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Variant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Variants</SelectItem>
                      {variants
                        .filter((v) => v !== "All Variants")
                        .map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Card>
              <CardContent className="p-0">
                {error ? (
                  <div className="p-6 text-sm text-red-600">
                    Failed to load purchases: {error}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product Name</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead>Color</TableHead>
                        <TableHead>Barcode</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Cost Price</TableHead>
                        <TableHead>Date</TableHead>
                        {isOwner && (
                          <TableHead className="text-right">Actions</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell
                            colSpan={isOwner ? 11 : 10}
                            className="p-6 text-sm text-muted-foreground"
                          >
                            Loading products…
                          </TableCell>
                        </TableRow>
                      ) : filtered.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={isOwner ? 11 : 10}
                            className="p-6 text-sm text-muted-foreground"
                          >
                            No products found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((r) => {
                          // The handset the search typed for, by barcode or IMEI.
                          const barcodeHit = codeMatches(r.barcode, searchKey);
                          const imeiHit = !barcodeHit && codeMatches(r.imei, searchKey);
                          return (
                          <TableRow
                            key={r.key}
                            className={barcodeHit || imeiHit ? HIT_UNIT_CLASS : undefined}
                          >
                            <TableCell className="font-medium">
                              {r.product_name ?? "—"}
                            </TableCell>
                            <TableCell>{r.brand ?? "—"}</TableCell>
                            <TableCell>{r.category ?? "—"}</TableCell>
                            <TableCell>{r.model_number ?? "—"}</TableCell>
                            <TableCell className="font-medium">
                              {r.variant ?? "—"}
                            </TableCell>
                            <TableCell>{r.color ?? "—"}</TableCell>
                            <TableCell>
                              {r.barcode ? <Highlight text={r.barcode} term={searchKey} /> : "—"}
                              {imeiHit && r.imei && (
                                <div className="text-xs text-muted-foreground">
                                  IMEI <Highlight text={r.imei} term={searchKey} />
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{r.supplier ?? "—"}</TableCell>
                            <TableCell>{formatBDT(r.cost_price)}</TableCell>
                            <TableCell>
                              {new Date(r.created_at).toLocaleDateString(
                                "en-GB",
                              )}
                            </TableCell>
                            {/* Owner only. Managers never see these —
                                and the database refuses them anyway,
                                so a hidden button is not the guard. */}
                            {isOwner && (
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Correct this purchase"
                                    onClick={() => openEdit(r)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Delete this purchase"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setDeleteRow(r)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Hidden Add Product content (opened via header button) */}
          <TabsContent value="vouchers" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Purchase Vouchers</CardTitle>
              </CardHeader>
              <CardContent>
                <PurchaseVouchersClient />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="promos" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Supplier Promos</CardTitle>
              </CardHeader>
              <CardContent>
                <SupplierPromosClient />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="add-product" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Purchase Voucher</CardTitle>
              </CardHeader>
              <CardContent>
                {/* The one-product form this replaced is still in
                    components/add-product-form.tsx. Swapping back is a
                    one-line change if the counter finds anything
                    missing here. */}
                <PurchaseVoucherForm />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Correct a purchase. Owner only — and the database checks it
          again, so this dialog is convenience, not the guard. */}
      <Dialog
        open={!!editRow}
        onOpenChange={(open) => !open && setEditRow(null)}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Correct purchase</DialogTitle>
            <DialogDescription>
              Changes apply to every unit from this purchase, and update the
              stock records with it. Quantities are not editable here — those
              move through sales and returns.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ep-name">Product name*</Label>
              <Input
                id="ep-name"
                value={editForm.product_name}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, product_name: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ep-model">Model</Label>
              <Input
                id="ep-model"
                value={editForm.model_number}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, model_number: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ep-brand">Brand</Label>
              <Input
                id="ep-brand"
                value={editForm.brand}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, brand: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ep-category">Category</Label>
              <Input
                id="ep-category"
                value={editForm.category}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, category: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ep-supplier">Supplier</Label>
              <Input
                id="ep-supplier"
                value={editForm.supplier}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, supplier: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ep-cost">Cost price</Label>
              <Input
                id="ep-cost"
                type="number"
                step="0.01"
                value={editForm.cost_price}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, cost_price: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ep-sale">Sale price</Label>
              <Input
                id="ep-sale"
                type="number"
                step="0.01"
                value={editForm.sale_price}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, sale_price: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setEditRow(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={saving || !editForm.product_name.trim()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deleting takes the stock with it, so say so before it happens
          rather than after. */}
      <Dialog
        open={!!deleteRow}
        onOpenChange={(open) => !open && setDeleteRow(null)}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Delete this purchase?</DialogTitle>
            <DialogDescription>
              {deleteRow?.product_name ?? "This product"}
              {deleteRow?.model_number
                ? ` (${deleteRow.model_number})`
                : ""}{" "}
              and the stock it created will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            If any unit from this purchase has already been sold, the database
            will refuse — correct the purchase instead, so the invoices keep
            pointing at something real.
          </p>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteRow(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
