"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Store } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  const { user, refreshShops, setCurrentShopId } = useRole()

  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [phone, setPhone] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleCreateShop() {
    if (!user) return
    if (!name.trim()) {
      toast.error("Shop name is required")
      return
    }

    setSubmitting(true)
    try {
      // Creates the shop and its ownership record in one transaction.
      // Doing this as two separate inserts from the client cannot work:
      // reading the new shop back requires a membership row that does
      // not exist yet, and a failure between the two would leave a shop
      // with no owner.
      const { data: org, error } = await supabase.rpc("create_organization", {
        p_name: name.trim(),
        p_address: address.trim() || null,
        p_phone: phone.trim() || null,
      })

      if (error) {
        toast.error(error.message)
        return
      }

      await refreshShops()
      if (org?.id) setCurrentShopId(org.id)
      toast.success("Shop created")
      router.push("/main")
    } catch {
      toast.error("Something went wrong creating your shop")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Store className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Create your first shop</CardTitle>
          <CardDescription>
            You&apos;ll manage this shop&apos;s inventory, sales, and staff separately from any other
            shops you create later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shop-name">Shop name</Label>
            <Input
              id="shop-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mobile Shop Pro"
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shop-address">Address (optional)</Label>
            <Input
              id="shop-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Shop#507/B, Dhaka"
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shop-phone">Phone (optional)</Label>
            <Input
              id="shop-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+8801XXXXXXXXX"
              disabled={submitting}
            />
          </div>
          <Button className="w-full" onClick={handleCreateShop} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create shop
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
