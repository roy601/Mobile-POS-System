"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
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
 * What this supplier is still owed, and against which delivery.
 *
 * A supplier payment used to be a free-typed amount against a name:
 * the money left the till correctly, but nothing knew what it paid
 * off, so the shop's own answer to "how much do we still owe Ismartu?"
 * lived on paper.
 *
 * This is a STATEMENT, not a chooser. A supplier is owed a running
 * balance across several deliveries, and the owner hands over what he
 * can against the total — 50,000 today, 100,000 next week — without
 * deciding which delivery each note belongs to. Asking him to pick a
 * voucher first is asking a question he does not have an answer to, so
 * the payment is allocated oldest voucher first, in the database,
 * where it cannot be got wrong.
 *
 * Each line still opens, so he can see and print what a delivery
 * contained when the supplier queries it.
 *
 * The date range is here because a supplier the shop buys from weekly
 * builds up a long list, and the question at the counter is often
 * about a period — "the August ones" — not about all of them.
 */
export function SupplierDuesPanel({
  supplierId,
  onTotalChange,
}: {
  supplierId: string;
  /**
   * What this supplier is owed in total, for the form to pay against,
   * and what they are already holding.
   *
   * Both, because they answer different questions. The total decides
   * whether the payment goes through settle_supplier_dues at all; the
   * advance decides what the amount box should start at, so a shop
   * that has already paid ahead is not offered the whole bill again.
   */
  onTotalChange: (total: number, voucherCount: number, advance: number) => void;
}) {
  const { currentShopId, shops } = useRole();

  const [rows, setRows] = useState<VoucherRow[]>([]);
  /**
   * Money this supplier is holding for the shop.
   *
   * Everything paid to them, less everything that has actually been
   * allocated to a delivery. A shop can pay ahead (script 89), and the
   * part no voucher absorbed sits on account — invisible on this panel
   * otherwise, because it reads vouchers and an advance is not one.
   * Without it the counter opens the form, sees "nothing outstanding"
   * and pays a second time.
   */
  const [advance, setAdvance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [preview, setPreview] = useState<VoucherRow | null>(null);
  const [items, setItems] = useState<VoucherItem[]>([]);
  const [payments, setPayments] = useState<VoucherPayment[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const shop = useMemo(
    () => shops.find((s) => s.id === currentShopId),
    [shops, currentShopId],
  );

  const load = useCallback(async () => {
    if (!currentShopId || !supplierId) {
      setRows([]);
      setAdvance(0);
      return;
    }
    setLoading(true);
    setFailed(null);
    try {
      const { data, error } = await supabase
        .from("purchase_vouchers")
        .select(
          "id, voucher_no, voucher_date, supplier, supplier_id, total_quantity, net_amount, discount, adjustment, party_amount, paid_amount, due_amount, due_settled, remarks",
        )
        .eq("organization_id", currentShopId)
        .eq("supplier_id", supplierId)
        .is("deleted_at", null)
        .order("voucher_date", { ascending: true });

      if (error) throw error;

      const all = (data ?? []) as VoucherRow[];

      // Allocated across EVERY voucher, including the ones settled in
      // full — those are dropped from `rows` below, and leaving them
      // out here would report their payments as an advance.
      const allocated = all.reduce((s, v) => s + (Number(v.due_settled) || 0), 0);

      // The payments that could be an advance. Money paid on the day a
      // voucher was written (script 90's paid_with_voucher_id) is left
      // out: that voucher's due_amount is already net of it, so it was
      // never money held on account, and counting it would show a false
      // advance on every voucher paid at the counter. A database
      // without the column has no such rows, so the plain read is exact.
      const paymentsQuery = (columns: string) =>
        supabase
          .from("expenses")
          .select(columns)
          .eq("organization_id", currentShopId)
          .eq("supplier_id", supplierId)
          .eq("category", "party_payment");

      let { data: paidRows, error: paidError } = (await paymentsQuery(
        "amount, paid_with_voucher_id",
      )) as { data: any[] | null; error: any };
      if (paidError) {
        ({ data: paidRows, error: paidError } = (await paymentsQuery("amount")) as {
          data: any[] | null;
          error: any;
        });
      }
      paidRows = (paidRows ?? []).filter((r: any) => r.paid_with_voucher_id == null);

      // A failure here costs the advance line, not the dues list.
      if (paidError) {
        console.warn("Could not total payments to this supplier:", paidError.message);
      }
      const paid = paidError
        ? 0
        : (paidRows ?? []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

      // BOTH TOGETHER, AT THE END.
      //
      // setRows used to happen before this query and setAdvance after
      // it, so the parent was told the dues while the advance was still
      // zero. It pre-filled the payment box with the GROSS, and by the
      // time the real advance arrived the box was non-empty and would
      // not be overwritten — a supplier owed 110,632 who was already
      // holding 167,000 was offered the whole 110,632 to pay again.
      //
      // React batches these two, so the parent hears one figure for the
      // pair and never sees a half-loaded state.
      setRows(all.filter((v) => outstandingOf(v) > 0));
      setAdvance(paidError ? 0 : Math.max(0, Math.round((paid - allocated) * 100) / 100));
    } catch (err: any) {
      console.error("Could not load supplier dues:", err);
      setFailed(err?.message ?? "Could not load this supplier's dues.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [currentShopId, supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (startDate && r.voucher_date < startDate) return false;
        if (endDate && r.voucher_date > endDate) return false;
        return true;
      }),
    [rows, startDate, endDate],
  );

  // The whole balance, not the filtered view: the date range is a way
  // of reading the list, not a way of choosing what to pay. Narrowing
  // it to August and then paying "the total" would silently underpay.
  const totalOwed = useMemo(
    () => rows.reduce((s, r) => s + outstandingOf(r), 0),
    [rows],
  );

  // The callback is held in a ref and kept OUT of the dependency list.
  //
  // The parent passes an inline arrow, so it is a new function every
  // render. Depending on it means: effect fires -> parent sets state ->
  // parent re-renders -> new function -> effect fires again, forever.
  // That is the same loop that made the shop-transfer barcode field
  // clear itself; only the values may retrigger this.
  const notify = useRef(onTotalChange);
  useEffect(() => {
    notify.current = onTotalChange;
  });

  useEffect(() => {
    notify.current(totalOwed, rows.length, advance);
  }, [totalOwed, rows.length, advance]);

  const openPreview = async (voucher: VoucherRow) => {
    setPreview(voucher);
    setItems([]);
    setPayments([]);
    setPreviewLoading(true);
    try {
      const [lines, paid] = await Promise.all([
        loadVoucherItems(supabase, currentShopId!, voucher.id),
        loadVoucherPayments(supabase, currentShopId!, voucher.id),
      ]);
      setItems(lines);
      setPayments(paid);
    } catch (err) {
      console.error("Could not load the voucher:", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  if (!supplierId) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Unpaid vouchers</div>
          <div className="text-xs text-muted-foreground">
            What this supplier is owed. Pay any amount against the total below —
            it clears the oldest delivery first.
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="dues-from" className="text-xs">
              From
            </Label>
            <Input
              id="dues-from"
              type="date"
              className="h-8 w-[150px]"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dues-to" className="text-xs">
              To
            </Label>
            <Input
              id="dues-to"
              type="date"
              className="h-8 w-[150px]"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          {(startDate || endDate) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {failed ? (
        <p className="py-3 text-sm text-destructive">{failed}</p>
      ) : loading ? (
        <p className="py-3 text-sm text-muted-foreground">Loading dues…</p>
      ) : filtered.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          {rows.length === 0
            ? "Nothing due to this supplier."
            : "No unpaid vouchers in that date range."}
        </p>
      ) : (
        <div className="max-h-[280px] overflow-y-auto rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voucher No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Party</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="w-[52px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.voucher_no}</TableCell>
                    <TableCell>
                      {new Date(r.voucher_date).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.party_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(paidOf(r))}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-destructive">
                      {money(outstandingOf(r))}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="See what was on this voucher"
                        onClick={() => openPreview(r)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-2 flex flex-wrap items-baseline justify-end gap-x-2 text-sm">
          {filtered.length !== rows.length && (
            <span className="text-xs text-muted-foreground">
              (showing {filtered.length} of {rows.length} — the total is for all
              of them)
            </span>
          )}
          <span className="text-muted-foreground">Total due:</span>
          <span className="font-semibold tabular-nums text-destructive">
            {money(totalOwed)}
          </span>
        </div>
      )}

      {/* Shown whether or not anything is owed. With an empty list it
          is the only thing on the panel, and it is the reason the
          counter should not pay again. */}
      {advance > 0 && (
        <>
          <div className="mt-2 flex flex-wrap items-baseline justify-end gap-x-2 text-sm">
            <span className="text-muted-foreground">Paid in advance:</span>
            <span className="font-semibold tabular-nums text-emerald-600">
              {money(advance)}
            </span>
          </div>
          {totalOwed > 0 && (
            <div className="mt-1 flex flex-wrap items-baseline justify-end gap-x-2 text-sm">
              <span className="text-muted-foreground">Net still to pay:</span>
              <span className="font-semibold tabular-nums">
                {money(Math.max(0, totalOwed - advance))}
              </span>
            </div>
          )}
        </>
      )}

      {/* ---- Preview: the whole delivery, and where the money stands ---- */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[920px]">
          <DialogHeader>
            <DialogTitle>{preview?.voucher_no}</DialogTitle>
            <DialogDescription>
              {preview?.supplier ?? "Supplier"} •{" "}
              {preview ? new Date(preview.voucher_date).toLocaleDateString("en-GB") : ""}
            </DialogDescription>
          </DialogHeader>

          {previewLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
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
                        <TableCell
                          colSpan={10}
                          className="py-6 text-center text-muted-foreground"
                        >
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

              {payments.length > 0 && (
                <div className="rounded-md border">
                  <div className="border-b px-3 py-2 text-sm font-medium">
                    Payment history
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            {new Date(p.date).toLocaleDateString("en-GB")}
                          </TableCell>
                          <TableCell>{p.reference ?? "—"}</TableCell>
                          <TableCell>
                            {p.bank_name
                              ? `${p.payment_method} — ${p.bank_name}`
                              : (p.payment_method ?? "—")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(p.amount)}
                            {p.payment_total ? (
                              <div className="text-xs text-muted-foreground">
                                of a {money(p.payment_total)} payment
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {preview && (
                <div className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
                  <Row label="Net amount" value={money(preview.net_amount)} />
                  <Row label="Discount (-)" value={money(preview.discount)} />
                  <Row label="Adjustment" value={money(preview.adjustment)} />
                  <Row label="Party amount" value={money(preview.party_amount)} strong />
                  <Row label="Paid on the day" value={money(preview.paid_amount)} />
                  <Row label="Paid since" value={money(preview.due_settled)} />
                  <Row
                    label="Due"
                    value={money(outstandingOf(preview))}
                    strong
                    danger
                  />
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => preview && printVoucher(preview, items, shop, payments)}
              disabled={!preview || previewLoading}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button type="button" onClick={() => setPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
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
