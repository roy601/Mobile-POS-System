"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"
import { useToast } from "@/hooks/use-toast"
import { BANK_ACCOUNTS } from "@/lib/utils/bank-accounts"

const supabase = createClient()

export type PaymentRouteValue = {
  /** cash | bank_transfer | mobile_banking */
  method: string
  /** Only for bank_transfer. */
  bankName: string
  /** The method within the route — Card, PULM, bKash. Empty for cash. */
  channel: string
}

export const EMPTY_ROUTE: PaymentRouteValue = { method: "cash", bankName: "", channel: "" }

/**
 * A payment line added to a split. The first part of a split is almost
 * always the cash handed over at the counter and the rest goes through
 * a bank, so the added line starts there rather than at Cash again.
 */
export const ADDED_ROUTE: PaymentRouteValue = { method: "bank_transfer", bankName: "", channel: "" }

/**
 * Each line of a split payment in its own colour, so at speed the eye
 * finds Payment 2's amount without reading the headings. Light enough
 * that the fields on it still read as fields; a strip down the left
 * edge carries the colour when the tint is hard to see.
 */
const LINE_TINTS = [
  { box: "bg-sky-50 border-sky-200 border-l-sky-500 dark:bg-sky-950/30 dark:border-sky-900 dark:border-l-sky-500", label: "text-sky-700 dark:text-sky-300" },
  { box: "bg-violet-50 border-violet-200 border-l-violet-500 dark:bg-violet-950/30 dark:border-violet-900 dark:border-l-violet-500", label: "text-violet-700 dark:text-violet-300" },
  { box: "bg-amber-50 border-amber-200 border-l-amber-500 dark:bg-amber-950/30 dark:border-amber-900 dark:border-l-amber-500", label: "text-amber-700 dark:text-amber-300" },
  { box: "bg-emerald-50 border-emerald-200 border-l-emerald-500 dark:bg-emerald-950/30 dark:border-emerald-900 dark:border-l-emerald-500", label: "text-emerald-700 dark:text-emerald-300" },
  { box: "bg-rose-50 border-rose-200 border-l-rose-500 dark:bg-rose-950/30 dark:border-rose-900 dark:border-l-rose-500", label: "text-rose-700 dark:text-rose-300" },
] as const

/**
 * What a new line of a split should start at: whatever the lines so far
 * leave unpaid. The cashier types the cash, presses Add payment, and the
 * rest is already in the box -- correct it only if it is not all going
 * that way. Never negative: an overpaid split starts the new line at 0.
 */
export function leftToPay(total: number, lines: { amount?: number | string | null }[]) {
  const paid = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
  return Math.max(0, Math.round((total - paid) * 100) / 100)
}

/**
 * Bring the payment line just added into view.
 *
 * Adding a line puts it below the fold on a till screen, and the cashier
 * had to scroll down to reach the bank and amount. Waits a frame so the
 * new line exists, then scrolls it to the middle of the screen. `group`
 * matches the data-pay-line attribute on that screen's lines.
 */
export function revealNewPaymentLine(group: string) {
  requestAnimationFrame(() => {
    const lines = document.querySelectorAll<HTMLElement>(`[data-pay-line="${group}"]`)
    lines[lines.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}

/** The box and heading classes for the i-th line of a split payment. */
export function paymentLineTint(i: number) {
  const t = LINE_TINTS[i % LINE_TINTS.length]
  return {
    box: `space-y-2 rounded-md border border-l-4 p-3 ${t.box}`,
    label: `text-xs font-semibold ${t.label}`,
  }
}

type MethodRow = { id: number; scope: "bank" | "mobile"; bank_name: string | null; name: string }

/**
 * How a payment was made: cash, or through a bank, or by mobile banking.
 *
 * Banks are fixed — their names appear on printed reports going back
 * months, so they are not editable from the counter. The METHODS under
 * each bank are the shop's own: a manager can add "PULM" to BRAC the
 * moment the bank enables it, without waiting for a release.
 *
 * Used by the POS, Dues, Expenses and Income so that a payment recorded
 * on one screen reconciles against one recorded on another. When these
 * screens each had their own idea of a payment method, mobile-banking
 * money ended up in a column no report read, and disappeared from the
 * books entirely.
 */
export function usePaymentMethods() {
  const { currentShopId } = useRole()
  const [rows, setRows] = useState<MethodRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!currentShopId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id, scope, bank_name, name")
        .eq("organization_id", currentShopId)
        .order("name")
      if (error) throw error
      setRows((data ?? []) as MethodRow[])
    } catch (err: any) {
      console.error("Could not load payment methods:", err?.message ?? err)
    } finally {
      setLoading(false)
    }
  }, [currentShopId])

  useEffect(() => {
    load()
  }, [load])

  return { rows, loading, reload: load }
}

