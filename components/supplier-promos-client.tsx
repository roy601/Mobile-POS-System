"use client";

/**
 * Supplier promos, and what is still owed on them.
 *
 * A supplier funds a discount on one model — 200 taka off the Tecno
 * Camon 50 — the shop sells it for 200 less, and weeks later the
 * supplier pays back the total. Before this screen the shop kept that
 * on paper and took the supplier's word for the figure.
 *
 * What it shows, per promo: how many went out on it, what that comes
 * to, what has come back, and what is still owed. What it does:
 * set a promo up, correct one, end one, and record the money when it
 * arrives.
 *
 * Adding, editing and removing are open to anyone in the shop. A
 * supplier announces a promo to whoever is on the counter, and a
 * manager who has to wait for the owner either sells at full price or
 * gives the discount with nothing to claim against.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/component";
import { OptionCombobox } from "@/components/option-combobox";
import { useRole } from "@/components/role-provider";
import { shopToday } from "@/lib/shop-date";
import {
  isMissingPromoVariant,
  PROMO_CLAIM_COLUMNS,
  PROMO_CLAIM_COLUMNS_WITHOUT_VARIANT,
  promoLabel,
  promoPeriod,
  round2,
  type PromoClaim,
} from "@/lib/promo";
import { printPromoStatement } from "@/lib/promo-reports";
import { shopHeader } from "@/lib/utils/shop-header";

type Supplier = { id: string; name: string };

const money = (n: any) =>
  "৳" +
  (Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** An empty promo form, opened on today. */
const blankForm = () => ({
  id: null as number | null,
  supplier_id: "",
  brand: "",
  product_name: "",
  model_number: "",
  variant: "",
  amount: "",
  starts_on: shopToday(),
  ends_on: "",
  note: "",
});

