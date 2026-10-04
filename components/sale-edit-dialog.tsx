"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Save, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ADDED_ROUTE,
  leftToPay,
  revealNewPaymentLine,
  paymentLineTint,
  EMPTY_ROUTE,
  firstBankFor,
  PaymentRoute,
  toLegacyTotals,
  usePaymentMethods,
  type PaymentLine,
  type PaymentRouteValue,
} from "@/components/payment-route"
import { createClient } from "@/utils/supabase/component"
import { useToast } from "@/hooks/use-toast"
import { useRole } from "@/components/role-provider"

const supabase = createClient()

/**
 * An older sale, read back as payment lines.
 *
 * Sales rung up before payment lines existed have only the seven
 * columns. A wallet column names its own channel; card and transfer
 * carry the single bank the row could hold. It is the best that can be
 * recovered, and the owner can correct it here — which is the point of
 * the screen.
 */
function linesFromColumns(s: any): PaymentLine[] {
  const out: PaymentLine[] = []
  const add = (line: PaymentLine) => {
    if (line.amount > 0) out.push(line)
  }

  add({ method: "cash", bankName: "", channel: "", amount: Number(s.cash_received) || 0 })
  // No channel: the column says a card was used, not WHICH of the
  // shop's methods it was ("Card Payment", "Bangla Q.R"). Left empty so
  // the owner picks the real one rather than the screen inventing a
  // name that matches nothing in the list.
  add({
    method: "bank_transfer",
    bankName: s.card_bank ?? "",
    channel: "",
    amount: Number(s.card_received) || 0,
  })
  add({
    method: "bank_transfer",
    bankName: s.bank_transfer_bank ?? "",
    channel: "",
    amount: Number(s.bank_transfer_received) || 0,
  })
  for (const [column, channel] of [
    ["bkash_received", "bKash"],
    ["nagad_received", "Nagad"],
    ["rocket_received", "Rocket"],
    ["upay_received", "Upay"],
  ] as const) {
    add({ method: "mobile_banking", bankName: "", channel, amount: Number(s[column]) || 0 })
  }

  return out
}

type Line = {
  id: number
  barcode: string | null
  product_name: string
  model_number: string | null
  variant: string | null
  color: string | null
  brand: string | null
  category: string | null
  is_gift: boolean
  qty: string
  price: string
  discount: string
  /** The supplier promo this line was sold on, carried through the
      edit untouched. The owner is correcting what the customer paid,
      not renegotiating with the supplier — and dropping it here would
      quietly cancel the claim on a handset that really did go out on
      the promo. */
  promo_id: number | null
  promo_amount: number
}

