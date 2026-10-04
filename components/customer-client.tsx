"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createClient } from "@/utils/supabase/component"
import { describeDbError } from "@/lib/utils/db-error"
import { useRole } from "@/components/role-provider"
import { useSubscription } from "@/components/subscription-provider"
import { ChevronLeft, ChevronRight, Download, Plus, Search, Edit, Eye, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { CustomerSearch } from "./customer-search"
import { ManagerAccessBadge } from "@/components/role-badge"
import { StatStrip } from "@/components/stat-strip"

const supabase = createClient()

/** What a customer has bought, worked out from their sales. */
type Bought = { orders: number; spent: number; last: string | null }

type SortKey = "name" | "spent" | "orders" | "recent" | "due"
type ShowKey = "all" | "owing" | "never"
const PER_PAGE = 50

const money = (n: number) =>
  "৳" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB") : "—"

/** "Afifa Arin" -> "AA"; a name that is really a phone number -> "#". */
const initials = (name: string | null | undefined) => {
  const words = String(name ?? "").trim().split(/\s+/).filter((w) => /[A-Za-z\u0980-\u09FF]/.test(w))
  if (words.length === 0) return "#"
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase()
}

/**
 * Every row a query matches, a page at a time. The database stops at
 * 1,000 rows per request without saying so; this page used to stop at
 * 100, which is why "Total Customers" read 100 for a shop with more.
 */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < 1000) return all
  }
}

type DbCustomer = {
  id: number
  name: string
  phone_number?: string | null
  email?: string | null
  address?: string | null
  dues?: number | null
  created_at?: string | null
  updated_at?: string | null
  // optional / future fields - will be undefined if not present in table
  total_spent?: number | null
  orders?: number | null
  last_purchase?: string | null
  status?: string | null
  avatar?: string | null
  date_joined?: string | null
  notes?: string | null
}

