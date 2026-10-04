"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeftRight, Link2, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"

const supabase = createClient()

type ShopLink = {
  id: string
  organization_id: string
  partner_organization_id: string
}

/**
 * Which shops may send stock to which.
 *
 * This table IS the authorization for shop-to-shop transfers. A manager
 * can move stock between two shops, but only along a link an owner
 * created here — and the database checks it again, so removing a link
 * genuinely stops the transfers rather than only hiding a button.
 *
 * Connections are mutual: one row joins two shops and either may send
 * to the other, which is how the shops actually work — whichever one
 * happens to have the handset sends it. Stored as a single row rather
 * than two, so a connection cannot end up half-removed and working in
 * one direction only.
 */
export function ShopLinks() {
  const { toast } = useToast()
  const { shops, accountType } = useRole()
  const isOwner = accountType === "owner"

  const [links, setLinks] = useState<ShopLink[]>([])
  const [loading, setLoading] = useState(true)
  const [fromShop, setFromShop] = useState("")
  const [toShop, setToShop] = useState("")
  const [saving, setSaving] = useState(false)

  const nameOf = useCallback(
    (id: string) => shops.find((s) => s.id === id)?.name ?? "Unknown shop",
    [shops]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("shop_links")
        .select("id, organization_id, partner_organization_id")
      if (error) throw error
      setLinks((data ?? []) as ShopLink[])
    } catch (e: any) {
      toast({
        title: "Couldn't load shop connections",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const addLink = async () => {
    if (!fromShop || !toShop) return
    if (fromShop === toShop) {
      toast({
        title: "Same shop",
        description: "A shop cannot supply itself.",
        variant: "destructive",
      })
      return
    }

    // The connection is mutual, so A-B and B-A are the same thing. The
    // database refuses the mirror too; this just says so without a
    // round trip.
    const already = links.some(
      (l) =>
        (l.organization_id === fromShop && l.partner_organization_id === toShop) ||
        (l.organization_id === toShop && l.partner_organization_id === fromShop)
    )
    if (already) {
      toast({ title: "Already connected", description: "These shops are already connected." })
      return
    }

    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from("shop_links")
        .insert({
          organization_id: fromShop,
          partner_organization_id: toShop,
          created_by: userData?.user?.id ?? null,
        })
        .select("id")

      if (error) {
        // 23505 is the unique constraint: the link already exists,
        // which is not worth an error message.
        if ((error as any).code === "23505") {
          toast({ title: "Already connected", description: "That connection exists." })
          return
        }
        throw error
      }

      // A row blocked by row-level security matches nothing and returns
      // no error, so without this the screen would claim to have saved
      // a connection the database refused.
      if (!data || data.length === 0) {
        toast({
          title: "Not allowed",
          description: "You must own both shops to connect them.",
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Shops connected",
        description: `${nameOf(fromShop)} and ${nameOf(toShop)} can now supply each other.`,
      })
      setFromShop("")
      setToShop("")
      load()
    } catch (e: any) {
      toast({ title: "Couldn't connect", description: e?.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const removeLink = async (link: ShopLink) => {
    try {
      const { data, error } = await supabase
        .from("shop_links")
        .delete()
        .eq("id", link.id)
        .select("id")

      if (error) throw error
      if (!data || data.length === 0) {
        toast({
          title: "Not allowed",
          description: "Only an owner of these shops can remove this.",
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Connection removed",
        description: "Stock already transferred stays where it is.",
      })
      load()
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e?.message, variant: "destructive" })
    }
  }

  if (!isOwner) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Link2 className="mr-2 h-5 w-5" />
          Shop connections
        </CardTitle>
        <CardDescription>
          Connected shops can supply each other with stock at cost price. The connection
          works both ways, so either shop can send to the other — whichever one has the
          product.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="min-w-[180px] flex-1">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Shop</p>
            <Select value={fromShop} onValueChange={setFromShop}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a shop" />
              </SelectTrigger>
              <SelectContent>
                {shops.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ArrowLeftRight className="mb-2 h-4 w-4 shrink-0 text-muted-foreground" />

          <div className="min-w-[180px] flex-1">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Connected to</p>
            <Select value={toShop} onValueChange={setToShop}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a shop" />
              </SelectTrigger>
              <SelectContent>
                {shops
                  .filter((s) => s.id !== fromShop)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={addLink} disabled={saving || !fromShop || !toShop}>
            <Plus className="mr-2 h-4 w-4" />
            {saving ? "Connecting…" : "Connect"}
          </Button>
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : links.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center">
            <Link2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No shops connected</p>
            <p className="text-sm text-muted-foreground">
              Until two shops are connected, neither can send stock to the other.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shop</TableHead>
                <TableHead>Connected to</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{nameOf(l.organization_id)}</TableCell>
                  <TableCell>{nameOf(l.partner_organization_id)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeLink(l)}
                      title="Remove this connection"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
