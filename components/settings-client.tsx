"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  Building2,
  Check,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  Save,
  Store,
  Trash2,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRole } from "@/components/role-provider"
import { ShopLinks } from "@/components/shop-links"
import { AppVersion } from "@/components/app-version"
import { PrinterSettings } from "@/components/printer-settings"
import { useSubscription } from "@/components/subscription-provider"
import { createClient } from "@/utils/supabase/component"
import { describeDbError } from "@/lib/utils/db-error"

type Manager = {
  membershipId: string
  userId: string
  name: string
  email: string
  isActive: boolean
  addedAt: string
}

type ShopDetails = {
  name: string
  address: string
  phone: string
  email: string
  tax_id: string
  phone_secondary: string
  receipt_watermark: string
  receipt_footer_bn: string
  receipt_footer_en: string
}

type Subscription = {
  plan: string
  status: string
  start_date: string
  end_date: string
}

const EMPTY_SHOP: ShopDetails = {
  name: "", address: "", phone: "", email: "", tax_id: "",
  phone_secondary: "", receipt_watermark: "", receipt_footer_bn: "", receipt_footer_en: "",
}

// Module scope on purpose: calling createClient() inside the component
// returns a new client on every render, which would change the identity
// of every useCallback/useEffect that depends on it and spin forever.
const supabase = createClient()

