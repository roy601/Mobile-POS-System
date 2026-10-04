"use client"

import { useEffect } from "react"

/**
 * Stops the mouse wheel silently editing money.
 *
 * THE BUG THIS FIXES
 *
 * A manager typed 22406 into Bank transfer and the sale saved 22405.99.
 * Not a rounding error and not floating point: every money box on this
 * system is <input type="number" step="0.01">, and a number input that
 * HAS FOCUS changes by one step when the wheel turns over it. Scrolling
 * the page with the pointer still resting on the box you just typed
 * into takes exactly 0.01 off — which is precisely the difference that
 * was reported, and precisely how a 1-paisa due appears on a sale that
 * was paid in full.
 *
 * The damage is out of all proportion to the cause. A penny of dues
 * makes a paid invoice look unpaid, puts it on the customer's account,
 * and — before script 83 — made the sale uneditable, because something
 * had been "part-paid" against it.
 *
 * WHY GLOBAL RATHER THAN PER FIELD
 *
 * There are 46 number inputs across 15 screens, on every path that
 * touches money: the till, expenses, income, purchase vouchers,
 * returns, stock prices. Fixing the one that was reported would leave
 * the same trap set on the other 45.
 *
 * WHY preventDefault AND NOT blur()
 *
 * Blurring the field is the common fix and it works, but it throws the
 * cashier out of the box they are typing in mid-sale. Cancelling the
 * event leaves focus alone: the page still scrolls, because the
 * listener only cancels when the wheel is over the focused number box
 * itself.
 *
 * Typing, arrow keys and the spinner arrows are all untouched. Those
 * are deliberate.
 */
export function NumberInputGuard() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null
      if (!(target instanceof HTMLInputElement)) return
      if (target.type !== "number") return
      // Only while it is focused — that is the only time the browser
      // would have changed the value, and cancelling otherwise would
      // stop the page scrolling over an ordinary field.
      if (document.activeElement !== target) return

      event.preventDefault()
    }

    // passive: false, or preventDefault is ignored and the value still
    // moves. Wheel listeners default to passive in every current
    // browser.
    document.addEventListener("wheel", onWheel, { passive: false })
    return () => document.removeEventListener("wheel", onWheel)
  }, [])

  return null
}
