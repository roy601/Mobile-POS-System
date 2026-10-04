"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"

/**
 * Subscription state for the active shop.
 *
 * The real enforcement lives in Postgres: `org_can_write()` gates every
 * write policy, so an expired shop is refused at the database no matter
 * what the client believes. This provider exists so the app can *say
 * so* — warn before expiry, and explain a refusal in plain language
 * instead of surfacing a row-level-security error.
 *
 * It also caches the last known state, so a dropped connection does not
 * make a paid-up shop look expired.
 */

const CACHE_PREFIX = "mpos_subscription_"
/** How long a cached licence is trusted once the shop goes offline. */
const OFFLINE_GRACE_DAYS = 7
/** Start warning this many days before expiry. */
const WARN_WITHIN_DAYS = 7

type Cached = {
  plan: string
  status: string
  endDate: string
  fetchedAt: number
}

interface SubscriptionContextType {
  loading: boolean
  plan: string | null
  status: string | null
  endDate: string | null
  /** Writes are permitted — mirrors org_can_write() in the database. */
  canWrite: boolean
  /** Days until expiry. Negative once expired. */
  daysRemaining: number | null
  expiringSoon: boolean
  /** True when running on a cached licence because the server was unreachable. */
  usingCache: boolean
  refresh: () => Promise<void>
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined)

function daysBetween(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000)
}

const supabase = createClient()

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { currentShopId, loading: roleLoading } = useRole()

  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [endDate, setEndDate] = useState<string | null>(null)
  const [usingCache, setUsingCache] = useState(false)

  const apply = useCallback((row: Cached | null, fromCache: boolean) => {
    setPlan(row?.plan ?? null)
    setStatus(row?.status ?? null)
    setEndDate(row?.endDate ?? null)
    setUsingCache(fromCache)
  }, [])

  const refresh = useCallback(async () => {
    if (!currentShopId) {
      apply(null, false)
      setLoading(false)
      return
    }

    const cacheKey = CACHE_PREFIX + currentShopId

    const { data, error } = await supabase
      .from("subscriptions")
      .select("plan, status, end_date")
      .eq("organization_id", currentShopId)
      .maybeSingle()

    if (!error && data) {
      const row: Cached = {
        plan: data.plan,
        status: data.status,
        endDate: data.end_date,
        fetchedAt: Date.now(),
      }
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(row))
      } catch {
        // Storage full or disabled — the live value still applies.
      }
      apply(row, false)
      setLoading(false)
      return
    }

    // Couldn't reach the server. Fall back to the last known licence so
    // a network blip doesn't lock a paying shop out of its own till.
    try {
      const raw = window.localStorage.getItem(cacheKey)
      if (raw) {
        const cached: Cached = JSON.parse(raw)
        const ageDays = daysBetween(new Date(cached.fetchedAt), new Date())
        if (ageDays <= OFFLINE_GRACE_DAYS) {
          apply(cached, true)
          setLoading(false)
          return
        }
      }
    } catch {
      // Unreadable cache is treated as no cache.
    }

    apply(null, false)
    setLoading(false)
  }, [currentShopId, apply])

  useEffect(() => {
    if (roleLoading) return
    refresh()
  }, [roleLoading, refresh])

  const daysRemaining = endDate ? daysBetween(new Date(), new Date(endDate)) : null

  // Mirrors org_subscription_active(): active status AND not past expiry.
  const canWrite = status === "active" && daysRemaining !== null && daysRemaining > 0

  const value: SubscriptionContextType = {
    loading,
    plan,
    status,
    endDate,
    canWrite,
    daysRemaining,
    expiringSoon:
      canWrite && daysRemaining !== null && daysRemaining <= WARN_WITHIN_DAYS,
    usingCache,
    refresh,
  }

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
}

export function useSubscription(): SubscriptionContextType {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) {
    // Fail open for display purposes only. The database is the actual
    // boundary, so an unwrapped consumer cannot grant anyone access.
    return {
      loading: false,
      plan: null,
      status: null,
      endDate: null,
      canWrite: true,
      daysRemaining: null,
      expiringSoon: false,
      usingCache: false,
      refresh: async () => {},
    }
  }
  return ctx
}
