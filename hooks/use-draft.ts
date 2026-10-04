"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * A piece of half-finished work that survives leaving the page.
 *
 * THE PROBLEM
 *
 * Every screen in this app is a Next.js page, and a page is unmounted
 * the moment you navigate away from it. A manager half way through
 * ringing up a sale who steps over to Inventory to check a price comes
 * back to an empty till and starts again. The same is true of a
 * purchase voucher with nine handsets scanned onto it, a return with a
 * supplier and four units chosen, an expense with everything but the
 * amount. It happens dozens of times a day and it is entirely the
 * software's fault.
 *
 * WHY localStorage AND NOT A CONTEXT
 *
 * A provider mounted above the router would survive navigation but not
 * a reload, and the app is an Electron window that gets closed by
 * accident. localStorage survives both, costs nothing, and needs no
 * plumbing through components that have no business knowing about it.
 *
 * WHAT KEEPS IT SAFE
 *
 * Two things, and they matter more than the convenience:
 *
 *   SCOPE — the key carries the shop id, so a draft started in Star
 *   Power 01 can never reappear in Star Power 02. Restoring a cart
 *   against the wrong shop's stock is worse than losing it.
 *
 *   AGE — a draft older than the window is discarded on sight. A cart
 *   from last Tuesday restoring itself into today's till is not a
 *   convenience, it is a mis-sale waiting to happen, and the prices in
 *   it are stale anyway.
 *
 * Anything that has been SAVED must clear its draft; that is the
 * caller's job, and every caller here does it on success.
 */

const PREFIX = "mobilepos:draft:"

/** How long a half-finished screen is worth keeping. */
const DEFAULT_TTL_MINUTES = 12 * 60

type Stored<T> = { savedAt: number; value: T }

function read<T>(key: string, ttlMinutes: number): T | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return undefined

    const parsed = JSON.parse(raw) as Stored<T>
    if (!parsed || typeof parsed.savedAt !== "number") return undefined

    if (Date.now() - parsed.savedAt > ttlMinutes * 60_000) {
      window.localStorage.removeItem(key)
      return undefined
    }
    return parsed.value
  } catch {
    // Corrupt or unreadable. A lost draft is a small annoyance; a
    // screen that will not open because of one is not.
    return undefined
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return
  try {
    const payload: Stored<T> = { savedAt: Date.now(), value }
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Quota, private mode, a value that will not serialise. None of
    // these are worth interrupting the sale for.
  }
}

/**
 * useState, except it comes back after you leave the page.
 *
 *   const [cart, setCart, clearCart] = useDraft("pos.cart", [], shopId)
 *
 * `scope` is the shop id. While it is null — which it is until the
 * session resolves — nothing is read or written, so a draft is never
 * stored against "no shop" and never restored into the wrong one.
 *
 * `revive` is the last word on what comes back. A form that carries a
 * date needs it: the draft is rewritten every time the form is
 * touched, so its TTL never expires on a screen in daily use, and a
 * date typed once outlives the day it was typed on. Star Power 02 paid
 * Ali Accessories 11,700 on 22 September and the expense filed itself
 * under 1 September — the date the drawer had last been opened on —
 * where the Day Cashbook for the 22nd could not see it. Fields like
 * that are put back to today here, on the way out of storage.
 */
export function useDraft<T>(
  name: string,
  initial: T,
  scope: string | null | undefined,
  ttlMinutes: number = DEFAULT_TTL_MINUTES,
  revive?: (saved: T) => T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(initial)

  const key = scope ? `${PREFIX}${scope}:${name}` : null

  // Restored on mount rather than in the initial state, so the server
  // and the first client render agree. React would otherwise complain
  // about hydration, and in a Next.js app that is not a warning to
  // ignore — it silently discards the mismatched tree.
  const restored = useRef<string | null>(null)

  // Held in a ref so a caller can pass an inline function without the
  // restore re-running on every render.
  const reviveRef = useRef(revive)
  reviveRef.current = revive

  useEffect(() => {
    if (!key || restored.current === key) return
    restored.current = key

    const saved = read<T>(key, ttlMinutes)
    if (saved !== undefined) setValue(reviveRef.current ? reviveRef.current(saved) : saved)
  }, [key, ttlMinutes])

  // Written on every change, but only once the restore has happened
  // for this key. Without that guard the empty initial state would be
  // written over the saved draft on the first render and the draft
  // would be gone before it was ever read.
  useEffect(() => {
    if (!key || restored.current !== key) return
    write(key, value)
  }, [key, value])

  const clear = useCallback(() => {
    setValue(initial)
    if (!key || typeof window === "undefined") return
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* nothing worth doing */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return [value, setValue, clear]
}

/**
 * Throw away every draft belonging to a shop.
 *
 * For the end of a sale, and for anything else that means "this screen
 * is finished with" — a caller that cleared only some of its drafts
 * would leave the rest to reappear behind the next customer.
 */
export function clearDrafts(scope: string | null | undefined, names?: string[]) {
  if (typeof window === "undefined" || !scope) return
  try {
    if (names && names.length > 0) {
      for (const n of names) window.localStorage.removeItem(`${PREFIX}${scope}:${n}`)
      return
    }
    const prefix = `${PREFIX}${scope}:`
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(prefix)) doomed.push(k)
    }
    for (const k of doomed) window.localStorage.removeItem(k)
  } catch {
    /* nothing worth doing */
  }
}
