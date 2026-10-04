"use client"

import { useCallback, useEffect, useRef } from "react"

/**
 * Keyboard helpers for high-throughput data entry.
 *
 * At a busy till, reaching for the mouse between every field is the
 * single biggest time cost. These hooks let a form be driven entirely
 * from the keyboard while leaving normal mouse use untouched.
 */

type Focusable = HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | HTMLSelectElement

/**
 * Enter moves to the next field instead of submitting the form.
 *
 * Usage:
 *   const flow = useFieldFlow()
 *   <Input {...flow.field(0)} />
 *   <Input {...flow.field(1)} />
 *   <Input {...flow.field(2, { onEnter: submit })} />   // last field acts
 */
export function useFieldFlow() {
  const refs = useRef<(Focusable | null)[]>([])

  const focusIndex = useCallback((index: number) => {
    const el = refs.current[index]
    if (!el) return false
    el.focus()
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // Select existing text so typing replaces it — what a cashier
      // correcting a quantity expects.
      el.select?.()
    }
    return true
  }, [])

  const field = useCallback(
    (index: number, opts: { onEnter?: () => void; skip?: boolean } = {}) => ({
      ref: (el: Focusable | null) => {
        refs.current[index] = el
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        // Enter during IME composition confirms the candidate word, so
        // it must not also advance the form.
        if (e.key !== "Enter" || e.nativeEvent?.isComposing) return
        // Shift+Enter always means "newline" — it must never advance or
        // submit, or multi-line notes become impossible to type.
        if (e.shiftKey) return
        // Let textareas keep their newline behaviour unless told otherwise.
        if (e.currentTarget instanceof HTMLTextAreaElement && !opts.onEnter) return
        e.preventDefault()
        if (opts.onEnter) {
          opts.onEnter()
          return
        }
        // Walk forward to the next focusable field.
        for (let i = index + 1; i < refs.current.length; i++) {
          if (refs.current[i] && !refs.current[i]!.hasAttribute("disabled")) {
            if (focusIndex(i)) return
          }
        }
      },
    }),
    [focusIndex]
  )

  return { field, focusIndex, refs }
}

/**
 * Detects a barcode scanner as distinct from a human typing.
 *
 * Scanners emit characters in a burst — typically under ~35ms apart —
 * and most append Enter. Humans are far slower. That gap lets us fire
 * the lookup automatically the moment a scan lands, so the cashier
 * never touches a "Load" button.
 *
 * Works with scanners that send a trailing Enter and those that don't.
 */
export function useBarcodeScanner({
  onScan,
  minLength = 1,
  scannerRunThreshold = 3,
  maxKeyIntervalMs = 35,
  idleMs = 80,
  manualDebounceMs = 550,
  enabled = true,
}: {
  onScan: (code: string) => void
  /** Shortest code worth looking up. Shops often use codes like "1". */
  minLength?: number
  /** Consecutive fast keystrokes before input counts as a scanner. */
  scannerRunThreshold?: number
  maxKeyIntervalMs?: number
  /** Quiet period after a scanner burst before firing. */
  idleMs?: number
  /** Quiet period after a person stops typing before firing. */
  manualDebounceMs?: number
  enabled?: boolean
}) {
  const lastKeyAt = useRef(0)
  const fastRun = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The last code actually sent, so pausing mid-type or adding a digit
  // to an already-looked-up code cannot fire the same request twice.
  const lastFiredRef = useRef("")
  const onScanRef = useRef(onScan)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  const clearIdle = () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current)
      idleTimer.current = null
    }
  }

  useEffect(() => clearIdle, [])

  /** Attach to the barcode input's onKeyDown. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!enabled) return

      // Synthetic keydown events (autofill, some password managers) can
      // arrive with no `key`, and IME composition keystrokes are not
      // scanner input.
      const key = typeof e.key === "string" ? e.key : ""
      if (!key || e.nativeEvent?.isComposing) return

      const now = Date.now()
      const gap = now - lastKeyAt.current
      lastKeyAt.current = now

      if (key === "Enter") {
        clearIdle()
        fastRun.current = 0
        const value = e.currentTarget.value.trim()
        if (value.length >= minLength) {
          e.preventDefault()
          lastFiredRef.current = value
          onScanRef.current(value)
        }
        return
      }

      if (key.length === 1) {
        fastRun.current = gap <= maxKeyIntervalMs ? fastRun.current + 1 : 0
      }
    },
    [enabled, minLength, maxKeyIntervalMs]
  )

  /**
   * Attach to the barcode input's onChange, after your own setState.
   *
   * Fires the lookup once input goes quiet, so nothing has to be
   * clicked. Two speeds, because the two input styles differ:
   *
   *   scanner  a burst of keystrokes, then fire almost immediately
   *   typing   wait until the person actually stops, so a 6-digit
   *            barcode is one request instead of one per character
   *
   * Repeats of the same code are dropped, so pausing mid-barcode and
   * carrying on never sends a duplicate.
   */
  const onChange = useCallback(
    (value: string) => {
      if (!enabled) return
      clearIdle()

      const code = value.trim()

      // Field cleared (or too short to be a barcode): reset, so the
      // same item can be scanned again on the next line.
      if (code.length < minLength) {
        lastFiredRef.current = ""
        fastRun.current = 0
        return
      }

      const cameFromScanner = fastRun.current >= scannerRunThreshold

      idleTimer.current = setTimeout(
        () => {
          fastRun.current = 0
          if (code === lastFiredRef.current) return
          lastFiredRef.current = code
          onScanRef.current(code)
        },
        cameFromScanner ? idleMs : manualDebounceMs
      )
    },
    [enabled, idleMs, manualDebounceMs, minLength, scannerRunThreshold]
  )

  return { onKeyDown, onChange }
}

/**
 * Application-wide shortcut keys.
 *
 * Ignores keystrokes aimed at a text field unless the binding opts in,
 * so typing a customer's name never triggers an action.
 */
export function useHotkeys(
  bindings: Record<string, (e: KeyboardEvent) => void>,
  { enabled = true, allowInInputs = [] as string[] } = {}
) {
  const bindingsRef = useRef(bindings)
  useEffect(() => {
    bindingsRef.current = bindings
  }, [bindings])

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // `key` is absent on some synthetic keydown events — browser
      // autofill and several password managers dispatch them — and on
      // IME composition keystrokes, which should never trigger a
      // shortcut anyway.
      const key = typeof e.key === "string" ? e.key : ""
      if (!key || e.isComposing) return

      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push("ctrl")
      if (e.altKey) parts.push("alt")
      if (e.shiftKey && key.length > 1) parts.push("shift")
      parts.push(key.toLowerCase())
      const combo = parts.join("+")

      const action = bindingsRef.current[combo]
      if (!action) return

      // A modal dialog owns the keyboard for as long as it is open.
      //
      // Without this the shortcuts fire straight through it: Esc closes
      // the dialog AND clears the product row behind it, F4 opens the
      // calculator on top of whatever is being confirmed, and F9 starts
      // another sale from underneath a confirmation about the current
      // one. Checking the document rather than the event target covers
      // the moment before focus has settled inside the dialog.
      if (
        typeof document !== "undefined" &&
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
        )
      ) {
        return
      }

      const target = e.target as HTMLElement | null
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)

      if (inField && !allowInInputs.includes(combo)) return

      e.preventDefault()
      action(e)
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [enabled, allowInInputs])
}