export function SupplierPromosClient() {
  const supabase = createClient();
  const { currentShopId, shops } = useRole();

  const [claims, setClaims] = useState<PromoClaim[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  /** Set when the database has not run script 98 yet. */
  const [needsScript, setNeedsScript] = useState(false);

  const [form, setForm] = useState(blankForm());
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<PromoClaim | null>(null);

  const [receipt, setReceipt] = useState<{
    supplierId: string;
    supplierName: string;
    outstanding: number;
  } | null>(null);
  const [receiptForm, setReceiptForm] = useState({
    amount: "",
    date: shopToday(),
    destination_type: "cash" as "cash" | "bank",
    notes: "",
  });

  const shop = useMemo(
    () => shops.find((s: any) => s.id === currentShopId),
    [shops, currentShopId],
  );

  const load = useCallback(async () => {
    if (!currentShopId) return;
    setLoading(true);
    try {
      const readClaims = (columns: string) =>
        supabase
          .from("supplier_promo_claims")
          .select(columns)
          .eq("organization_id", currentShopId)
          .is("deleted_at", null)
          .order("starts_on", { ascending: false });

      const [claimsRead, { data: sup }] = await Promise.all([
        // Before script 100 the view has no variant column. Asking
        // again without it keeps the tab working, every promo shown
        // as covering every variant, which is what it then does.
        readClaims(PROMO_CLAIM_COLUMNS).then((r) =>
          isMissingPromoVariant(r.error) ? readClaims(PROMO_CLAIM_COLUMNS_WITHOUT_VARIANT) : r,
        ),
        supabase
          .from("suppliers")
          .select("id, name")
          .eq("organization_id", currentShopId)
          .is("deleted_at", null)
          .order("name"),
      ]);
      const { data: rows, error } = claimsRead;

      if (error) {
        // 42P01 is "relation does not exist": the migration has not
        // been run on this shop's database yet. Everything else is a
        // real failure worth saying out loud.
        const missing =
          error.code === "42P01" ||
          error.code === "PGRST205" ||
          /does not exist/i.test(error.message || "");
        setNeedsScript(missing);
        setClaims([]);
        if (!missing) toast.error(`Could not load promos: ${error.message}`);
      } else {
        setNeedsScript(false);
        setClaims((rows ?? []) as unknown as PromoClaim[]);
      }
      setSuppliers((sup ?? []) as Supplier[]);
    } finally {
      setLoading(false);
    }
  }, [currentShopId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const supplierName = useCallback(
    (id: string) => suppliers.find((s) => s.id === id)?.name ?? "Supplier",
    [suppliers],
  );

  /** Per supplier, so a receipt can be recorded against the lot. */
  const bySupplier = useMemo(() => {
    const map = new Map<string, { name: string; outstanding: number; promos: PromoClaim[] }>();
    for (const c of claims) {
      const entry = map.get(c.supplier_id) ?? {
        name: supplierName(c.supplier_id),
        outstanding: 0,
        promos: [],
      };
      entry.outstanding = round2(entry.outstanding + Number(c.outstanding || 0));
      entry.promos.push(c);
      map.set(c.supplier_id, entry);
    }
    return map;
  }, [claims, supplierName]);

  const totals = useMemo(
    () =>
      claims.reduce(
        (acc, c) => ({
          claimed: round2(acc.claimed + Number(c.claimed || 0)),
          received: round2(acc.received + Number(c.received || 0)),
          outstanding: round2(acc.outstanding + Number(c.outstanding || 0)),
        }),
        { claimed: 0, received: 0, outstanding: 0 },
      ),
    [claims],
  );

  const openNew = () => {
    setForm(blankForm());
    setFormOpen(true);
  };

  const openEdit = (c: PromoClaim) => {
    setForm({
      id: c.promo_id,
      supplier_id: c.supplier_id,
      brand: c.brand ?? "",
      product_name: c.product_name ?? "",
      model_number: c.model_number ?? "",
      variant: c.variant ?? "",
      amount: String(c.amount ?? ""),
      starts_on: c.starts_on,
      ends_on: c.ends_on ?? "",
      note: c.note ?? "",
    });
    setFormOpen(true);
  };

  /**
   * Changing the supplier clears what was chosen under the old one.
   *
   * The lists narrow to what that supplier has delivered, so a brand
   * left behind from the previous choice is one this supplier may
   * never have sold — and a promo on it would match stock they are
   * not funding.
   */
  const chooseSupplier = (supplier_id: string) =>
    setForm((f) =>
      f.supplier_id === supplier_id
        ? f
        : { ...f, supplier_id, brand: "", product_name: "", model_number: "", variant: "" },
    );

  const savePromo = async () => {
    const amount = Number(form.amount);
    if (!form.supplier_id) return toast.error("Choose the supplier paying for this promo.");
    if (!form.brand.trim()) return toast.error("Enter the brand.");
    if (!form.product_name.trim()) return toast.error("Enter the product name.");
    if (!(amount > 0)) return toast.error("Enter how much comes off each unit.");
    if (form.ends_on && form.ends_on < form.starts_on)
      return toast.error("The end date is before the start date.");

    setSaving(true);
    try {
      const row = {
        organization_id: currentShopId,
        supplier_id: form.supplier_id,
        brand: form.brand.trim(),
        product_name: form.product_name.trim(),
        model_number: form.model_number.trim() || null,
        variant: form.variant.trim() || null,
        amount: round2(amount),
        starts_on: form.starts_on,
        ends_on: form.ends_on || null,
        note: form.note.trim() || null,
      };

      const write = (values: Partial<typeof row>) =>
        form.id
          ? supabase.from("supplier_promos").update(values).eq("id", form.id)
          : supabase.from("supplier_promos").insert(values);

      let { error } = await write(row);

      // Before script 100 there is no variant column. A promo on every
      // variant can still be saved without it; one on a single variant
      // cannot, and saving it as every variant would claim for
      // handsets the supplier is not funding.
      if (isMissingPromoVariant(error)) {
        if (row.variant) {
          toast.error(
            "This shop's database has not been updated for promos on one variant yet. Ask your administrator to run script 100, or leave the variant empty.",
          );
          return;
        }
        const { variant: _variant, ...withoutVariant } = row;
        ({ error } = await write(withoutVariant));
      }

      if (error) {
        toast.error(`Could not save the promo: ${error.message}`);
        return;
      }

      toast.success(
        form.id
          ? "Promo updated. Sales already made keep the amount they were sold on."
          : "Promo added. It will be offered at the till for that model.",
      );
      setFormOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const removePromo = async () => {
    if (!removing) return;
    const { error } = await supabase
      .from("supplier_promos")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", removing.promo_id);

    if (error) {
      toast.error(`Could not remove the promo: ${error.message}`);
      return;
    }
    toast.success(
      "Promo removed. It is off the till; anything already sold on it is still claimable.",
    );
    setRemoving(null);
    await load();
  };

  const openReceipt = (supplierId: string) => {
    const entry = bySupplier.get(supplierId);
    if (!entry) return;
    setReceipt({
      supplierId,
      supplierName: entry.name,
      outstanding: entry.outstanding,
    });
    setReceiptForm({
      amount: String(entry.outstanding || ""),
      date: shopToday(),
      destination_type: "cash",
      notes: "",
    });
  };

  const saveReceipt = async () => {
    if (!receipt) return;
    const amount = Number(receiptForm.amount);
    if (!(amount > 0)) return toast.error("Enter the amount received.");

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("settle_supplier_promo", {
        p_organization_id: currentShopId,
        p_client_txn_id: crypto.randomUUID(),
        p_supplier_id: receipt.supplierId,
        p_amount: round2(amount),
        p_payment: {
          date: receiptForm.date,
          destination_type: receiptForm.destination_type,
          description: receipt.supplierName,
          notes: receiptForm.notes.trim() || null,
        },
      });

      if (error) {
        toast.error(
          error.code === "PGRST202"
            ? "This shop's database has not been updated for promo receipts yet. Ask your administrator to run script 99."
            : `Could not record the receipt: ${error.message}`,
        );
        return;
      }

      const result = data as {
        success: boolean;
        message?: string;
        applied?: number;
        remaining?: number;
        applied_to?: string[];
      } | null;

      if (!result?.success) {
        toast.error(result?.message ?? "The receipt was not recorded.");
        return;
      }

      const left = Number(result.remaining ?? 0);
      toast.success(
        left > 0
          ? `${money(result.applied)} received. ${money(left)} still to claim from ${receipt.supplierName}.`
          : `${money(result.applied)} received. ${receipt.supplierName}'s promos are fully claimed.`,
      );
      setReceipt(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const printStatement = async () => {
    // The sales behind the claims, so the shop can check the supplier's
    // figure line by line rather than trusting a total.
    const { data, error } = await supabase
      .from("sold_products")
      .select(
        "id, sales_id, promo_id, promo_amount, quantity, product_name, model_number, variant, barcode, created_at",
      )
      .eq("organization_id", currentShopId)
      .not("promo_id", "is", null)
      .is("deleted_at", null)
      .order("created_at");

    if (error) {
      toast.error(`Could not load the sales behind these promos: ${error.message}`);
      return;
    }

    printPromoStatement({
      header: shopHeader(shop),
      claims,
      lines: (data ?? []) as any[],
      supplierName,
    });
  };

  if (needsScript) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700/60 dark:bg-amber-950/30">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Supplier promos are not set up on this shop&apos;s database yet.
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Ask your administrator to run scripts 98 and 99. Everything else on this page works
            as usual in the meantime.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Promos <span className="font-semibold text-foreground">{claims.length}</span>
          </span>
          <span className="text-muted-foreground">
            Claimed <span className="font-semibold text-foreground">{money(totals.claimed)}</span>
          </span>
          <span className="text-muted-foreground">
            Received <span className="font-semibold text-foreground">{money(totals.received)}</span>
          </span>
          <span className="text-muted-foreground">
            Still to claim{" "}
            <span
              className={
                totals.outstanding > 0
                  ? "font-semibold text-amber-700 dark:text-amber-500"
                  : "font-semibold text-foreground"
              }
            >
              {money(totals.outstanding)}
            </span>
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={printStatement} disabled={claims.length === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Print statement
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" />
            Add promo
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading promos…</p>
      ) : claims.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No promos yet.</p>
          <p className="mt-1">
            When a supplier offers money off a model, add it here. The till then offers it on that
            model, and what the supplier owes back is counted for you.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {[...bySupplier.entries()].map(([supplierId, entry]) => (
            <Card key={supplierId}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">{entry.name}</CardTitle>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {entry.outstanding > 0
                      ? `${money(entry.outstanding)} still to claim`
                      : "Nothing left to claim"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={entry.outstanding > 0 ? "default" : "outline"}
                  disabled={entry.outstanding <= 0}
                  onClick={() => openReceipt(supplierId)}
                >
                  Record receipt
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">Model</th>
                        <th className="px-4 py-2 text-left font-semibold">Period</th>
                        <th className="px-4 py-2 text-right font-semibold">Per unit</th>
                        <th className="px-4 py-2 text-right font-semibold">Sold</th>
                        <th className="px-4 py-2 text-right font-semibold">Claimed</th>
                        <th className="px-4 py-2 text-right font-semibold">Received</th>
                        <th className="px-4 py-2 text-right font-semibold">Outstanding</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {entry.promos.map((c, i) => (
                        <tr key={c.promo_id} className={i % 2 ? "bg-muted/30" : undefined}>
                          <td className="px-4 py-2 font-medium">{promoLabel(c)}</td>
                          <td className="px-4 py-2 text-muted-foreground">{promoPeriod(c)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{money(c.amount)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {c.units_sold}
                            {c.units_returned > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                (−{c.units_returned} returned)
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {money(Number(c.claimed) - Number(c.returned_amount))}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{money(c.received)}</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">
                            {money(c.outstanding)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Edit ${promoLabel(c)}`}
                                onClick={() => openEdit(c)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Remove ${promoLabel(c)}`}
                                onClick={() => setRemoving(c)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add or correct a promo */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit promo" : "Add promo"}</DialogTitle>
            <DialogDescription>
              What the supplier takes off each unit, and which model it is on. The till offers it
              on that model; the cashier ticks it when the sale is made on the promo.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div>
              <Label htmlFor="promo-supplier">Supplier*</Label>
              <Select value={form.supplier_id} onValueChange={chooseSupplier}>
                <SelectTrigger id="promo-supplier">
                  <SelectValue placeholder="Who is paying for this promo" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* The shop's own lists, the same ones stock entry uses, and
                narrowing the same way: the brand decides which products
                are offered, the product decides which models. Typing a
                promo's model by hand is how it ends up spelled
                differently from the stock and matching nothing at the
                till. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <OptionCombobox
                id="promo-brand"
                kind="brand"
                label="Brand*"
                placeholder={form.supplier_id ? "Select or type brand" : "Choose the supplier first"}
                value={form.brand}
                onChange={(v) => setForm((f) => ({ ...f, brand: v }))}
                supplierId={form.supplier_id || null}
              />
              <OptionCombobox
                id="promo-product"
                kind="product_name"
                label="Product*"
                placeholder="Select or type product"
                value={form.product_name}
                onChange={(v) => setForm((f) => ({ ...f, product_name: v }))}
                context={{ brand: form.brand }}
                supplierId={form.supplier_id || null}
              />
              <OptionCombobox
                id="promo-model"
                kind="model_number"
                label="Model"
                placeholder="Select or type model"
                value={form.model_number}
                onChange={(v) => setForm((f) => ({ ...f, model_number: v }))}
                context={{ brand: form.brand, product_name: form.product_name }}
                supplierId={form.supplier_id || null}
              />
              <OptionCombobox
                id="promo-variant"
                kind="variant"
                label="Variant"
                placeholder="Select or type variant"
                value={form.variant}
                onChange={(v) => setForm((f) => ({ ...f, variant: v }))}
                context={{
                  brand: form.brand,
                  product_name: form.product_name,
                  model_number: form.model_number,
                }}
                supplierId={form.supplier_id || null}
              />
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">
              The lists show what this supplier has delivered. Leave the model empty to cover
              every model of that product, and the variant empty to cover every variant;
              every colour is always covered.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="promo-amount">Off each unit (৳)*</Label>
                <Input
                  id="promo-amount"
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="200"
                />
              </div>
              <div>
                <Label htmlFor="promo-from">From*</Label>
                <Input
                  id="promo-from"
                  type="date"
                  value={form.starts_on}
                  onChange={(e) => setForm((f) => ({ ...f, starts_on: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="promo-to">To</Label>
                <Input
                  id="promo-to"
                  type="date"
                  value={form.ends_on}
                  onChange={(e) => setForm((f) => ({ ...f, ends_on: e.target.value }))}
                />
              </div>
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">
              Leave To empty while the promo is still running.
            </p>

            <div>
              <Label htmlFor="promo-note">Note</Label>
              <Textarea
                id="promo-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Anything worth remembering when the supplier settles"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePromo} disabled={saving}>
              {saving ? "Saving…" : form.id ? "Save changes" : "Add promo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The money arriving */}
      <Dialog open={!!receipt} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Promo received from {receipt?.supplierName}</DialogTitle>
            <DialogDescription>
              Recorded as supplier income, so it shows in the Day Cashbook and the ledger. It
              clears the oldest promo first.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div>
              <Label htmlFor="receipt-amount">Amount (৳)*</Label>
              <Input
                id="receipt-amount"
                type="number"
                value={receiptForm.amount}
                onChange={(e) => setReceiptForm((f) => ({ ...f, amount: e.target.value }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {money(receipt?.outstanding ?? 0)} outstanding.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="receipt-date">Date*</Label>
                <Input
                  id="receipt-date"
                  type="date"
                  value={receiptForm.date}
                  onChange={(e) => setReceiptForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="receipt-dest">Received in*</Label>
                <Select
                  value={receiptForm.destination_type}
                  onValueChange={(v) =>
                    setReceiptForm((f) => ({ ...f, destination_type: v as "cash" | "bank" }))
                  }
                >
                  <SelectTrigger id="receipt-dest">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="receipt-notes">Notes</Label>
              <Input
                id="receipt-notes"
                value={receiptForm.notes}
                onChange={(e) => setReceiptForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Cheque number, reference…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceipt(null)}>
              Cancel
            </Button>
            <Button onClick={saveReceipt} disabled={saving}>
              {saving ? "Recording…" : "Record receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this promo?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? promoLabel(removing) : ""} comes off the till, so it will not be offered
              on new sales. Everything already sold on it keeps its claim
              {removing && removing.outstanding > 0
                ? ` — ${money(removing.outstanding)} is still outstanding and stays claimable.`
                : "."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={removePromo}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
