"use client"

import { useEffect, useState } from "react"
import { Loader2, Pencil, Trash2 } from "lucide-react"

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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useRole } from "@/components/role-provider"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/utils/supabase/component"

const supabase = createClient()

/**
 * Correct the selected supplier's name — or, for the owner, remove it.
 *
 * Sits beside the supplier dropdown's "+" button. A manager who saved
 * "Ali Nayes" while taking stock in can put it right here instead of
 * finding the owner; removing a supplier stays the owner's (script 92).
 *
 * Both go through the database, not an UPDATE from here: a supplier's
 * name is copied onto purchases, vouchers, stock, sales and every
 * payment's description, and rename_supplier moves all of them in one
 * transaction. Removing is a soft delete, so the supplier's history —
 * purchases, payments, dues — stays where it is.
 */
export function SupplierEditButton({
  supplier,
  onRenamed,
  onRemoved,
}: {
  /** The supplier currently chosen in the dropdown, if any. */
  supplier: { id: string; name: string } | null
  /** Runs after a rename, so the caller can reload its list. */
  onRenamed: () => void | Promise<void>
  /** Runs after a removal; the caller should clear its selection. */
  onRemoved: () => void | Promise<void>
}) {
  const { currentShopId, accountType } = useRole()
  const { toast } = useToast()
  const isOwner = accountType === "owner"

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (open) setName(supplier?.name ?? "")
  }, [open, supplier?.name])

  /** A database without script 92 has no such function. */
  const explain = (err: any, fallback: string) =>
    err?.code === "PGRST202"
      ? "This shop's database has not been updated yet. Ask your administrator to run script 92."
      : (err?.message ?? fallback)

  const rename = async () => {
    const next = name.trim()
    if (!supplier || !currentShopId) return
    if (!next) {
      toast({ title: "A supplier needs a name", variant: "destructive" })
      return
    }
    if (next === supplier.name.trim()) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc("rename_supplier", {
        p_organization_id: currentShopId,
        p_supplier_id: supplier.id,
        p_new_name: next,
      })
      if (error) throw error
      const result = data as { success?: boolean; message?: string }
      if (!result?.success) {
        toast({
          title: "Could not rename the supplier",
          description: result?.message ?? "The change was refused.",
          variant: "destructive",
        })
        return
      }
      await onRenamed()
      setOpen(false)
      toast({ title: "Supplier renamed", description: result.message })
    } catch (err: any) {
      toast({
        title: "Could not rename the supplier",
        description: explain(err, "The change was refused."),
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!supplier || !currentShopId) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc("delete_supplier", {
        p_organization_id: currentShopId,
        p_supplier_id: supplier.id,
      })
      if (error) throw error
      const result = data as { success?: boolean; message?: string }
      if (!result?.success) {
        toast({
          title: "Could not remove the supplier",
          description: result?.message ?? "The change was refused.",
          variant: "destructive",
        })
        return
      }
      await onRemoved()
      setConfirmRemove(false)
      setOpen(false)
      toast({ title: "Supplier removed", description: result.message })
    } catch (err: any) {
      toast({
        title: "Could not remove the supplier",
        description: explain(err, "The change was refused."),
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!supplier}
        title={supplier ? "Correct this supplier's name" : "Choose a supplier to edit it"}
        aria-label="Edit supplier"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit supplier</DialogTitle>
            <DialogDescription>
              Every purchase, payment and due already recorded for this supplier follows the new
              name.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="supplier-edit-name">Supplier name</Label>
            <Input
              id="supplier-edit-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  rename()
                }
              }}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {isOwner ? (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove supplier
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={rename}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemove} onOpenChange={(o) => !busy && setConfirmRemove(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {supplier?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be offered when recording a purchase or payment. Their purchases,
              payments and dues stay exactly as they are, and old reports still show their name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                remove()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
