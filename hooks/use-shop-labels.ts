"use client"

import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"
import type { HiddenOptions, ShopLabels } from "@/lib/shop-labels"

const supabase = createClient()

/**
 * The shop's own wording for the built-in list entries.
 *
 * Loaded once per screen. A shop that has renamed nothing gets an
 * empty map and every caller falls back to our defaults, so this is
 * free until someone actually uses it.
 *
 * A failure is swallowed on purpose: shop_labels arrives with script
 * 82, and a till whose database has not been updated yet must still
 * show "Owner Income" rather than a blank screen. The app and the
 * database version independently here.
 */
export function useShopLabels() {
  const { currentShopId } = useRole()
  const [labels, setLabels] = useState<ShopLabels>({})
  const [hidden, setHidden] = useState<HiddenOptions>(new Set())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentShopId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // hidden arrives with script 87. Asked for by name rather than
      // with '*' so that a database without it fails here and is caught
      // below, instead of every list silently losing its wording too.
      let rows: { key: string; label: string; hidden?: boolean }[]
      const withHidden = await supabase
        .from("shop_labels")
        .select("key, label, hidden")
        .eq("organization_id", currentShopId)

      if (withHidden.error) {
        const plain = await supabase
          .from("shop_labels")
          .select("key, label")
          .eq("organization_id", currentShopId)
        if (plain.error) throw plain.error
        rows = (plain.data ?? []) as typeof rows
      } else {
        rows = (withHidden.data ?? []) as typeof rows
      }

      const map: ShopLabels = {}
      const off: HiddenOptions = new Set()
      for (const row of rows) {
        map[row.key] = row.label
        if (row.hidden) off.add(row.key)
      }
      setLabels(map)
      setHidden(off)
    } catch {
      setLabels({})
      setHidden(new Set())
    } finally {
      setLoading(false)
    }
  }, [currentShopId])

  useEffect(() => {
    load()
  }, [load])

  return { labels, hidden, loading, reload: load }
}
