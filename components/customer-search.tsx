"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"
import { Search, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const supabase = createClient()

interface Customer {
  id: number
  name: string
  phone_number?: string | null
  email?: string | null
  dues?: number | null
  total_spent?: number | null
  status?: string | null
}

interface CustomerSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectCustomer: (customer: Customer) => void
}

export function CustomerSearch({ open, onOpenChange, onSelectCustomer }: CustomerSearchProps) {
  const { currentShopId } = useRole()
  const [searchTerm, setSearchTerm] = useState("")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)

  const fetchCustomers = async (q = "") => {
    try {
      setLoading(true)
      let query = supabase.from("customers").select("id,name,phone_number,email,dues").eq("organization_id", currentShopId).order("name", { ascending: true })
      if (q) {
        query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone_number.ilike.%${q}%`)
      }
      const { data, error } = await query.limit(200)
      if (error) throw error
      setCustomers((data as Customer[]) ?? [])
    } catch (err) {
      console.error("fetchCustomers(search) error:", err)
      toast.error("Failed to search customers.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      // currentShopId is null until RoleProvider resolves the session;
      // querying with it would send organization_id=eq.null and fail.
      if (!currentShopId) return
      fetchCustomers()
    } else {
      // Always clear on close, even with no shop selected yet.
      setSearchTerm("")
      setCustomers([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentShopId])

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return
    if (open) fetchCustomers(searchTerm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, currentShopId])

  const handleSelect = (c: Customer) => {
    onSelectCustomer(c)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <User className="mr-2 h-5 w-5" />
            Select Customer
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name, phone, or email..." className="pl-8" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Dues</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : (
                  customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell>{customer.phone_number ?? "-"}</TableCell>
                      <TableCell>{customer.email ?? "-"}</TableCell>
                      <TableCell className={Number(customer.dues ?? 0) > 0 ? "text-red-600" : "text-green-600"}>
                        ৳{Number(customer.dues ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => handleSelect(customer)}>Select</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {!loading && customers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No customers found</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
