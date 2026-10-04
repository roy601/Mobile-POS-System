"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackageSearch, Search } from "lucide-react";

import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const supabase = createClient();

const money = (n: number) =>
  `৳${(Number(n) || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Finding a product that has no barcode to scan.
 *
 * WHY THIS IS NEEDED AT ALL
 *
 * Both return forms are built around a scan: type or scan a code, and
 * the item is found. That works for handsets, where every unit carries
 * its own serial. It does not work for the counted stock a phone shop
 * also sells — cables, covers, neck bands, chargers — because there is
 * nothing on them to scan. On Star Power 01, thirty-one of fifty-four
 * sold lines are counted stock, so this was more than half of what the
 * counter might be handed back.
 *
 * Those products are not unidentified. The database gives each one an
 * internal key (NB-370 and so on) so it can reach Inventory and the
 * till at all — it is simply a key nobody can read off the product.
 *
 * SO THIS ONLY FINDS THE KEY
 *
 * The picker searches by the things the counter can actually see —
 * product name, model, colour — and hands the caller back the internal
 * key. Everything after that is the existing barcode flow, unchanged:
 * the same lookup, the same stock movements, the same exchange. That
 * is what makes counted stock behave "same to same" as scanned stock
 * rather than being a second system to keep in step.
 *
 * SOLD ITEMS ARE PICKED BY ROW, NOT BY KEY
 *
 * A scanned serial belongs to exactly one sale. A counted key belongs
 * to as many sales as the shop has made of that cable, so looking one
 * up by key returns several rows and the form's .maybeSingle() fails
 * outright with PGRST116 — which is why entering the key by hand would
 * not have worked either. For sold items the caller therefore gets the
 * chosen ROW back, and picks the sale the customer is actually holding.
 */

export type PickedStock = {
  /** The internal key. What the existing barcode flow expects. */
  barcode: string;
  productName: string;
  modelNumber: string | null;
  color: string | null;
};

export type PickedSoldItem = PickedStock & {
  /** sold_products.id — the one line, not just its key. */
  id: number;
  salesId: number | null;
  quantity: number;
  unitPrice: number;
  saleDate: string | null;
  invoiceNumber: string | null;
};

type Row = PickedSoldItem & { available?: number };

export function NoBarcodePicker({
  open,
  onOpenChange,
  source,
  title,
  description,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * "inventory" — what is on the shelves now, for something going back
   * to a supplier or going out as a replacement.
   * "sold" — what has left the shop, for a customer return.
   */
  source: "inventory" | "sold";
  title?: string;
  description?: string;
  onPick: (row: Row) => void;
}) {
  const { currentShopId } = useRole();
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const search = useCallback(
    async (raw: string) => {
      if (!currentShopId) return;
      // Commas, brackets and wildcards are PostgREST's own `or`
      // syntax. Left in, a customer name like "Ali, Nayas" does not
      // find nothing — it makes a request the server rejects.
      const q = raw.trim().replace(/[,()*%]/g, " ").trim();
      setLoading(true);
      setFailed(null);
      try {
        if (source === "inventory") {
          let request = supabase
            .from("inventory")
            .select(
              "barcode, product_name, model_number, color, quantity, sale_price",
            )
            .eq("organization_id", currentShopId)
            // Nothing to send back or hand over if there is none left.
            .gt("quantity", 0)
            .order("product_name")
            .limit(50);

          if (q) {
            request = request.or(
              `product_name.ilike.%${q}%,model_number.ilike.%${q}%,color.ilike.%${q}%`,
            );
          }

          const { data, error } = await request;
          if (error) throw error;

          setRows(
            (data ?? []).map((r: any) => ({
              id: 0,
              barcode: String(r.barcode ?? ""),
              productName: r.product_name ?? "Unknown product",
              modelNumber: r.model_number ?? null,
              color: r.color ?? null,
              quantity: 1,
              unitPrice: Number(r.sale_price) || 0,
              salesId: null,
              saleDate: null,
              invoiceNumber: null,
              available: Number(r.quantity) || 0,
            })),
          );
          return;
        }

        let request = supabase
          .from("sold_products")
          .select(
            "id, barcode, product_name, model_number, color, quantity, unit_price, sales_id, sales(sale_date, invoice_number)",
          )
          .eq("organization_id", currentShopId)
          // Newest first: a customer bringing something back is far
          // more likely to be returning last week's than last year's.
          .order("id", { ascending: false })
          .limit(50);

        if (q) {
          request = request.or(
            `product_name.ilike.%${q}%,model_number.ilike.%${q}%,color.ilike.%${q}%,barcode.ilike.%${q}%`,
          );
        }

        const { data, error } = await request;
        if (error) throw error;

        setRows(
          (data ?? []).map((r: any) => ({
            id: Number(r.id),
            barcode: String(r.barcode ?? ""),
            productName: r.product_name ?? "Unknown product",
            modelNumber: r.model_number ?? null,
            color: r.color ?? null,
            quantity: Number(r.quantity) || 1,
            unitPrice: Number(r.unit_price) || 0,
            salesId: r.sales_id ?? null,
            saleDate: r.sales?.sale_date ?? null,
            invoiceNumber: r.sales?.invoice_number ?? null,
          })),
        );
      } catch (err: any) {
        setFailed(err?.message ?? "Could not search.");
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [currentShopId, source],
  );

  // Opening with the list already filled: the counter is standing at
  // the counter with the thing in their hand, and an empty box that
  // needs a word typed into it before showing anything is a step for
  // nothing.
  useEffect(() => {
    if (!open) return;
    setTerm("");
    search("");
  }, [open, search]);

  // Typing narrows it, after a pause. A shop's whole accessory list is
  // short enough that this never needs to be clever.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => search(term), 250);
    return () => clearTimeout(timer);
  }, [term, open, search]);

  const dateOf = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-GB") : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5" />
            {title ?? "Find a product without a barcode"}
          </DialogTitle>
          <DialogDescription>
            {description ??
              (source === "sold"
                ? "Search what has been sold, then pick the line the customer is bringing back."
                : "Search what is in stock, then pick the product.")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Product name, model or colour…"
            className="pl-8"
          />
        </div>

        <div className="max-h-[360px] space-y-1 overflow-y-auto">
          {loading && (
            <p className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </p>
          )}

          {!loading && failed && (
            <p className="px-1 py-3 text-sm text-destructive">{failed}</p>
          )}

          {!loading && !failed && rows.length === 0 && (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              {term.trim()
                ? `Nothing matching "${term.trim()}".`
                : source === "sold"
                  ? "Nothing has been sold yet."
                  : "Nothing in stock."}
            </p>
          )}

          {rows.map((r) => (
            <button
              key={source === "sold" ? r.id : r.barcode}
              type="button"
              onClick={() => {
                onPick(r);
                onOpenChange(false);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left hover:bg-accent"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {r.productName}
                  {r.modelNumber ? ` ${r.modelNumber}` : ""}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[
                    r.color,
                    source === "sold" ? r.invoiceNumber : null,
                    source === "sold" ? dateOf(r.saleDate) : null,
                  ]
                    .filter(Boolean)
                    .join("  ·  ")}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs">
                {source === "inventory" ? (
                  <>
                    <div className="font-semibold tabular-nums">
                      {r.available} in stock
                    </div>
                    <div className="text-muted-foreground tabular-nums">
                      {money(r.unitPrice)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold tabular-nums">
                      {money(r.unitPrice)}
                    </div>
                    <div className="text-muted-foreground tabular-nums">
                      qty {r.quantity}
                    </div>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
