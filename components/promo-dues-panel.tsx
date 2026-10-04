"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";
import { money } from "@/lib/purchase-voucher";
import {
  isMissingPromoVariant,
  PROMO_CLAIM_COLUMNS,
  PROMO_CLAIM_COLUMNS_WITHOUT_VARIANT,
  round2,
  type PromoClaim,
} from "@/lib/promo";

const supabase = createClient();

/**
 * What a supplier still owes the shop for promos — the Income page's
 * counterpart to the unpaid-vouchers panel on Expenses.
 *
 * The money runs the other way: the shop sold handsets below its price
 * on the supplier's promo, and the supplier pays it back. Recording a
 * "Promo" receipt here closes these oldest first (settle_supplier_promo),
 * so the person at the counter sees what is owed before typing the
 * amount rather than after.
 */
export function PromoDuesPanel({
  supplierId,
  onTotalChange,
}: {
  supplierId: string | null;
  /** Told the total still owed whenever it is known. */
  onTotalChange?: (total: number) => void;
}) {
  const { currentShopId } = useRole();
  const [rows, setRows] = useState<PromoClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // The parent passes an inline callback; holding it in a ref keeps a
  // new one on every render from reloading the list.
  const notify = useRef(onTotalChange);
  notify.current = onTotalChange;

  useEffect(() => {
    if (!currentShopId || !supplierId) {
      setRows([]);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setFailed(null);
      const read = (columns: string) =>
        supabase
          .from("supplier_promo_claims")
          .select(columns)
          .eq("organization_id", currentShopId)
          .eq("supplier_id", supplierId)
          .gt("outstanding", 0)
          .order("starts_on", { ascending: true });

      let { data, error } = await read(PROMO_CLAIM_COLUMNS);
      if (isMissingPromoVariant(error)) {
        ({ data, error } = await read(PROMO_CLAIM_COLUMNS_WITHOUT_VARIANT));
      }
      if (cancelled) return;

      if (error) {
        setFailed(`Could not load promo dues: ${error.message}`);
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as PromoClaim[]);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentShopId, supplierId]);

  // One figure per supplier: the shop asks "how much does this
  // supplier owe me for promos", not model by model. The breakdown is
  // on the Purchases → Promos tab.
  const total = round2(rows.reduce((s, r) => s + Number(r.outstanding || 0), 0));
  const claimed = round2(
    rows.reduce((s, r) => s + Number(r.claimed || 0) - Number(r.returned_amount || 0), 0),
  );
  const received = round2(rows.reduce((s, r) => s + Number(r.received || 0), 0));

  useEffect(() => {
    if (!loading && !failed) notify.current?.(total);
  }, [total, loading, failed]);

  if (!supplierId) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-3">
        <div className="text-sm font-medium">Promo dues</div>
        <div className="text-xs text-muted-foreground">
          What this supplier owes the shop for promo sales. A receipt clears the oldest
          promo first.
        </div>
      </div>

      {failed ? (
        <p className="py-3 text-sm text-destructive">{failed}</p>
      ) : loading ? (
        <p className="py-3 text-sm text-muted-foreground">Loading promo dues…</p>
      ) : total <= 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          This supplier owes nothing for promos.
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border bg-background px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">
            Claimed {money(claimed)} · Received {money(received)}
          </span>
          <span>
            <span className="text-muted-foreground">Total due: </span>
            <span className="font-semibold tabular-nums text-destructive">{money(total)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