const money = (n: number) =>
  `৳${(Number(n) || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const num = (v: string) => Number(v) || 0

/**
 * Correcting a sale that was already rung up.
 *
 * OWNER ONLY, and the database says so too — this dialog is
 * convenience, not the guard. edit_sale refuses a manager outright.
 *
 * The editable fields are the ones that actually get typed wrong at a
 * counter: the quantity, the price, the discount, the date, and how the
 * money was taken. The product itself is not editable — swapping a
 * handset for a different one is not a correction, it is a different
 * sale, and the stock movements would be a fiction.
 *
 * Saving reverses the original sale in full and re-records it through
 * the same function the till uses, so stock, dues, the cashbook, the
 * ledger and Bank Info all follow without being told separately.
 */
export function SaleEditDialog({
  saleId,
  open,
  onOpenChange,
  onSaved,
}: {
  saleId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const { currentShopId } = useRole()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [invoice, setInvoice] = useState<string | null>(null)
  const [saleDate, setSaleDate] = useState("")
  const [customer, setCustomer] = useState<{
    id: number | null
    name: string | null
    phone: string | null
    email: string | null
  } | null>(null)
  const [previousDues, setPreviousDues] = useState(0)
  const [lines, setLines] = useState<Line[]>([])
  // How the money came in, entered exactly as it is at the till: one
  // route, or Split Payment for a list of them. The old fixed boxes
  // could not say WHICH bank a card went through, and offered no way to
  // correct a sale the manager had rung up as cash.
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods()
  const [payRoute, setPayRoute] = useState<PaymentRouteValue>(EMPTY_ROUTE)
  const [payAmount, setPayAmount] = useState(0)
  const [payLines, setPayLines] = useState<PaymentLine[]>([])

  /** The lines as they will be stored, whichever way they were entered. */
  const paymentLines: PaymentLine[] =
    payRoute.method === "split"
      ? payLines.filter((l) => (Number(l.amount) || 0) > 0)
      : payAmount > 0
        ? [{ ...payRoute, amount: payAmount }]
        : []

  const load = useCallback(async () => {
    if (!saleId || !currentShopId) return
    setLoading(true)
    try {
      // The promo columns arrive with script 98. A shop that has not
      // run it yet must still be able to correct a sale, so the read
      // is tried with them and repeated without if the database has
      // never heard of them.
      const read = (soldColumns: string) =>
        supabase
          .from("sales")
          .select(
            `id, invoice_number, sale_date, previous_dues,
           cash_received, card_received, bkash_received, nagad_received,
           rocket_received, upay_received, bank_transfer_received,
           card_bank, bank_transfer_bank,
           sale_payments ( method, bank_name, channel, amount ),
           sale_customers ( customer_id, customer_name, customer_phone, customer_email ),
           sold_products ( ${soldColumns} )`,
          )
          .eq("organization_id", currentShopId)
          .eq("id", saleId)
          .single()

      const SOLD = `id, barcode, product_name, model_number, variant, color,
                    brand, category, is_gift, quantity, unit_price, discount_amount`

      let { data, error } = await read(`${SOLD}, promo_id, promo_amount`)

      if (error && (error.code === "42703" || /promo/i.test(error.message ?? ""))) {
        ;({ data, error } = await read(SOLD))
      }

      if (error) throw error

      const s = data as any
      setInvoice(s.invoice_number ?? null)
      setSaleDate(String(s.sale_date ?? "").slice(0, 10))
      setPreviousDues(Number(s.previous_dues) || 0)

      const sc = Array.isArray(s.sale_customers) ? s.sale_customers[0] : s.sale_customers
      setCustomer(
        sc
          ? {
              id: sc.customer_id ?? null,
              name: sc.customer_name ?? null,
              phone: sc.customer_phone ?? null,
              email: sc.customer_email ?? null,
            }
          : null,
      )

      setLines(
        ((s.sold_products ?? []) as any[])
          .sort((a, b) => a.id - b.id)
          .map((p) => ({
            id: p.id,
            barcode: p.barcode ?? null,
            product_name: p.product_name,
            model_number: p.model_number ?? null,
            variant: p.variant ?? null,
            color: p.color ?? null,
            brand: p.brand ?? null,
            category: p.category ?? null,
            is_gift: !!p.is_gift,
            qty: String(Number(p.quantity) || 0),
            price: String(Number(p.unit_price) || 0),
            discount: String(Number(p.discount_amount) || 0),
            // Absent on a database without script 98, and on every
            // sale rung up before it: null and 0 mean "no promo".
            promo_id: p.promo_id ?? null,
            promo_amount: Number(p.promo_amount) || 0,
          })),
      )

      // sale_payments is the truthful record — it can hold BRAC-Card
      // and City-Card on one sale, which the columns cannot. Only a
      // sale rung up before payment lines existed falls back to them.
      const recorded = ((s.sale_payments ?? []) as any[])
        .map((l) => ({
          method: l.method === "cash" ? "cash" : (l.method ?? "cash"),
          bankName: l.bank_name ?? "",
          channel: l.channel ?? "",
          amount: Number(l.amount) || 0,
        }))
        .filter((l) => l.amount > 0)

      const restored = recorded.length > 0 ? recorded : linesFromColumns(s)

      if (restored.length > 1) {
        setPayRoute({ ...EMPTY_ROUTE, method: "split" })
        setPayLines(restored)
        setPayAmount(0)
      } else {
        const only = restored[0]
        setPayRoute(only ? { method: only.method, bankName: only.bankName, channel: only.channel } : EMPTY_ROUTE)
        setPayAmount(only?.amount ?? 0)
        setPayLines([])
      }
    } catch (err: any) {
      console.error("Could not load the sale:", err)
      toast({
        title: "Could not load the sale",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      })
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }, [saleId, currentShopId, toast, onOpenChange])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // The shop writes its own method names — "Bkash", not "bKash" — and a
  // dropdown only shows a value that matches one exactly. A sale stored
  // with the other spelling would open with an empty method box and
  // look unanswered, so the registered spelling is adopted as soon as
  // the list arrives.
  useEffect(() => {
    if (payMethods.length === 0) return
    const registered = (channel: string) =>
      payMethods.find((m) => m.name.toLowerCase() === channel.trim().toLowerCase())?.name
    const fix = (r: PaymentRouteValue) => {
      const match = r.channel ? registered(r.channel) : undefined
      return match && match !== r.channel ? { ...r, channel: match } : r
    }
    setPayRoute((prev) => fix(prev))
    setPayLines((prev) => {
      const next = prev.map((l) => ({ ...fix(l), amount: l.amount }))
      return next.some((l, i) => l.channel !== prev[i].channel) ? next : prev
    })
  }, [payMethods])

  // The same arithmetic complete_sale_core will apply, so the figures
  // on screen are the figures that get written.
  const totals = useMemo(() => {
    let subtotal = 0
    let discount = 0
    for (const l of lines) {
      const q = num(l.qty)
      subtotal += num(l.price) * q
      discount += num(l.discount) * q
    }
    const net = subtotal - discount
    const total = net + previousDues
    const taken = paymentLines.reduce((t, l) => t + (Number(l.amount) || 0), 0)
    return {
      subtotal,
      discount,
      net,
      total,
      received: taken,
      due: Math.max(0, total - taken),
      change: Math.max(0, taken - total),
    }
    // paymentLines is rebuilt on every render, so the pieces it is
    // built from are the dependencies.
  }, [lines, previousDues, payRoute, payAmount, payLines])

  const setLine = (id: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const save = async () => {
    if (!saleId || !currentShopId) return

    if (lines.length === 0) {
      toast({
        title: "Nothing on the sale",
        description: "A sale needs at least one line. Delete it instead.",
        variant: "destructive",
      })
      return
    }
    // The same guard the till applies. A bank route with no account or
    // no method named cannot be reconciled afterwards.
    const incomplete = paymentLines.find(
      (l) => l.method !== "cash" && (!l.channel || (l.method === "bank_transfer" && !l.bankName)),
    )
    if (incomplete) {
      toast({
        title: "Finish the payment",
        description:
          incomplete.method === "bank_transfer"
            ? "Choose the bank and the method it came through."
            : "Choose which mobile banking service it came through.",
        variant: "destructive",
      })
      return
    }
    if (lines.some((l) => num(l.qty) <= 0)) {
      toast({
        title: "Check the quantities",
        description: "Every line needs a quantity of 1 or more.",
        variant: "destructive",
      })
      return
    }

    setSaving(true)
    try {
      // Folded into the seven columns the same way the till folds them,
      // so a sale corrected here reads identically to one rung up right
      // the first time.
      const legacy = toLegacyTotals(paymentLines)

      const { data, error } = await supabase.rpc("edit_sale", {
        p_organization_id: currentShopId,
        p_sale_id: saleId,
        p_customer: {
          id: customer?.id ?? null,
          name: customer?.name ?? null,
          phone: customer?.phone ?? null,
          email: customer?.email ?? null,
        },
        p_items: lines.map((l) => ({
          barcode: l.barcode,
          name: l.product_name,
          model: l.model_number,
          variant: l.variant,
          color: l.color,
          brand: l.brand,
          category: l.category,
          quantity: num(l.qty),
          price: num(l.price),
          discount: num(l.discount),
          gift: l.is_gift,
          // Kept as it was sold. If the owner cuts the discount below
          // what the supplier funds, the claim follows the discount
          // down — the shop cannot claim more than it gave away.
          promo_id: l.promo_id,
          promo: Math.min(l.promo_amount, num(l.discount)),
        })),
        p_payments: {
          ...legacy,
          method:
            paymentLines.length > 1
              ? "split"
              : paymentLines[0]?.channel || paymentLines[0]?.method || "cash",
          card_bank: firstBankFor(paymentLines, "card"),
          bank_transfer_bank: firstBankFor(paymentLines, "transfer"),
          // Written again so Bank Info sees the corrected routing, not
          // the routing the sale had before it was edited.
          lines: paymentLines.map((l) => ({
            method: l.method,
            bank: l.bankName || null,
            channel: l.channel || null,
            amount: l.amount,
          })),
        },
        p_totals: {
          subtotal: totals.subtotal,
          discount: totals.discount,
          previous_dues: previousDues,
          net_amount: totals.net,
          total: totals.total,
          received: totals.received,
          change: totals.change,
          due: totals.due,
        },
        p_sale_date: saleDate || null,
      })

      if (error) {
        console.error("edit_sale failed:", error)
        toast({
          title: "Could not save the change",
          description: error.message,
          variant: "destructive",
        })
        return
      }

      const result = data as { success: boolean; message?: string } | null
      if (!result?.success) {
        toast({
          title: "Could not save the change",
          description: result?.message ?? "Nothing was changed.",
          variant: "destructive",
        })
        return
      }

      toast({
        title: `${invoice ?? "Sale"} updated`,
        description: "Stock, dues and every report have been brought in step.",
      })
      onOpenChange(false)
      onSaved()
    } catch (err: any) {
      console.error("Unexpected error:", err)
      toast({
        title: "Error",
        description: err?.message ?? "Unexpected error.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle>Edit {invoice ?? "sale"}</DialogTitle>
          <DialogDescription>
            {customer?.name ? `${customer.name} • ` : ""}
            Saving puts the original back and records it again, so stock and
            dues follow.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="se-date">Sale date</Label>
                <Input
                  id="se-date"
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Input readOnly tabIndex={-1} value={customer?.name ?? "—"} className="bg-muted" />
              </div>
              <div className="space-y-1.5">
                <Label>Previous dues carried on</Label>
                <Input
                  readOnly
                  tabIndex={-1}
                  value={money(previousDues)}
                  className="bg-muted tabular-nums"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>IME No</TableHead>
                    <TableHead className="w-[90px] text-right">Qty</TableHead>
                    <TableHead className="w-[130px] text-right">Unit price</TableHead>
                    <TableHead className="w-[130px] text-right">Discount / unit</TableHead>
                    <TableHead className="w-[120px] text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{l.product_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[l.brand, l.model_number, l.variant, l.color]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                          {l.is_gift && (
                            <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                              Gift
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.barcode || "—"}
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="numeric"
                          className="h-8 text-right tabular-nums"
                          value={l.qty}
                          onChange={(e) => setLine(l.id, { qty: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          value={l.price}
                          onChange={(e) => setLine(l.id, { price: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          value={l.discount}
                          onChange={(e) => setLine(l.id, { discount: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money((num(l.price) - num(l.discount)) * num(l.qty))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* How the money was taken — the till's own panel.
                
                A manager who rang a card sale up as cash is the reason
                this dialog exists, so the owner needs every route the
                till offers, not seven boxes with no bank behind them.
                Split Payment turns it into a list of lines, each with
                its own bank and method. */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Received</Label>

              <PaymentRoute
                idPrefix="se-pay"
                allowSplit
                value={payRoute}
                methods={payMethods}
                reloadMethods={reloadPayMethods}
                onChange={(next) => {
                  setPayRoute(next)
                  if (next.method === "split" && payLines.length === 0) {
                    // Carry what was already entered into the first
                    // line, so switching to Split does not throw away
                    // the amount the owner just typed.
                    setPayLines([
                      payAmount > 0
                        ? { ...EMPTY_ROUTE, amount: payAmount }
                        : { ...EMPTY_ROUTE, amount: 0 },
                    ])
                  }
                }}
              />

              {payRoute.method !== "split" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="se-pay-amount">Amount Received</Label>
                  <Input
                    id="se-pay-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="tabular-nums"
                    value={payAmount || ""}
                    onChange={(e) => setPayAmount(Number.parseFloat(e.target.value) || 0)}
                  />
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border p-3">
                  {payLines.map((line, i) => (
                    <div key={i} data-pay-line="edit" className={paymentLineTint(i).box}>
                      <div className="flex items-center justify-between">
                        <span className={paymentLineTint(i).label}>
                          Payment {i + 1}
                        </span>
                        {payLines.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            aria-label={`Remove payment ${i + 1}`}
                            onClick={() =>
                              setPayLines((prev) => prev.filter((_, idx) => idx !== i))
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <PaymentRoute
                        idPrefix={`se-line-${i}`}
                        value={line}
                        methods={payMethods}
                        reloadMethods={reloadPayMethods}
                        onChange={(next) =>
                          setPayLines((prev) =>
                            prev.map((l, idx) =>
                              idx === i ? { ...next, amount: l.amount } : l,
                            ),
                          )
                        }
                      />

                      <div className="space-y-1.5">
                        <Label htmlFor={`se-line-${i}-amount`} className="text-xs">
                          Amount
                        </Label>
                        <Input
                          id={`se-line-${i}-amount`}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="tabular-nums"
                          value={line.amount || ""}
                          onChange={(e) =>
                            setPayLines((prev) =>
                              prev.map((l, idx) =>
                                idx === i
                                  ? { ...l, amount: Number.parseFloat(e.target.value) || 0 }
                                  : l,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setPayLines((prev) => [...prev, { ...ADDED_ROUTE, amount: leftToPay(totals.total, prev) }])
                      revealNewPaymentLine("edit")
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add payment
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <Row label="Subtotal" value={money(totals.subtotal)} />
              <Row label="Discount (-)" value={money(totals.discount)} />
              <Row label="Net amount" value={money(totals.net)} strong />
              <Row label="Total with previous dues" value={money(totals.total)} />
              <Row label="Received" value={money(totals.received)} />
              <Row
                label="Dues"
                value={money(totals.due)}
                strong
                danger={totals.due > 0}
              />
              {totals.change > 0 && (
                <Row label="Change to give" value={money(totals.change)} />
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({
  label,
  value,
  strong,
  danger,
}: {
  label: string
  value: string
  strong?: boolean
  danger?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums ${strong ? "font-semibold" : ""} ${
          danger ? "text-destructive" : ""
        }`}
      >
        {value}
      </span>
    </div>
  )
}
