"use client"

import { useCallback, useEffect, useState } from "react"
import { Store } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"
import { useLinkedShops } from "@/hooks/use-linked-shops"
import {
  PaymentRoute,
  usePaymentMethods,
  toLegacyTotals,
  firstBankFor,
  EMPTY_ROUTE,
  type PaymentRouteValue,
  type PaymentLine,
} from "@/components/payment-route"

const supabase = createClient()

type OwedTransfer = {
  saleId: number
  invoiceNumber: string | null
  saleDate: string
  toOrgId: string
  shopName: string
  total: number
  outstanding: number
  items: string
}

/**
 * What other shops still owe this one for stock it sent.
 *
 * Only the shop that is OWED can record a payment, which is why this
 * lists money coming in rather than money going out — settle_shop_transfer
 * requires write access to the sending shop. The receiving shop sees the
 * same debt as a purchase and, once paid, as an expense.
 */
export function ShopDues({ onSettled }: { onSettled?: () => void }) {
  const { toast } = useToast()
  const { currentShopId } = useRole()
  const { nameOf } = useLinkedShops()
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods()

  const [rows, setRows] = useState<OwedTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [payee, setPayee] = useState<OwedTransfer | null>(null)
  const [amount, setAmount] = useState("")
  const [route, setRoute] = useState<PaymentRouteValue>(EMPTY_ROUTE)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!currentShopId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("sales")
        .select(
          `id, invoice_number, sale_date, total_amount, transfer_to_org_id,
           credit_amount, due_settled,
           sold_products ( product_name, variant, color )`
        )
        .eq("organization_id", currentShopId)
        .not("transfer_to_org_id", "is", null)
        .order("sale_date", { ascending: true })

      if (error) throw error

      // PostgREST cannot compare one column against another, so the
      // fully-paid transfers are dropped here.
      const list: OwedTransfer[] = (data ?? [])
        .map((s: any) => {
          const products = Array.isArray(s.sold_products) ? s.sold_products : []
          return {
            saleId: s.id,
            invoiceNumber: s.invoice_number ?? null,
            saleDate: s.sale_date ?? "",
            toOrgId: s.transfer_to_org_id,
            shopName: nameOf(s.transfer_to_org_id),
            total: Number(s.total_amount ?? 0),
            outstanding: Number(
              (Number(s.credit_amount ?? 0) - Number(s.due_settled ?? 0)).toFixed(2)
            ),
            items:
              products.length === 0
                ? "—"
                : products
                    .map((p: any) =>
                      [p.product_name, p.variant, p.color].filter(Boolean).join(" ")
                    )
                    .join(", "),
          }
        })
        .filter((r) => r.outstanding > 0.001)

      setRows(list)
    } catch (e: any) {
      toast({
        title: "Couldn't load shop dues",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [currentShopId, nameOf, toast])

  useEffect(() => {
    load()
  }, [load])

  const settle = async () => {
    if (!payee || !currentShopId) return

    const value = Number(Number(amount).toFixed(2))
    if (!Number.isFinite(value) || value <= 0) {
      toast({
        title: "Enter an amount",
        description: "Enter how much the shop is paying.",
        variant: "destructive",
      })
      return
    }
    if (value > payee.outstanding) {
      toast({
        title: "Amount too high",
        description: `${payee.invoiceNumber ?? "This transfer"} has ৳${payee.outstanding.toFixed(
          2
        )} left on it.`,
        variant: "destructive",
      })
      return
    }
    if (route.method === "bank_transfer" && !route.bankName) {
      toast({ title: "Choose a bank", description: "Select which bank the money came through.", variant: "destructive" })
      return
    }
    if (route.method !== "cash" && !route.channel) {
      toast({ title: "Choose a method", description: "Select how the shop paid.", variant: "destructive" })
      return
    }

    setSaving(true)
    try {
      const clientTxnId =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`

      const lines: PaymentLine[] = [{ ...route, amount: value }]
      const payments = {
        ...toLegacyTotals(lines),
        method: lines[0].channel || lines[0].method || "cash",
        card_bank: firstBankFor(lines, "card"),
        bank_transfer_bank: firstBankFor(lines, "transfer"),
        channel: lines[0].channel || null,
        lines: lines.map((l) => ({
          method: l.method,
          bank: l.bankName || null,
          channel: l.channel || null,
          amount: l.amount,
        })),
      }

      const { data, error } = await supabase.rpc("settle_shop_transfer", {
        p_from_org: currentShopId,
        p_client_txn_id: clientTxnId,
        p_sales_id: payee.saleId,
        p_amount: value,
        p_payments: payments,
      })

      if (error) throw error

      // Refusals come back in the result rather than as an exception,
      // so without this the screen would report a payment the database
      // declined.
      if (!data?.success) {
        toast({
          title: "Not recorded",
          description: data?.message ?? "The payment could not be recorded.",
          variant: "destructive",
        })
        return
      }

      const left = Number(data.transfer_remaining ?? 0)
      toast({
        title: "Payment recorded",
        description:
          left > 0
            ? `৳${value.toFixed(2)} from ${payee.shopName} • ৳${left.toFixed(2)} left on ${
                payee.invoiceNumber ?? "this transfer"
              }`
            : `${payee.invoiceNumber ?? "Transfer"} paid in full by ${payee.shopName}`,
      })

      setPayee(null)
      setAmount("")
      setRoute(EMPTY_ROUTE)
      load()
      onSettled?.()
    } catch (e: any) {
      toast({ title: "Payment failed", description: e?.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-10 text-center">
        <Store className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">Nothing outstanding</p>
        <p className="text-sm text-muted-foreground">
          No shop currently owes this one for transferred stock.
        </p>
      </div>
    )
  }

  // Taking a payment against one transfer.
  if (payee) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{payee.shopName}</p>
          <p className="text-xs text-muted-foreground">
            {payee.invoiceNumber ?? `#${payee.saleId}`}
            {payee.saleDate ? ` · ${new Date(payee.saleDate).toLocaleDateString()}` : ""}
          </p>
          <div className="mt-2 flex justify-between border-t pt-2">
            <span className="text-muted-foreground">Outstanding</span>
            <span className="font-semibold text-red-600">
              ৳{payee.outstanding.toFixed(2)}
            </span>
          </div>
        </div>

        <div>
          <Label htmlFor="sd-amount">Amount received</Label>
          <Input
            id="sd-amount"
            autoFocus
            type="number"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <PaymentRoute
          idPrefix="shopdue"
          value={route}
          methods={payMethods}
          reloadMethods={reloadPayMethods}
          onChange={setRoute}
        />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPayee(null)} disabled={saving}>
            Back
          </Button>
          <Button onClick={settle} disabled={saving || !amount}>
            {saving ? "Recording…" : `Record ৳${(Number(amount) || 0).toFixed(2)}`}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="max-h-[340px] space-y-2 overflow-y-auto">
        {rows.map((r) => (
          <button
            key={r.saleId}
            type="button"
            onClick={() => {
              setPayee(r)
              // Deliberately blank rather than prefilled with the
              // balance: a prefilled figure is one Enter away from
              // recording a full settlement when only part was paid.
              setAmount("")
              setRoute(EMPTY_ROUTE)
            }}
            className="flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.shopName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.invoiceNumber ?? `#${r.saleId}`}
                {r.saleDate ? ` · ${new Date(r.saleDate).toLocaleDateString()}` : ""}
              </p>
              <p className="mt-1 truncate text-xs">{r.items}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-red-600">
                ৳{r.outstanding.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">of ৳{r.total.toFixed(2)}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {rows.length} transfer{rows.length === 1 ? "" : "s"} owing
        </span>
        <span className="font-semibold">
          ৳{rows.reduce((sum, r) => sum + r.outstanding, 0).toFixed(2)}
        </span>
      </div>
    </div>
  )
}