export function PaymentRoute({
  value,
  onChange,
  methods,
  reloadMethods,
  idPrefix = "route",
  disabled,
  allowSplit = false,
}: {
  value: PaymentRouteValue
  onChange: (next: PaymentRouteValue) => void
  methods: MethodRow[]
  reloadMethods: () => void
  idPrefix?: string
  disabled?: boolean
  /** Offers "Split Payment" alongside the others. The parent watches
   *  for method === "split" and switches to per-line entry. */
  allowSplit?: boolean
}) {
  const { currentShopId, accountType } = useRole()
  const { toast } = useToast()
  const isOwner = accountType === "owner"

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)

  const bankMethods = useMemo(
    () => methods.filter((m) => m.scope === "bank" && m.bank_name === value.bankName),
    [methods, value.bankName]
  )
  const mobileMethods = useMemo(() => methods.filter((m) => m.scope === "mobile"), [methods])

  const available = value.method === "bank_transfer" ? bankMethods : mobileMethods

  const addMethod = async () => {
    const name = newName.trim()
    if (!name || !currentShopId) return
    if (value.method === "bank_transfer" && !value.bankName) {
      toast({ title: "Choose a bank first", variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.from("payment_methods").insert({
        organization_id: currentShopId,
        scope: value.method === "bank_transfer" ? "bank" : "mobile",
        bank_name: value.method === "bank_transfer" ? value.bankName : null,
        name,
      })
      // Already there — treat as chosen rather than as a failure.
      if (error && error.code !== "23505") throw error

      await reloadMethods()
      onChange({ ...value, channel: name })
      setNewName("")
      setAdding(false)
    } catch (err: any) {
      toast({
        title: "Could not add it",
        description: err?.message ?? "The method could not be saved.",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  const removeMethod = async (row: MethodRow) => {
    if (!currentShopId) return
    setBusy(true)
    try {
      const { error } = await supabase
        .from("payment_methods")
        .delete()
        .eq("id", row.id)
        .eq("organization_id", currentShopId)
      if (error) throw error
      if (value.channel === row.name) onChange({ ...value, channel: "" })
      await reloadMethods()
      toast({
        title: "Removed",
        description: `"${row.name}" is no longer offered. Past entries that used it are unchanged.`,
      })
    } catch (err: any) {
      toast({
        title: "Could not remove it",
        description: err?.message ?? "Only the shop owner can remove a payment method.",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-method`}>Payment Method</Label>
        <Select
          value={value.method}
          disabled={disabled}
          onValueChange={(m) =>
            // Clearing bank and channel matters: switching from a bank
            // route to cash would otherwise leave a bank attached to a
            // cash payment.
            onChange({ method: m, bankName: "", channel: "" })
          }
        >
          <SelectTrigger id={`${idPrefix}-method`}>
            <SelectValue placeholder="Select payment method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
            <SelectItem value="mobile_banking">Mobile Banking</SelectItem>
            {allowSplit && <SelectItem value="split">Split Payment</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {value.method === "bank_transfer" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-bank`}>Bank</Label>
          <Select
            value={value.bankName}
            disabled={disabled}
            onValueChange={(b) => onChange({ ...value, bankName: b, channel: "" })}
          >
            <SelectTrigger id={`${idPrefix}-bank`}>
              <SelectValue placeholder="Select bank" />
            </SelectTrigger>
            <SelectContent>
              {BANK_ACCOUNTS.map((b) => (
                <SelectItem key={b.id} value={b.bankName}>
                  {b.bankName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(value.method === "mobile_banking" ||
        (value.method === "bank_transfer" && value.bankName)) && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${idPrefix}-channel`}>
              {value.method === "bank_transfer" ? "Method" : "Service"}
            </Label>
            {!adding && !disabled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setAdding(true)}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            )}
          </div>

          {adding ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={newName}
                placeholder={value.method === "bank_transfer" ? "e.g. PULM" : "e.g. Upay"}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addMethod()
                  }
                  if (e.key === "Escape") {
                    setAdding(false)
                    setNewName("")
                  }
                }}
              />
              <Button type="button" onClick={addMethod} disabled={busy || !newName.trim()}>
                Add
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAdding(false)
                  setNewName("")
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <Select
                value={value.channel}
                disabled={disabled}
                onValueChange={(c) => onChange({ ...value, channel: c })}
              >
                <SelectTrigger id={`${idPrefix}-channel`}>
                  <SelectValue
                    placeholder={
                      available.length === 0 ? "None yet — use Add" : "Select method"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {available.map((m) => (
                    <SelectItem key={m.id} value={m.name}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Owner only: removing a method that historical entries
                  refer to is a bookkeeping decision, not a counter one. */}
              {isOwner && available.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {available.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={busy}
                      onClick={() => removeMethod(m)}
                      title={`Remove ${m.name} from the list`}
                      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                    >
                      {m.name}
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export type PaymentLine = PaymentRouteValue & { amount: number }

/**
 * Fold payment lines back into the fixed columns on `sales`.
 *
 * Day Cashbook, Ledger and Bank Info all read those columns today. The
 * lines are the truthful record — they can hold BRAC-Card and
 * City-Card on one sale, which the columns cannot — but until every
 * report reads the lines, both are written so nothing silently stops
 * reporting.
 *
 * A bank route is filed under the provider its method names, so a
 * payment through BRAC's bKash still lands in bkash_received where the
 * reports look for it. Anything unrecognised falls to bank_transfer
 * rather than being dropped: an unknown method is still money.
 */
export function toLegacyTotals(lines: PaymentLine[]) {
  const totals = {
    cash: 0,
    card: 0,
    bkash: 0,
    nagad: 0,
    rocket: 0,
    upay: 0,
    bank_transfer: 0,
  }

  for (const line of lines) {
    const amount = Number(line.amount) || 0
    if (amount <= 0) continue

    if (line.method === "cash") {
      totals.cash += amount
      continue
    }

    const channel = (line.channel || "").toLowerCase()
    if (channel.includes("bkash")) totals.bkash += amount
    else if (channel.includes("nagad")) totals.nagad += amount
    else if (channel.includes("rocket")) totals.rocket += amount
    else if (channel.includes("upay")) totals.upay += amount
    else if (channel.includes("card")) totals.card += amount
    else totals.bank_transfer += amount
  }

  return totals
}

/** The first bank named by a card / transfer line, for the legacy
 *  single-bank columns. */
export function firstBankFor(lines: PaymentLine[], kind: "card" | "transfer") {
  const match = lines.find((l) => {
    if (l.method !== "bank_transfer" || !l.bankName || (Number(l.amount) || 0) <= 0) return false
    const isCard = (l.channel || "").toLowerCase().includes("card")
    return kind === "card" ? isCard : !isCard
  })
  return match?.bankName ?? ""
}

/** How this route reads on a cashbook or report line. */
export function describeRoute(route: PaymentRouteValue): string {
  if (route.method === "cash") return "Cash"
  if (route.method === "bank_transfer") {
    return [route.bankName, route.channel].filter(Boolean).join(" - ")
  }
  return route.channel || "Mobile Banking"
}
