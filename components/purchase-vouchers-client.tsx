"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Printer, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateRangeFilter } from "@/components/date-range-filter";
import { StatStrip } from "@/components/stat-strip";
import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
import { useToast } from "@/hooks/use-toast";
import { shopHeader } from "@/lib/utils/shop-header";
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt";
import {
  type VoucherItem,
  type VoucherPayment,
  type VoucherRow,
  loadVoucherItems,
  loadVoucherPayments,
  money,
  outstandingOf,
  paidOf,
  printVoucher,
} from "@/lib/purchase-voucher";

const supabase = createClient();

/**
 * Every delivery the shop has taken in, as a voucher.
 *
 * A delivery arrives on one supplier's invoice for one agreed amount,
 * and that is the unit the shop argues about later: "what was on the
 * voucher of the 12th, and have we paid it?". Purchases were stored as
 * a flat list of products with no such grouping, so the question could
 * not be asked at all.
 *
 * Searching is by voucher number and by date range, because those are
 * the two things written on the paper in the manager's hand.
 */
export function PurchaseVouchersClient() {
  const { currentShopId, shops } = useRole();
  const { toast } = useToast();

  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "due" | "paid">("all");

  // ---- The voucher being looked at
  const [openVoucher, setOpenVoucher] = useState<VoucherRow | null>(null);
  const [items, setItems] = useState<VoucherItem[]>([]);
  const [payments, setPayments] = useState<VoucherPayment[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const shop = useMemo(
    () => shops.find((s) => s.id === currentShopId),
    [shops, currentShopId],
  );

  const load = useCallback(async () => {
    if (!currentShopId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("purchase_vouchers")
        .select(
          "id, voucher_no, voucher_date, supplier, supplier_id, total_quantity, net_amount, discount, adjustment, party_amount, paid_amount, due_amount, due_settled, remarks, created_at",
        )
        .eq("organization_id", currentShopId)
        .is("deleted_at", null)
        .order("voucher_date", { ascending: false })
        .order("id", { ascending: false });

      if (error) throw error;
      setRows((data ?? []) as VoucherRow[]);
    } catch (err: any) {
      console.error("Could not load vouchers:", err);
      toast({
        title: "Could not load vouchers",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [currentShopId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Whether a voucher passes the filters, optionally ignoring the
   * supplier one -- which is how the Supplier list offers only those the
   * dates, search and status still leave (choose "Unpaid only" and only
   * suppliers still owed appear).
   */
  const passes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (r: VoucherRow, skipSupplier = false) => {
      // voucher_date is a plain date, so string comparison is both
      // correct and free of timezone drift.
      if (startDate && r.voucher_date < startDate) return false;
      if (endDate && r.voucher_date > endDate) return false;

      if (!skipSupplier && supplierFilter !== "all" && (r.supplier ?? "") !== supplierFilter) {
        return false;
      }

      const left = outstandingOf(r);
      if (statusFilter === "due" && left <= 0) return false;
      if (statusFilter === "paid" && left > 0) return false;

      if (!q) return true;
      return `${r.voucher_no} ${r.supplier ?? ""} ${r.remarks ?? ""}`
        .toLowerCase()
        .includes(q);
    };
  }, [startDate, endDate, query, supplierFilter, statusFilter]);

  const suppliers = useMemo(() => {
    const set = new Set(
      rows
        .filter((r) => passes(r, true))
        .map((r) => (r.supplier ?? "").trim())
        .filter(Boolean),
    );
    return Array.from(set).sort();
  }, [rows, passes]);

  const filtered = useMemo(() => rows.filter((r) => passes(r)), [rows, passes]);

  const summary = useMemo(() => {
    let net = 0;
    let party = 0;
    let paid = 0;
    let due = 0;
    let qty = 0;
    for (const r of filtered) {
      net += Number(r.net_amount) || 0;
      party += Number(r.party_amount) || 0;
      paid += paidOf(r);
      due += outstandingOf(r);
      qty += Number(r.total_quantity) || 0;
    }
    return { net, party, paid, due, qty };
  }, [filtered]);

  const openDetail = async (voucher: VoucherRow) => {
    setOpenVoucher(voucher);
    setItems([]);
    setPayments([]);
    setItemsLoading(true);
    try {
      const [lines, paid] = await Promise.all([
        loadVoucherItems(supabase, currentShopId!, voucher.id),
        loadVoucherPayments(supabase, currentShopId!, voucher.id),
      ]);
      setItems(lines);
      setPayments(paid);
    } catch (err: any) {
      console.error("Could not load voucher items:", err);
      toast({
        title: "Could not load the products",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setItemsLoading(false);
    }
  };

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setQuery("");
    setSupplierFilter("all");
    setStatusFilter("all");
  };

  const hasFilters =
    startDate || endDate || query || supplierFilter !== "all" || statusFilter !== "all";

  /**
   * The voucher list on paper.
   *
   * Grouped by supplier with a group total, then the whole-report
   * block underneath — the same shape as the sales report, because it
   * is the same question asked of the other side of the counter.
   */
  const printList = () => {
    const win = window.open("", "_blank", "width=1000,height=700");
    if (!win) {
      toast({
        title: "Print window did not open",
        description: "Allow pop-ups for this application, then try again.",
        variant: "destructive",
      });
      return;
    }

    const esc = (v: unknown) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const info = shopHeader(shop);

    const groups = new Map<string, VoucherRow[]>();
    for (const r of filtered) {
      const key = (r.supplier ?? "").trim() || "(no supplier)";
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }

    let period = "All dates";
    if (startDate && endDate) {
      period = `${new Date(startDate).toLocaleDateString("en-GB")} to ${new Date(
        endDate,
      ).toLocaleDateString("en-GB")}`;
    } else if (startDate) {
      period = `From ${new Date(startDate).toLocaleDateString("en-GB")}`;
    } else if (endDate) {
      period = `Up to ${new Date(endDate).toLocaleDateString("en-GB")}`;
    }

    const totalDiscount = filtered.reduce((s, r) => s + (Number(r.discount) || 0), 0);
    const totalAdjustment = filtered.reduce(
      (s, r) => s + (Number(r.adjustment) || 0),
      0,
    );

    const body = Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([supplier, list]) => {
        const gQty = list.reduce((s, r) => s + (Number(r.total_quantity) || 0), 0);
        const gNet = list.reduce((s, r) => s + (Number(r.net_amount) || 0), 0);
        const gParty = list.reduce((s, r) => s + (Number(r.party_amount) || 0), 0);
        const gPaid = list.reduce((s, r) => s + paidOf(r), 0);
        const gDue = list.reduce((s, r) => s + outstandingOf(r), 0);

        return `
          <tr class="group-head"><td colspan="8">${esc(supplier)}</td></tr>
          ${list
            .map(
              (r) => `
            <tr>
              <td>${esc(r.voucher_no)}</td>
              <td>${new Date(r.voucher_date).toLocaleDateString("en-GB")}</td>
              <td class="num">${Number(r.total_quantity) || 0}</td>
              <td class="num">${money(r.net_amount)}</td>
              <td class="num">${money(r.discount)}</td>
              <td class="num">${money(r.party_amount)}</td>
              <td class="num">${money(paidOf(r))}</td>
              <td class="num">${money(outstandingOf(r))}</td>
            </tr>`,
            )
            .join("")}
          <tr class="group-total">
            <td colspan="2">Group Total — ${esc(supplier)} (${list.length} voucher${
              list.length === 1 ? "" : "s"
            })</td>
            <td class="num">${gQty}</td>
            <td class="num">${money(gNet)}</td>
            <td class="num">${money(
              list.reduce((s, r) => s + (Number(r.discount) || 0), 0),
            )}</td>
            <td class="num">${money(gParty)}</td>
            <td class="num">${money(gPaid)}</td>
            <td class="num">${money(gDue)}</td>
          </tr>`;
      })
      .join("");

    win.document.write(`<!DOCTYPE html><html><head>
      <title>Purchase Voucher Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 15px; font-size: 12px; }
        .header { text-align: center; margin-bottom: 16px; }
        .company-name { font-size: 18px; font-weight: bold; }
        .title { font-size: 16px; font-weight: bold; margin: 8px 0 4px; }
        table { width: 100%; border-collapse: collapse; margin: 14px 0; border: 2px solid #000; }
        th, td { border: 1px solid #000; padding: 5px; font-size: 11px; }
        th { background: #f0f0f0; text-align: center; }
        .num { text-align: right; font-family: monospace; }
        .group-head td { background: #e8e8e8; font-weight: bold; }
        .group-total td { background: #f6f6f6; font-weight: bold; }
        .totals { width: 360px; margin-left: auto; border-collapse: collapse; }
        .totals td { border: none; padding: 3px 6px; font-size: 12px; }
        .totals td.num { font-weight: bold; }
        .totals tr.rule td { border-top: 1px solid #000; }
        .totals tr.grand td { border-top: 2px solid #000; font-size: 13px; font-weight: bold; }
        @media print { body { margin: 10px; } }
      ${DOCUMENT_TOOLBAR_CSS}
      </style></head><body>
      ${documentToolbar("Purchase Voucher Report")}
      <div class="header">
        <div class="company-name">${info.name}</div>
        <div>${info.addressLine}</div>
        <div class="title">Purchase Voucher Report</div>
        <div>Period: ${period}</div>
      </div>

      <table>
        <thead><tr>
          <th>Voucher No</th><th>Date</th><th>Qty</th><th>Net Amount</th>
          <th>Discount</th><th>Party Amount</th><th>Paid</th><th>Dues</th>
        </tr></thead>
        <tbody>${body || `<tr><td colspan="8">No vouchers.</td></tr>`}</tbody>
      </table>

      <table class="totals">
        <tr><td>Total Quantity</td><td class="num">${summary.qty}</td></tr>
        <tr><td>Grand Total (net)</td><td class="num">${money(summary.net)}</td></tr>
        <tr><td>Total Discount (-)</td><td class="num">${money(totalDiscount)}</td></tr>
        <tr><td>Adjustment Total</td><td class="num">${money(totalAdjustment)}</td></tr>
        <tr class="rule"><td>Party Amount</td><td class="num">${money(summary.party)}</td></tr>
        <tr><td>Paid Amount</td><td class="num">${money(summary.paid)}</td></tr>
        <tr><td>Total Dues (-)</td><td class="num">${money(summary.due)}</td></tr>
        <tr class="grand"><td>Actual Total</td><td class="num">${money(
          summary.party - summary.due,
        )}</td></tr>
      </table>

      <div style="margin-top:20px;text-align:center;font-size:11px;color:#666;">
        Generated on ${new Date().toLocaleString("en-GB")}
      </div>
      </body></html>`);
    win.document.close();
  };

  return (
    <div className="space-y-4">
      <StatStrip
        stats={[
          { label: "Vouchers", value: loading ? "—" : filtered.length },
          {
            label: "Party amount",
            value: loading ? "—" : money(summary.party),
            tone: "money",
          },
          { label: "Paid", value: loading ? "—" : money(summary.paid), tone: "money" },
          {
            label: "Outstanding",
            value: loading ? "—" : money(summary.due),
            tone: "money",
          },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3">
        <DateRangeFilter
          idPrefix="vouchers"
          startDate={startDate}
          endDate={endDate}
          onStartChange={setStartDate}
          onEndChange={setEndDate}
          showSummary={false}
        />

        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search voucher no, supplier, remarks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Supplier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {suppliers.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="due">Unpaid only</SelectItem>
            <SelectItem value="paid">Paid only</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="mr-2 h-4 w-4" />
            Clear Filters
          </Button>
        )}

        <Button size="sm" onClick={printList} disabled={filtered.length === 0}>
          <Printer className="mr-2 h-4 w-4" />
          Print Report
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Voucher No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Party</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Dues</TableHead>
              <TableHead className="w-[70px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No vouchers match these filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const left = outstandingOf(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.voucher_no}</TableCell>
                    <TableCell>
                      {new Date(r.voucher_date).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell>{r.supplier ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.total_quantity ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.net_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.party_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(paidOf(r))}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        left > 0 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {money(left)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="See what was on this voucher"
                        onClick={() => openDetail(r)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ---- One voucher, in full ---- */}
      <Dialog open={!!openVoucher} onOpenChange={(o) => !o && setOpenVoucher(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[980px]">
          <DialogHeader>
            <DialogTitle>{openVoucher?.voucher_no}</DialogTitle>
            <DialogDescription>
              {openVoucher?.supplier ?? "No supplier"} •{" "}
              {openVoucher
                ? new Date(openVoucher.voucher_date).toLocaleDateString("en-GB")
                : ""}
            </DialogDescription>
          </DialogHeader>

          {itemsLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>IME No</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Colour</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="py-6 text-center text-muted-foreground">
                        Nothing recorded against this voucher.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((it, i) => (
                      <TableRow key={it.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {it.imei ?? "—"}
                        </TableCell>
                        <TableCell>{it.product_name ?? "—"}</TableCell>
                        <TableCell>{it.brand ?? "—"}</TableCell>
                        <TableCell>{it.model_number ?? "—"}</TableCell>
                        <TableCell>{it.variant ?? "—"}</TableCell>
                        <TableCell>{it.color ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {it.quantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(it.cost_price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(it.quantity * (Number(it.cost_price) || 0))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {openVoucher && (
            <div className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <Line label="Net amount" value={money(openVoucher.net_amount)} />
              <Line label="Discount (-)" value={money(openVoucher.discount)} />
              <Line label="Adjustment" value={money(openVoucher.adjustment)} />
              <Line label="Party amount" value={money(openVoucher.party_amount)} strong />
              <Line label="Paid on the day" value={money(openVoucher.paid_amount)} />
              <Line label="Paid since" value={money(openVoucher.due_settled)} />
              <Line
                label="Outstanding"
                value={money(outstandingOf(openVoucher))}
                strong
                danger={outstandingOf(openVoucher) > 0}
              />
              {openVoucher.remarks && (
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Remarks: </span>
                  {openVoucher.remarks}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => openVoucher && printVoucher(openVoucher, items, shop, payments)}
              disabled={!openVoucher || itemsLoading}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print voucher
            </Button>
            <Button onClick={() => setOpenVoucher(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums ${strong ? "font-semibold" : ""} ${
          danger ? "text-destructive" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