export function CustomerClient() {
  const { currentShopId, accountType } = useRole()
  const router = useRouter()
  const { canWrite } = useSubscription()
  const isOwner = accountType === "owner"
  const [searchTerm, setSearchTerm] = useState("")
  const [customers, setCustomers] = useState<DbCustomer[]>([])
  const [loading, setLoading] = useState(false)
  // Per customer id, what their completed sales add up to.
  const [bought, setBought] = useState<Map<number, Bought>>(new Map())
  const [sortBy, setSortBy] = useState<SortKey>("name")
  const [show, setShow] = useState<ShowKey>("all")
  const [page, setPage] = useState(0)

  const [selectedCustomer, setSelectedCustomer] = useState<DbCustomer | null>(null)
  const [showCustomerDetails, setShowCustomerDetails] = useState(false)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [showEditCustomer, setShowEditCustomer] = useState(false)
  const [showSearchCustomerDialog, setShowSearchCustomerDialog] = useState(false)

  // add form state
  const [addName, setAddName] = useState("")
  const [addPhone, setAddPhone] = useState("")
  const [addEmail, setAddEmail] = useState("")
  const [addAddress, setAddAddress] = useState("")
  // edit form state
  const [editName, setEditName] = useState("")
  const [editPhone, setEditPhone] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editAddress, setEditAddress] = useState("")

  /**
   * Every customer, and what each has bought.
   *
   * Spent, orders and last purchase are not stored on the customer;
   * they are read off the shop's completed sales. A due settlement is a
   * payment, not a purchase -- it sells nothing -- so it counts towards
   * neither. Spent is the goods after discount, not counting dues
   * carried onto the bill.
   */
  const fetchCustomers = async () => {
    try {
      setLoading(true)
      const [rows, links] = await Promise.all([
        readAll<DbCustomer>((from, to) =>
          supabase
            .from("customers")
            .select("*")
            .eq("organization_id", currentShopId)
            .order("name", { ascending: true })
            .range(from, to),
        ),
        readAll<any>((from, to) =>
          supabase
            .from("sale_customers")
            .select("customer_id, sales!inner(net_amount, sale_date, status, settled_sale_id)")
            .eq("organization_id", currentShopId)
            .not("customer_id", "is", null)
            .eq("sales.status", "completed")
            .order("id")
            .range(from, to),
        ),
      ])

      const map = new Map<number, Bought>()
      for (const l of links) {
        const sale = Array.isArray(l.sales) ? l.sales[0] : l.sales
        if (!sale || sale.settled_sale_id) continue
        const goods = Number(sale.net_amount) || 0
        if (goods <= 0) continue
        const b = map.get(l.customer_id) ?? { orders: 0, spent: 0, last: null }
        b.orders += 1
        b.spent += goods
        if (!b.last || String(sale.sale_date) > b.last) b.last = String(sale.sale_date)
        map.set(l.customer_id, b)
      }

      setCustomers(rows)
      setBought(map)
    } catch (err) {
      console.error("fetchCustomers error:", err)
      toast.error("Failed to load customers.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return
    fetchCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId])

  const boughtBy = (c: DbCustomer): Bought => bought.get(c.id) ?? { orders: 0, spent: 0, last: null }

  /** The list as searched, filtered and sorted -- in the browser, on everything loaded. */
  const visible = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    const list = customers.filter((c) => {
      if (q && !`${c.name ?? ""} ${c.phone_number ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q)) return false
      if (show === "owing" && !((Number(c.dues) || 0) > 0)) return false
      if (show === "never" && (bought.get(c.id)?.orders ?? 0) > 0) return false
      return true
    })
    const by = (c: DbCustomer) => bought.get(c.id) ?? { orders: 0, spent: 0, last: null }
    return list.sort((a, b) => {
      switch (sortBy) {
        case "spent":
          return by(b).spent - by(a).spent
        case "orders":
          return by(b).orders - by(a).orders
        case "recent":
          return String(by(b).last ?? "").localeCompare(String(by(a).last ?? ""))
        case "due":
          return (Number(b.dues) || 0) - (Number(a.dues) || 0)
        default:
          return String(a.name ?? "").localeCompare(String(b.name ?? ""))
      }
    })
  }, [customers, bought, searchTerm, show, sortBy])

  // Back to the first page whenever what is being looked at changes.
  useEffect(() => setPage(0), [searchTerm, show, sortBy])

  const pages = Math.max(1, Math.ceil(visible.length / PER_PAGE))
  const pageRows = visible.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)

  const handleViewCustomer = (customer: DbCustomer) => {
    setSelectedCustomer(customer)
    setShowCustomerDetails(true)
  }

  const openEditFor = (customer: DbCustomer) => {
    setSelectedCustomer(customer)
    setEditName(customer.name)
    setEditPhone(customer.phone_number ?? "")
    setEditEmail(customer.email ?? "")
    setEditAddress(customer.address ?? "")
    setShowEditCustomer(true)
  }

  const handleDeleteCustomer = async (customer: DbCustomer) => {
    if (!confirm(`Are you sure you want to delete ${customer.name}?`)) return
    try {
      const { error } = await supabase.from("customers").delete().eq("id", customer.id).eq("organization_id", currentShopId)
      if (error) throw error
      setCustomers((prev) => prev.filter((c) => c.id !== customer.id))
      toast.success("Customer deleted successfully!")
    } catch (err) {
      console.error("delete customer error:", err)
      toast.error("Failed to delete customer.")
    }
  }



  const handleExportData = async () => {
    // very simple CSV export from current state
    const header = ["id", "name", "phone_number", "email", "address", "dues", "orders", "total_spent", "last_purchase", "created_at"]
    const rows = visible.map((c) => {
      const b = boughtBy(c)
      const row: Record<string, unknown> = { ...c, orders: b.orders, total_spent: b.spent, last_purchase: b.last ?? "" }
      return header.map((h) => JSON.stringify(row[h] ?? "")).join(",")
    })
    const csv = [header.join(","), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `customers-${new Date().toISOString()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Exported customers.csv")
  }

  // The figures across the top -- all real, nothing assumed.
  const monthStart = (() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
  })()
  const newThisMonth = customers.filter((c) => String(c.created_at ?? "") >= monthStart).length
  const owing = customers.filter((c) => (Number(c.dues) || 0) > 0)
  const totalDue = owing.reduce((s, c) => s + (Number(c.dues) || 0), 0)
  const totalSpent = Array.from(bought.values()).reduce((s, b) => s + b.spent, 0)

  // Add new customer (maps to your customers table columns)
  const handleAddCustomer = async () => {
    if (!addName.trim() || !addPhone.trim()) {
      toast.error("Name and phone are required.")
      return
    }

    try {
      const payload = {
        name: addName.trim(),
        phone_number: addPhone.trim(),
        email: addEmail?.trim() || null,
        address: addAddress?.trim() || null,
        dues: 0,
        organization_id: currentShopId,
      }
      const { data, error } = await supabase.from("customers").insert([payload]).select().single()
      if (error) {
        // unique phone error or others will surface here
        console.error("insert error:", error)
        toast.error(`Failed to add customer: ${error.message}`)
        return
      }
      setCustomers((prev) => [...prev, data as DbCustomer])
      setShowAddCustomer(false)
      setAddName("")
      setAddPhone("")
      setAddEmail("")
      setAddAddress("")
      toast.success("Customer added successfully")
    } catch (err) {
      console.error("handleAddCustomer error:", err)
      toast.error("Unexpected error adding customer.")
    }
  }

  // Update existing customer
  const handleSaveEditCustomer = async () => {
    if (!selectedCustomer) return
    if (!editName.trim() || !editPhone.trim()) {
      toast.error("Name and phone are required.")
      return
    }
    try {
      // Managers send only the fields they are allowed to change.
      // Including name/address would trip the database trigger even
      // when untouched: trimming a stored name, or an empty address
      // becoming null, both register as a change.
      const updates: Record<string, unknown> = {
        phone_number: editPhone.trim(),
        email: editEmail?.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (isOwner) {
        updates.name = editName.trim()
        updates.address = editAddress?.trim() || null
      }

      const { data, error } = await supabase.from("customers").update(updates).eq("id", selectedCustomer.id).eq("organization_id", currentShopId).select().single()
      if (error) {
        const failure = describeDbError(error, { subscriptionActive: canWrite })
        toast.error(failure.title, { description: failure.message })
        return
      }
      setCustomers((prev) => prev.map((c) => (c.id === data.id ? (data as DbCustomer) : c)))
      setShowEditCustomer(false)
      toast.success("Customer updated successfully")
    } catch (err) {
      console.error("update customer error:", err)
      toast.error("Failed to update customer.")
    }
  }

  const handleSelectFromSearch = (customer: DbCustomer) => {
    setSelectedCustomer(customer)
    setShowCustomerDetails(true)
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div className="flex items-center gap-3"><h2 className="text-3xl font-bold tracking-tight">Customer Management</h2><ManagerAccessBadge mode="limited" /></div>
        <div className="flex items-center space-x-2">
          <Button onClick={() => setShowAddCustomer(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
          <Button variant="outline" onClick={() => setShowSearchCustomerDialog(true)}>
            <Search className="mr-2 h-4 w-4" />
            Find Customer
          </Button>
        </div>
      </div>

      <StatStrip
        stats={[
          { label: "Customers", value: customers.length.toLocaleString() },
          { label: "New this month", value: newThisMonth },
          { label: "Owing", value: owing.length, tone: "warn" },
          { label: "Total due", value: money(totalDue), tone: "critical" },
          { label: "Sold to customers", value: money(totalSpent), tone: "money" },
        ]}
      />

      {/* Search, show, sort and export on one line */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search customers"
            placeholder="Search name, phone or email…"
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={show} onValueChange={(v) => setShow(v as ShowKey)}>
          <SelectTrigger className="w-[180px]" aria-label="Show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All customers</SelectItem>
            <SelectItem value="owing">Owing money</SelectItem>
            <SelectItem value="never">Never bought</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
          <SelectTrigger className="w-[180px]" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name A–Z</SelectItem>
            <SelectItem value="spent">Highest spent</SelectItem>
            <SelectItem value="orders">Most orders</SelectItem>
            <SelectItem value="recent">Recent purchase</SelectItem>
            <SelectItem value="due">Highest due</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handleExportData}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {visible.length === customers.length
            ? `${customers.length} customers`
            : `${visible.length} of ${customers.length} customers`}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Total Spent</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Last Purchase</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Loading customers…
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {customers.length === 0 ? "No customers yet." : "No customers match."}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((customer) => {
                  const b = boughtBy(customer)
                  const due = Number(customer.dues) || 0
                  return (
                  <TableRow key={customer.id}>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                            {initials(customer.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{customer.name}</div>
                          {customer.email ? (
                            <div className="truncate text-xs text-muted-foreground">{customer.email}</div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 tabular-nums">{customer.phone_number ?? "—"}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{b.orders}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{money(b.spent)}</TableCell>
                    <TableCell
                      className={`py-2 text-right tabular-nums ${due > 0 ? "font-semibold text-red-600" : "text-muted-foreground"}`}
                    >
                      {due > 0 ? money(due) : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-muted-foreground">{day(b.last)}</TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="View" onClick={() => handleViewCustomer(customer)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {/* Managers may correct phone and email — they
                            take these details at the till. Name and
                            address stay owner-only, and only owners can
                            delete. Enforced in the database too, by a
                            column trigger, not just hidden here. */}
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEditFor(customer)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        {isOwner && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Delete" onClick={() => handleDeleteCustomer(customer)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-sm">
              <span className="text-muted-foreground">
                {page * PER_PAGE + 1}–{Math.min(visible.length, (page + 1) * PER_PAGE)} of {visible.length}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Details Dialog */}
      <Dialog open={showCustomerDetails} onOpenChange={setShowCustomerDetails}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>Complete customer information</DialogDescription>
          </DialogHeader>
          {selectedCustomer && (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-14 w-14">
                  <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                    {initials(selectedCustomer.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-lg font-semibold">{selectedCustomer.name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedCustomer.email ?? "-"}</p>
                  <p className="text-sm text-muted-foreground">{selectedCustomer.phone_number ?? "-"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Total Spent</Label>
                  <p className="text-lg font-semibold">{money(boughtBy(selectedCustomer).spent)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Total Orders</Label>
                  <p className="text-lg font-semibold">{boughtBy(selectedCustomer).orders}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Last Purchase</Label>
                  <p className="text-sm text-muted-foreground">{day(boughtBy(selectedCustomer).last)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Date Joined</Label>
                  <p className="text-sm text-muted-foreground">{day(selectedCustomer.date_joined ?? selectedCustomer.created_at)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Due</Label>
                  <p className={`text-lg font-semibold ${(Number(selectedCustomer.dues) || 0) > 0 ? "text-red-600" : ""}`}>
                    {money(Number(selectedCustomer.dues) || 0)}
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Address</Label>
                <p className="text-sm text-muted-foreground">{selectedCustomer.address ?? "-"}</p>
              </div>

              <div>
                <Label className="text-sm font-medium">Notes</Label>
                <p className="text-sm text-muted-foreground">{selectedCustomer.notes ?? "-"}</p>
              </div>

              <div className="flex gap-2">
                {/* Sends the shop to the Sales page filtered to this
                    customer, rather than duplicating a second orders
                    list here that would drift from the real one. The
                    button previously had no onClick at all. */}
                <Button
                  variant="outline"
                  onClick={() => {
                    const who = selectedCustomer.name || selectedCustomer.phone_number || ""
                    if (!who) {
                      toast.error("This customer has no name or phone to look up orders by.")
                      return
                    }
                    setShowCustomerDetails(false)
                    router.push(`/sales?customer=${encodeURIComponent(who)}`)
                  }}
                >
                  View Orders
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomerDetails(false)}>Close</Button>
            {isOwner && (
              <Button onClick={() => { setShowCustomerDetails(false); if (selectedCustomer) openEditFor(selectedCustomer) }}>Edit Customer</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Customer Dialog */}
      <Dialog open={showAddCustomer} onOpenChange={setShowAddCustomer}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>Enter customer information to create a new record</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="add-name">Full Name*</Label>
                <Input id="add-name" placeholder="Enter full name" value={addName} onChange={(e) => setAddName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="add-phone">Phone Number*</Label>
                <Input id="add-phone" placeholder="Enter phone number" value={addPhone} onChange={(e) => setAddPhone(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="add-email">Email Address</Label>
              <Input id="add-email" type="email" placeholder="Enter email address" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="add-address">Address</Label>
              <Input id="add-address" placeholder="Enter address" value={addAddress} onChange={(e) => setAddAddress(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddCustomer(false)}>Cancel</Button>
            <Button onClick={handleAddCustomer}>Add Customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog */}
      <Dialog open={showEditCustomer} onOpenChange={setShowEditCustomer}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>
              {isOwner
                ? "Update customer information"
                : "You can correct the phone number and email. Ask the shop owner to change the name or address."}
            </DialogDescription>
          </DialogHeader>
          {selectedCustomer && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-name">Full Name*</Label>
                  <Input id="edit-name" value={editName} disabled={!isOwner} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="edit-phone">Phone Number*</Label>
                  <Input id="edit-phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="edit-email">Email Address</Label>
                <Input id="edit-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="edit-address">Address</Label>
                <Input id="edit-address" value={editAddress} disabled={!isOwner} onChange={(e) => setEditAddress(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditCustomer(false)}>Cancel</Button>
            <Button onClick={handleSaveEditCustomer}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Search Dialog (component uses Supabase too) */}
      <CustomerSearch open={showSearchCustomerDialog} onOpenChange={setShowSearchCustomerDialog} onSelectCustomer={handleSelectFromSearch} />
    </div>
  )
}