export function SettingsClient() {
  const { shops, currentShopId, setCurrentShopId, accountType, hasPermission, refreshShops } =
    useRole()
  const { canWrite } = useSubscription()

  const isOwner = accountType === "owner"

  // Which shop the settings screens are pointed at. Defaults to the
  // active shop but an owner can inspect any of theirs from here
  // without switching the whole app.
  const [selectedShopId, setSelectedShopId] = useState<string | null>(currentShopId)
  useEffect(() => setSelectedShopId(currentShopId), [currentShopId])

  const selectedShop = shops.find((s) => s.id === selectedShopId) ?? null

  // ---------------- Team ----------------
  const [managers, setManagers] = useState<Manager[]>([])
  const [managersLoading, setManagersLoading] = useState(false)
  const [editingManager, setEditingManager] = useState<Manager | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState("")
  const [showAddManager, setShowAddManager] = useState(false)
  const [addError, setAddError] = useState("")
  const [savingManager, setSavingManager] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<Manager | null>(null)
  const [removing, setRemoving] = useState(false)

  const loadManagers = useCallback(async () => {
    if (!selectedShopId) {
      setManagers([])
      return
    }
    setManagersLoading(true)
    const { data, error } = await supabase
      .from("user_organizations")
      .select("id, created_at, user_id, users(full_name, email, is_active)")
      .eq("organization_id", selectedShopId)
      .eq("role", "manager")
      .order("created_at", { ascending: true })

    if (error) {
      toast.error(describeDbError(error, { subscriptionActive: canWrite }).message)
      setManagers([])
    } else {
      setManagers(
        (data ?? []).map((row: any) => ({
          membershipId: row.id,
          userId: row.user_id,
          name: row.users?.full_name ?? "Unknown",
          email: row.users?.email ?? "",
          isActive: row.users?.is_active ?? true,
          addedAt: row.created_at,
        }))
      )
    }
    setManagersLoading(false)
  }, [selectedShopId])

  useEffect(() => {
    if (!hasPermission("user_management")) return
    loadManagers()
  }, [loadManagers])

  async function handleAddManager(form: { name: string; email: string; password: string }) {
    if (!selectedShopId) return
    setAddError("")
    setSavingManager(true)
    try {
      const { data, error } = await supabase.functions.invoke("create-manager", {
        body: { shopId: selectedShopId, ...form },
      })
      const failure = error
        ? ((await error.context?.json?.().catch(() => null))?.error ?? error.message)
        : data?.error
      if (failure) {
        setAddError(failure)
        return
      }
      setShowAddManager(false)
      toast.success(`${form.name} can now sign in and manage ${selectedShop?.name ?? "this shop"}.`)
      loadManagers()
    } finally {
      setSavingManager(false)
    }
  }

  async function handleEditManager(form: { name: string; email: string; password: string }) {
    if (!editingManager || !selectedShopId) return
    setEditError("")
    setSavingEdit(true)
    try {
      const { data, error } = await supabase.functions.invoke("update-manager", {
        body: {
          shopId: selectedShopId,
          managerId: editingManager.userId,
          name: form.name,
          email: form.email,
          // Blank means leave it alone. Forcing a new password on every
          // name change would lock the manager out of the till for the
          // sake of a spelling correction.
          password: form.password || undefined,
        },
      })
      const failure = error
        ? ((await error.context?.json?.().catch(() => null))?.error ?? error.message)
        : data?.error
      if (failure) {
        setEditError(failure)
        return
      }
      setEditingManager(null)
      toast.success(
        form.password
          ? `${form.name} updated. They will need the new password to sign in.`
          : `${form.name} updated.`,
      )
      loadManagers()
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleRemoveManager() {
    if (!pendingRemoval || !selectedShopId) return
    setRemoving(true)
    try {
      const { data, error } = await supabase.functions.invoke("delete-manager", {
        body: { shopId: selectedShopId, managerId: pendingRemoval.userId },
      })
      const failure = error
        ? ((await error.context?.json?.().catch(() => null))?.error ?? error.message)
        : data?.error
      if (failure) {
        toast.error(failure)
        return
      }
      toast.success(data?.message ?? "Manager removed.")
      setPendingRemoval(null)
      loadManagers()
    } finally {
      setRemoving(false)
    }
  }

  // ---------------- Shop details ----------------
  const [shopForm, setShopForm] = useState<ShopDetails>(EMPTY_SHOP)
  const [shopLoading, setShopLoading] = useState(false)
  const [savingShop, setSavingShop] = useState(false)

  useEffect(() => {
    if (!selectedShopId) return
    setShopLoading(true)
    supabase
      .from("organizations")
      .select(
        "name, address, phone, email, tax_id, phone_secondary, receipt_watermark, receipt_footer_bn, receipt_footer_en"
      )
      .eq("id", selectedShopId)
      .maybeSingle()
      .then(({ data }) => {
        setShopForm({
          name: data?.name ?? "",
          address: data?.address ?? "",
          phone: data?.phone ?? "",
          email: data?.email ?? "",
          tax_id: data?.tax_id ?? "",
          phone_secondary: data?.phone_secondary ?? "",
          receipt_watermark: data?.receipt_watermark ?? "",
          receipt_footer_bn: data?.receipt_footer_bn ?? "",
          receipt_footer_en: data?.receipt_footer_en ?? "",
        })
        setShopLoading(false)
      })
  }, [selectedShopId])

  async function saveShopDetails() {
    if (!selectedShopId) return
    if (!shopForm.name.trim()) {
      toast.error("Shop name is required")
      return
    }
    setSavingShop(true)
    try {
      const { data, error } = await supabase
        .from("organizations")
        .update({
          name: shopForm.name.trim(),
          address: shopForm.address.trim() || null,
          phone: shopForm.phone.trim() || null,
          email: shopForm.email.trim() || null,
          tax_id: shopForm.tax_id.trim() || null,
          phone_secondary: shopForm.phone_secondary.trim() || null,
          receipt_watermark: shopForm.receipt_watermark.trim() || null,
          receipt_footer_bn: shopForm.receipt_footer_bn.trim() || null,
          receipt_footer_en: shopForm.receipt_footer_en.trim() || null,
        })
        .eq("id", selectedShopId)
        .select("id")

      if (error) {
        toast.error(describeDbError(error, { subscriptionActive: canWrite }).message)
        return
      }
      // An update refused by row-level security matches no rows and
      // reports no error, so success must be confirmed, not assumed.
      if (!data || data.length === 0) {
        toast.error("You don't have permission to change this shop's details.")
        return
      }
      toast.success("Shop details saved")
      await refreshShops()
    } finally {
      setSavingShop(false)
    }
  }

  // ---------------- Add shop ----------------
  const [showAddShop, setShowAddShop] = useState(false)
  const [creatingShop, setCreatingShop] = useState(false)

  async function handleCreateShop(form: { name: string; address: string; phone: string }) {
    setCreatingShop(true)
    try {
      const { data, error } = await supabase.rpc("create_organization", {
        p_name: form.name.trim(),
        p_address: form.address.trim() || null,
        p_phone: form.phone.trim() || null,
      })
      if (error) {
        toast.error(error.message)
        return
      }
      await refreshShops()
      if (data?.id) setCurrentShopId(data.id)
      setShowAddShop(false)
      toast.success(`${form.name} created`)
    } finally {
      setCreatingShop(false)
    }
  }

  // ---------------- Subscription ----------------
  const [subscription, setSubscription] = useState<Subscription | null>(null)

  useEffect(() => {
    if (!selectedShopId || !isOwner) return
    supabase
      .from("subscriptions")
      .select("plan, status, start_date, end_date")
      .eq("organization_id", selectedShopId)
      .maybeSingle()
      .then(({ data }) => setSubscription(data))
  }, [selectedShopId, isOwner])

  // ---------------- Render ----------------
  if (!shops.length) {
    return (
      <div className="flex-1 p-6 space-y-6">
        <h1 className="text-3xl font-bold">Settings</h1>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>No shop is set up yet.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const canManageTeam = hasPermission("user_management")

  return (
    <div className="flex-1 p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isOwner ? "Manage your shops, staff, and subscription" : "Your shop details"}
          </p>
        </div>
        {!isOwner && <Badge variant="secondary">Manager access</Badge>}
      </div>

      {/* Which shop these settings apply to. Only meaningful with more
          than one, so it stays out of the way for single-shop owners. */}
      {isOwner && shops.length > 1 && (
        <div className="flex items-center gap-3">
          <Label htmlFor="settings-shop" className="text-sm text-muted-foreground whitespace-nowrap">
            Viewing shop
          </Label>
          <Select value={selectedShopId ?? undefined} onValueChange={setSelectedShopId}>
            <SelectTrigger id="settings-shop" className="w-[260px]">
              <SelectValue placeholder="Select a shop" />
            </SelectTrigger>
            <SelectContent>
              {shops.map((shop) => (
                <SelectItem key={shop.id} value={shop.id}>
                  {shop.name}
                  {shop.id === currentShopId ? "  (active)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Tabs defaultValue={isOwner ? "shops" : "store"} className="space-y-6">
        {/* A plain inline-flex list. The previous version built its
            column count with an interpolated class name, which Tailwind
            cannot see at build time, so no grid was ever generated and
            every tab stacked on top of the content. */}
        <TabsList>
          {isOwner && <TabsTrigger value="shops">Shops</TabsTrigger>}
          {canManageTeam && <TabsTrigger value="team">Team</TabsTrigger>}
          <TabsTrigger value="store">Shop details</TabsTrigger>
          {isOwner && <TabsTrigger value="subscription">Subscription</TabsTrigger>}
        </TabsList>

        {/* ---------------- Shops ---------------- */}
        {isOwner && (
          <TabsContent value="shops" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="flex items-center">
                    <Building2 className="mr-2 h-5 w-5" />
                    Your shops
                  </CardTitle>
                  <CardDescription>
                    Each shop keeps its own inventory, sales, customers, and staff. Switching shops
                    changes what the whole app shows.
                  </CardDescription>
                </div>
                <Button onClick={() => setShowAddShop(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Shop
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shop</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shops.map((shop) => (
                      <TableRow key={shop.id}>
                        <TableCell className="font-medium">{shop.name}</TableCell>
                        <TableCell className="text-muted-foreground">{shop.address || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{shop.phone || "—"}</TableCell>
                        <TableCell className="text-right">
                          {shop.id === currentShopId ? (
                            <Badge>
                              <Check className="mr-1 h-3 w-3" />
                              Active
                            </Badge>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => setCurrentShopId(shop.id)}>
                              Switch to
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <ShopLinks />
          </TabsContent>
        )}

        {/* ---------------- Team ---------------- */}
        {canManageTeam && (
          <TabsContent value="team" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="flex items-center">
                    <Users className="mr-2 h-5 w-5" />
                    Team{selectedShop ? ` — ${selectedShop.name}` : ""}
                  </CardTitle>
                  <CardDescription>
                    Managers sign in with the credentials you set here and can only see this shop.
                    They cannot manage staff, edit the subscription, or delete financial records.
                  </CardDescription>
                </div>
                <Button onClick={() => setShowAddManager(true)} disabled={!selectedShopId}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Manager
                </Button>
              </CardHeader>
              <CardContent>
                {managersLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading team…
                  </div>
                ) : managers.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-10 text-center">
                    <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">No managers yet</p>
                    <p className="text-sm text-muted-foreground">
                      Add one to let a staff member run this shop with restricted access.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Added</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {managers.map((m) => (
                        <TableRow key={m.membershipId}>
                          <TableCell className="font-medium">
                            {m.name}
                            {!m.isActive && (
                              <Badge variant="secondary" className="ml-2">
                                Disabled
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{m.email}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(m.addedAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingManager(m)}
                            >
                              <Pencil className="mr-1.5 h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setPendingRemoval(m)}
                            >
                              <Trash2 className="mr-1.5 h-4 w-4" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ---------------- Shop details ---------------- */}
        <TabsContent value="store" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Store className="mr-2 h-5 w-5" />
                Shop details{selectedShop ? ` — ${selectedShop.name}` : ""}
              </CardTitle>
              <CardDescription>
                {isOwner
                  ? "Used on receipts and reports."
                  : "Only the shop owner can change these details."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {shopLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="shop-name">Shop name</Label>
                      <Input
                        id="shop-name"
                        value={shopForm.name}
                        disabled={!isOwner}
                        onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shop-phone">Phone</Label>
                      <Input
                        id="shop-phone"
                        value={shopForm.phone}
                        disabled={!isOwner}
                        onChange={(e) => setShopForm({ ...shopForm, phone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shop-phone2">Second phone (optional)</Label>
                      <Input
                        id="shop-phone2"
                        value={shopForm.phone_secondary}
                        disabled={!isOwner}
                        onChange={(e) =>
                          setShopForm({ ...shopForm, phone_secondary: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shop-address">Address</Label>
                    <Input
                      id="shop-address"
                      value={shopForm.address}
                      disabled={!isOwner}
                      onChange={(e) => setShopForm({ ...shopForm, address: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="shop-email">Email</Label>
                      <Input
                        id="shop-email"
                        type="email"
                        value={shopForm.email}
                        disabled={!isOwner}
                        onChange={(e) => setShopForm({ ...shopForm, email: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shop-tax">Tax ID</Label>
                      <Input
                        id="shop-tax"
                        value={shopForm.tax_id}
                        disabled={!isOwner}
                        onChange={(e) => setShopForm({ ...shopForm, tax_id: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Everything below is printed on this shop's
                      invoices. Each shop has its own, so a second
                      branch never prints the first one's identity. */}
                  <div className="space-y-4 rounded-lg border p-4">
                    <div>
                      <h4 className="text-sm font-semibold">Printed receipt</h4>
                      <p className="text-xs text-muted-foreground">
                        The shop name, address and phone numbers above appear at the top of every
                        invoice.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="shop-watermark">Watermark text</Label>
                      <Input
                        id="shop-watermark"
                        placeholder="e.g. TECNO"
                        value={shopForm.receipt_watermark}
                        disabled={!isOwner}
                        onChange={(e) =>
                          setShopForm({ ...shopForm, receipt_watermark: e.target.value })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Printed large and faint across the middle of the page. Leave blank for none.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="shop-footer-bn">Footer note (Bengali)</Label>
                      <Input
                        id="shop-footer-bn"
                        value={shopForm.receipt_footer_bn}
                        disabled={!isOwner}
                        onChange={(e) =>
                          setShopForm({ ...shopForm, receipt_footer_bn: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="shop-footer-en">Footer note (English)</Label>
                      <Input
                        id="shop-footer-en"
                        placeholder="Falls back to your phone numbers if left blank"
                        value={shopForm.receipt_footer_en}
                        disabled={!isOwner}
                        onChange={(e) =>
                          setShopForm({ ...shopForm, receipt_footer_en: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  {isOwner && (
                    <Button onClick={saveShopDetails} disabled={savingShop}>
                      {savingShop ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save changes
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Subscription ---------------- */}
        {isOwner && (
          <TabsContent value="subscription" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CreditCard className="mr-2 h-5 w-5" />
                  Subscription{selectedShop ? ` — ${selectedShop.name}` : ""}
                </CardTitle>
                <CardDescription>Contact support to change your plan.</CardDescription>
              </CardHeader>
              <CardContent>
                {!subscription ? (
                  <p className="text-sm text-muted-foreground">No subscription found for this shop.</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-y-4 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Plan</dt>
                      <dd className="mt-1 font-medium capitalize">{subscription.plan}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="mt-1">
                        <Badge variant={subscription.status === "active" ? "default" : "destructive"}>
                          {subscription.status}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Started</dt>
                      <dd className="mt-1 font-medium">
                        {new Date(subscription.start_date).toLocaleDateString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Renews / expires</dt>
                      <dd className="mt-1 font-medium">
                        {new Date(subscription.end_date).toLocaleDateString()}
                      </dd>
                    </div>
                  </dl>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Both render nothing in a browser: there is no installed
          version to report and no printer to choose. */}
      <div className="mt-6 space-y-3">
        <PrinterSettings />
        <AppVersion />
      </div>

      {/* ---------------- Add manager ---------------- */}
      <Dialog
        open={showAddManager}
        onOpenChange={(open) => {
          setShowAddManager(open)
          if (!open) setAddError("")
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add manager</DialogTitle>
            <DialogDescription>
              They can sign in immediately with these credentials, and will only ever see
              {selectedShop ? ` ${selectedShop.name}` : " this shop"}.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              handleAddManager({
                name: String(fd.get("name") ?? ""),
                email: String(fd.get("email") ?? ""),
                password: String(fd.get("password") ?? ""),
              })
            }}
          >
            <div className="grid gap-4 py-4">
              {addError && (
                <Alert variant="destructive">
                  <AlertDescription>{addError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="m-name">Full name</Label>
                <Input id="m-name" name="name" placeholder="Rahim Uddin" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-email">Email (their login ID)</Label>
                <Input id="m-email" name="email" type="email" placeholder="rahim@example.com" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-password">Temporary password</Label>
                <Input
                  id="m-password"
                  name="password"
                  type="text"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Share this with them. They can change it later from the login screen.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddManager(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingManager}>
                {savingManager && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create manager
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------- Edit manager ---------------- */}
      <Dialog
        open={!!editingManager}
        onOpenChange={(open) => {
          if (!open) {
            setEditingManager(null)
            setEditError("")
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Edit {editingManager?.name}</DialogTitle>
            <DialogDescription>
              Change their name, the email they sign in with, or give them a new
              password.
            </DialogDescription>
          </DialogHeader>
          {/* key: the form is uncontrolled, so without this it would
              keep the previous manager's values when a different row is
              opened — and the owner would edit the wrong person. */}
          <form
            key={editingManager?.userId ?? "none"}
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              handleEditManager({
                name: String(fd.get("name") ?? ""),
                email: String(fd.get("email") ?? ""),
                password: String(fd.get("password") ?? ""),
              })
            }}
          >
            <div className="grid gap-4 py-4">
              {editError && (
                <Alert variant="destructive">
                  <AlertDescription>{editError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="me-name">Full name</Label>
                <Input
                  id="me-name"
                  name="name"
                  defaultValue={editingManager?.name ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-email">Email (their login ID)</Label>
                <Input
                  id="me-email"
                  name="email"
                  type="email"
                  defaultValue={editingManager?.email ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-password">New password</Label>
                <Input
                  id="me-password"
                  name="password"
                  type="text"
                  placeholder="Leave blank to keep the current one"
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  Only fill this in to change it. Anything you type here replaces
                  their password immediately, so tell them before they next open
                  the till.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingManager(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------- Add shop ---------------- */}
      <Dialog open={showAddShop} onOpenChange={setShowAddShop}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add a shop</DialogTitle>
            <DialogDescription>
              Its inventory, sales, and staff are kept completely separate from your other shops.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              handleCreateShop({
                name: String(fd.get("name") ?? ""),
                address: String(fd.get("address") ?? ""),
                phone: String(fd.get("phone") ?? ""),
              })
            }}
          >
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="s-name">Shop name</Label>
                <Input id="s-name" name="name" placeholder="Samsung — Gulshan branch" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-address">Address (optional)</Label>
                <Input id="s-address" name="address" placeholder="Shop #507/B, Dhaka" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-phone">Phone (optional)</Label>
                <Input id="s-phone" name="phone" placeholder="+8801XXXXXXXXX" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddShop(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingShop}>
                {creatingShop && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create shop
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------- Remove manager ---------------- */}
      <AlertDialog open={!!pendingRemoval} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingRemoval?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will lose access to {selectedShop?.name ?? "this shop"} immediately and will no
              longer be able to sign in. Any sales or expenses they already recorded are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleRemoveManager()
              }}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove manager
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
