"use client"

import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"

const supabase = createClient()

export type LinkedShop = { id: string; name: string }

/**
 * The shops this one is connected to, by name.
 *
 * `useRole().shops` only holds shops the signed-in user is a MEMBER of.
 * An owner belongs to both, so resolving a partner's name from that
 * list worked for them and silently failed for every manager — the
 * transfer screens all read "Connected shop" instead of "Star Power 01".
 *
 * So the names come from list_linked_shops, which returns nothing but
 * the id and name of shops the owner has connected. Membership is still
 * merged in first: it is already loaded, and it means the hook is
 * useful on the very first render rather than after a round trip.
 */
export function useLinkedShops() {
  const { currentShopId, shops } = useRole()
  const [linked, setLinked] = useState<LinkedShop[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentShopId) return
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc("list_linked_shops", {
        p_organization_id: currentShopId,
      })
      if (error) throw error
      setLinked((data ?? []) as LinkedShop[])
    } catch {
      // A database that has not run script 61 yet still gets the
      // owner's own shops below, rather than an empty screen.
      setLinked([])
    } finally {
      setLoading(false)
    }
  }, [currentShopId])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Name for any shop id, wherever it came from.
   *
   * Falls back to the placeholder only when a shop really cannot be
   * identified — a connection removed after stock was already sent, for
   * instance, where the history should still read sensibly.
   */
  const nameOf = useCallback(
    (id: string | null | undefined) => {
      if (!id) return "Connected shop"
      return (
        shops.find((s) => s.id === id)?.name ??
        linked.find((s) => s.id === id)?.name ??
        "Connected shop"
      )
    },
    [shops, linked]
  )

  return { linked, nameOf, loading, reload: load }
}
