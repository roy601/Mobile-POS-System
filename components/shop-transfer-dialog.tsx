"use client"

import { useEffect, useMemo, useState } from "react"
import { Store, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"
import { useLinkedShops } from "@/hooks/use-linked-shops"
import { useBarcodeScanner } from "@/hooks/use-keyboard-flow"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ShopDues } from "@/components/shop-dues"
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

type Scanned = {
  barcode: string
  name: string
  variant: string | null
  color: string | null
  cost: number
}

/**
 * Send stock to another shop, at cost.
 *
 * The whole point is that the sending shop makes no profit: the price
 * is the COST price held against each unit, read from stock rather than
 * typed, so a cashier cannot accidentally sell a handset to a sister
 * shop at retail.
 *
 * The receiving shop can pay now, part-pay, or take it on credit — the
 * balance is then owed shop to shop and settled from the Dues screen.
 */
export function ShopTransferDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const { toast } = useToast()
  const { currentShopId } = useRole()
  const { linked, nameOf, reload: reloadLinked } = useLinkedShops()
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods()

  const [toShop, setToShop] = useState("")
  const [barcode, setBarcode] = useState("")
  const [items, setItems] = useState<Scanned[]>([])
  const [looking, setLooking] = useState(false)
  const [route, setRoute] = useState<PaymentRouteValue>(EMPTY_ROUTE)
  const [paidNow, setPaidNow] = useState("")
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState("send")

  const total = items.reduce((sum, i) => sum + i.cost, 0)
  // Blank means paid in full — the common case, and it saves retyping
  // the total. An explicit 0 means entirely on credit.
  const paid = paidNow.trim() === "" ? total : Math.max(0, Number(paidNow) || 0)
  const owed = Number((total - Math.min(paid, total)).toFixed(2))

  /**
   * Shops this one is allowed to supply, with their real names.
   *
   * Names come from list_linked_shops rather than the signed-in user's
   * own shops: a manager belongs to one shop only, so the partner was
   * never in that list and this read "Connected shop" for every
   * manager while working fine for the owner.
   */
  // Derived, not copied into state through an effect.
  //
  // This used to be a useCallback over `linked` that an effect called
  // to setPartners. That callback got a new identity every time
  // `linked` changed — and the effect below, which depends on it, also
  // calls reloadLinked(). So the effect re-ran on its own output, and
  // each re-run hit setBarcode("") and setItems([]), wiping the field
  // mid-scan. Reading straight from `linked` removes the loop and the
  // duplicated state together.
  const partners = useMemo(
    () => (currentShopId ? linked.map((l) => ({ id: l.id, name: l.name })) : []),
    [currentShopId, linked]
  )

  // Clearing the form belongs to the dialog OPENING, and nothing else.
  // Any other dependency here means a background refresh can empty a
  // basket the user is halfway through filling.
  useEffect(() => {
    if (!open) return
    setTab("send")
    reloadLinked()
    setItems([])
    setBarcode("")
    setPaidNow("")
    setRoute(EMPTY_ROUTE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const addBarcode = async (raw: string) => {
    const code = raw.trim()
    if (!code || !currentShopId) return

    if (items.some((i) => i.barcode === code)) {
      toast({ title: "Already added", description: `${code} is in the list.` })
      setBarcode("")
      return
    }

    setLooking(true)
    try {
      const { data, error } = await supabase.rpc("get_product_by_barcode", {
        p_barcode: code,
        p_organization_id: currentShopId,
      })
      if (error) throw error

      if (!data?.success) {
        toast({
          title: "Not found",
          description: data?.message ?? `No product with barcode ${code}.`,
          variant: "destructive",
        })
        return
      }
      if ((data.available_quantity ?? 0) < 1) {
        toast({
          title: "Out of stock",
          description: `${data.name} has none left to send.`,
          variant: "destructive",
        })
        return
      }

      // The cost is read here for display only. The database reads it
      // again when the transfer runs, so what is charged is always the
      // stock's own cost and never a figure from the browser.
      const { data: inv } = await supabase
        .from("inventory")
        .select("cost_price")
        .eq("organization_id", currentShopId)
        .eq("barcode", code)
        .maybeSingle()

      setItems((prev) => [
        ...prev,
        {
          barcode: code,
          name: data.name ?? code,
          variant: data.variant ?? null,
          color: data.color ?? null,
          cost: Number(inv?.cost_price ?? 0),
        },
      ])
      setBarcode("")
    } catch (e: any) {
      toast({ title: "Lookup failed", description: e?.message, variant: "destructive" })
    } finally {
      setLooking(false)
    }
  }

  // The same scanner handling the POS uses, for the same reasons.
  //
  // Reading the barcode straight off the input was the bug here. A
  // scanner fires its characters within a few milliseconds and then
  // sends Enter, faster than React re-renders — so the `barcode` state
  // the Enter handler closed over was still the value from some
  // earlier keystroke, usually the empty string. addBarcode("") returns
  // immediately and silently, which is exactly what "scanning does
  // nothing" looks like.
  //
  // The hook reads e.currentTarget.value instead, which the browser has
  // already updated, and it also fires on its own after a burst goes
  // quiet — so a scanner configured WITHOUT a trailing Enter works too.
  // Not memoised on purpose: the hook keeps the latest callback in a
  // ref, so a fresh closure each render is correct and avoids capturing
  // a stale `items` list in the duplicate check.
  const scanner = useBarcodeScanner({
    onScan: addBarcode,
    enabled: open && !looking,
  })

  const submit = async () => {
    if (!currentShopId || !toShop || items.length === 0) return

    if (paid > 0) {
      if (route.method === "bank_transfer" && !route.bankName) {
        toast({ title: "Choose a bank", description: "Select which bank the money came through.", variant: "destructive" })
        return
      }
      if (route.method !== "cash" && !route.channel) {
        toast({ title: "Choose a method", description: "Select how the shop paid.", variant: "destructive" })
        return
      }
    }

    setSaving(true)
    try {
      const clientTxnId =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`

      const lines: PaymentLine[] = paid > 0 ? [{ ...route, amount: paid }] : []
      const payments =
        lines.length > 0
          ? {
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
          : null

      const { data, error } = await supabase.rpc("transfer_stock_to_shop", {
        p_from_org: currentShopId,
        p_to_org: toShop,
        p_client_txn_id: clientTxnId,
        p_barcodes: items.map((i) => i.barcode),
        p_payments: payments,
        p_paid: paid,
      })

      if (error) throw error

      // The function reports refusals in its result rather than raising,
      // so ignoring this would tell the shop stock had moved when it had
      // not.
      if (!data?.success) {
        toast({
          title: "Transfer refused",
          description: data?.message ?? "The transfer could not be recorded.",
          variant: "destructive",
        })
        return
      }

      toast({
        title: data.duplicate ? "Already recorded" : "Stock transferred",
        description:
          Number(data.owed ?? 0) > 0
            ? `${data.items} item(s) to ${data.to_shop} • ৳${Number(data.owed).toFixed(2)} owed`
            : `${data.items} item(s) to ${data.to_shop} • paid in full`,
      })

      onOpenChange(false)
      onDone?.()
    } catch (e: any) {
      toast({ title: "Transfer failed", description: e?.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Shop transfers</DialogTitle>
          <DialogDescription>
            Stock moves at cost, so this shop makes no profit. The receiving shop sets its
            own selling price and earns the margin when it sells.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="send">Send stock</TabsTrigger>
            <TabsTrigger value="owed">Money owed</TabsTrigger>
          </TabsList>

          <TabsContent value="send" className="space-y-4 pt-2">
        {partners.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center">
            <Store className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No connected shops</p>
            <p className="text-sm text-muted-foreground">
              The owner must connect this shop to another in Settings → Shops first.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="tr-shop">Send to*</Label>
              <Select value={toShop} onValueChange={setToShop}>
                <SelectTrigger id="tr-shop">
                  <SelectValue placeholder="Choose a shop" />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="tr-barcode">Scan items</Label>
              <div className="flex gap-2">
                <Input
                  id="tr-barcode"
                  autoFocus
                  placeholder="Scan or type a barcode, then press Enter"
                  value={barcode}
                  onChange={(e) => {
                    setBarcode(e.target.value)
                    scanner.onChange(e.target.value)
                  }}
                  onKeyDown={scanner.onKeyDown}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => addBarcode(barcode)}
                  disabled={!barcode.trim() || looking}
                >
                  {looking ? "…" : "Add"}
                </Button>
              </div>
            </div>

            {items.length > 0 && (
              <div className="max-h-[220px] space-y-2 overflow-y-auto rounded-lg border p-2">
                {items.map((i) => (
                  <div key={i.barcode} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[i.variant, i.color].filter(Boolean).join(" · ") || "—"} · {i.barcode}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono">৳{i.cost.toFixed(2)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setItems((prev) => prev.filter((x) => x.barcode !== i.barcode))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between font-medium">
                <span>Total at cost</span>
                <span>৳{total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paying now</span>
                <span>৳{Math.min(paid, total).toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">They will owe</span>
                <span className={owed > 0 ? "font-semibold text-red-600" : "font-semibold"}>
                  ৳{owed.toFixed(2)}
                </span>
              </div>
            </div>

            <div>
              <Label htmlFor="tr-paid">Amount paid now</Label>
              <Input
                id="tr-paid"
                type="number"
                step="0.01"
                placeholder={`Leave blank to pay all (৳${total.toFixed(2)})`}
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Enter 0 to send it entirely on credit. The balance is settled from the Dues
                screen later.
              </p>
            </div>

            {paid > 0 && (
              <PaymentRoute
                idPrefix="transfer"
                value={route}
                methods={payMethods}
                reloadMethods={reloadPayMethods}
                onChange={setRoute}
              />
            )}
          </div>
        )}

          </TabsContent>

          <TabsContent value="owed" className="pt-2">
            <ShopDues />
          </TabsContent>
        </Tabs>

        {/* Only the sending tab commits anything; the dues tab has its
            own buttons, so showing these there would be two ways to
            submit two different things. */}
        {tab === "send" && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={saving || !toShop || items.length === 0 || total <= 0}
            >
              {saving ? "Transferring…" : `Transfer ${items.length} item(s)`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
