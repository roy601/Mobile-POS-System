"use client"

import { useCallback, useEffect, useState } from "react"
import { Eye, EyeOff, Loader2, Pencil, Plus, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/utils/supabase/component"
import {
  isOptionHidden,
  labelFor,
  labelKey,
  type HiddenOptions,
  type ShopLabels,
} from "@/lib/shop-labels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

const supabase = createClient()

/**
 * The shop's own dropdown entries, managed in one place.
 *
 * Income types and expense categories are the same thing twice: a list
 * the shop writes for itself, stored in product_options, where the
 * WORDING is the key that records are filed under. So both get the
 * same dialog rather than two that drift apart.
 *
 * Renaming goes through rename_shop_option (script 81) because it has
 * to carry the history with it — the records hold the text, not an id,
 * so renaming the entry alone would leave every past record filed
 * under the old spelling. That cannot be done from here in two
 * queries; it needs the one transaction.
 */

export type OptionKind = "income_type" | "expense_category" | "income_subtype" | "owner_invest_to"

/** A built-in entry: a fixed value the shop may re-word but not remove. */
export type BuiltInOption = { value: string; defaultLabel: string }

export function OptionManager({
  open,
  onOpenChange,
  shopId,
  kind,
  title,
  /** Singular, lower case — "income type", "expense category". */
  noun,
  /**
   * The entries that ship with the system. They can be RENAMED but
   * never removed: the application branches on their values, and
   * expenses.category is a CHECK constraint listing them. Renaming one
   * writes a label override; the value underneath never moves.
   */
  builtIns = [],
  hidden,
  /** The shop's current wording, from useShopLabels. */
  labels = {},
  /** Runs after anything changes, so the caller can reload its list. */
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  shopId: string | null
  kind: OptionKind
  title: string
  noun: string
  builtIns?: BuiltInOption[]
  /** Which entries this shop has taken off the list (script 87). */
  hidden?: HiddenOptions
  labels?: ShopLabels
  onChanged: () => void | Promise<void>
}) {
  const [values, setValues] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [adding, setAdding] = useState("")
  const [editingOf, setEditingOf] = useState<string | null>(null)
  const [editedTo, setEditedTo] = useState("")

  // Confirming a delete needs the usage count, which is a round trip —
  // so it is fetched when the confirmation opens, not for every row.
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteUses, setDeleteUses] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!shopId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("product_options")
        .select("value")
        .eq("organization_id", shopId)
        .eq("kind", kind)
        .order("value")
      if (error) throw error
      setValues((data ?? []).map((r: { value: string }) => r.value))
    } catch (err: any) {
      toast.error(`Could not load the ${noun} list`, { description: err?.message })
    } finally {
      setLoading(false)
    }
  }, [shopId, kind, noun])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const done = async (message: string) => {
    toast.success(message)
    await load()
    await onChanged()
  }

  const add = async () => {
    const name = adding.trim()
    if (!name || !shopId) return
    setBusy("add")
    try {
      const { error } = await supabase
        .from("product_options")
        .insert({ organization_id: shopId, kind, value: name })

      // Already there is a success from the user's point of view.
      if (error && error.code !== "23505") {
        toast.error("Could not add that", {
          description:
            error.code === "23514"
              ? "This shop's database has not been updated yet. Ask your administrator to run script 81."
              : error.message,
        })
        return
      }
      setAdding("")
      await done(`"${name}" added`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Re-word a built-in.
   *
   * An override row, not a rename: the value stays exactly as it is, so
   * everything that branches on it keeps working and every past record
   * picks up the new wording for free. Clearing it back to our default
   * deletes the row rather than storing our own words as if the shop
   * had chosen them.
   */
  const relabel = async (value: string, defaultLabel: string, next: string) => {
    if (!shopId) return
    const wanted = next.trim()
    if (!wanted) return
    setBusy(value)
    try {
      const key = labelKey(kind, value)
      // Resetting the WORDING must not also un-hide the entry: those
      // are two separate decisions living in one row, and deleting it
      // would silently undo the other one.
      const off = isOptionHidden(hidden, kind, value)
      const { error } =
        wanted === defaultLabel && !off
          ? await supabase
              .from("shop_labels")
              .delete()
              .eq("organization_id", shopId)
              .eq("key", key)
          : await supabase
              .from("shop_labels")
              .upsert(
                { organization_id: shopId, key, label: wanted, hidden: off },
                { onConflict: "organization_id,key" },
              )

      if (error) throw error
      setEditingOf(null)
      await done(wanted === defaultLabel ? "Reset to the default name" : "Renamed")
    } catch (err: any) {
      toast.error("Could not rename that", {
        description:
          // 42P01 undefined_table: script 82 has not been run here yet.
          err?.code === "42P01" || /shop_labels/i.test(String(err?.message ?? ""))
            ? "This shop's database has not been updated yet. Ask your administrator to run script 82."
            : err?.code === "42501"
              ? "Only the shop owner can rename these."
              : err?.message,
      })
    } finally {
      setBusy(null)
    }
  }

  /**
   * Take a built-in off the list, or put it back.
   *
   * Not a delete. expenses.category is a CHECK listing exactly these
   * values and every past record still points at one, so the row stays
   * and simply stops being offered — see script 87. The wording in
   * force is written alongside, so anything already filed under it
   * keeps its name and gets it back if the entry is restored.
   */
  const setBuiltInHidden = async (
    value: string,
    defaultLabel: string,
    hide: boolean,
  ) => {
    if (!shopId) return
    setBusy(value)
    try {
      const key = labelKey(kind, value)
      const current = labelFor(labels, kind, value, defaultLabel)
      // Putting back something that was never renamed leaves nothing
      // worth storing, so the row goes rather than recording our own
      // default as if the shop had chosen it.
      const drop = !hide && current === defaultLabel

      const { error } = drop
        ? await supabase
            .from("shop_labels")
            .delete()
            .eq("organization_id", shopId)
            .eq("key", key)
        : await supabase.from("shop_labels").upsert(
            { organization_id: shopId, key, label: current, hidden: hide },
            { onConflict: "organization_id,key" },
          )

      if (error) throw error
      await done(hide ? `"${current}" removed from the list` : `"${current}" is back`)
    } catch (err: any) {
      toast.error(hide ? "Could not remove that" : "Could not restore that", {
        description:
          err?.code === "42703" || /hidden/i.test(String(err?.message ?? ""))
            ? "This shop's database has not been updated yet. Ask your administrator to run script 87."
            : err?.code === "42501"
              ? "Only the shop owner can change these."
              : err?.message,
      })
    } finally {
      setBusy(null)
    }
  }

  const rename = async (from: string) => {
    const to = editedTo.trim()
    if (!to || !shopId) return
    if (to === from) {
      setEditingOf(null)
      return
    }
    setBusy(from)
    try {
      const { data, error } = await supabase.rpc("rename_shop_option", {
        p_organization_id: shopId,
        p_kind: kind,
        p_old: from,
        p_new: to,
      })
      if (error) throw error
      const result = data as { success?: boolean; message?: string }
      if (!result?.success) {
        toast.error(result?.message ?? "Could not rename that")
        return
      }
      setEditingOf(null)
      await done(result.message ?? "Renamed")
    } catch (err: any) {
      toast.error("Could not rename that", {
        description:
          err?.code === "PGRST202"
            ? "This shop's database has not been updated yet. Ask your administrator to run script 81."
            : err?.message,
      })
    } finally {
      setBusy(null)
    }
  }

  const askDelete = async (value: string) => {
    setDeleting(value)
    setDeleteUses(null)
    if (!shopId) return
    const { data, error } = await supabase.rpc("shop_option_usage", {
      p_organization_id: shopId,
      p_kind: kind,
      p_value: value,
    })
    // A count that cannot be read is left unknown rather than shown as
    // zero — "used by 0 records" would be a reason to delete, and it
    // would be a guess.
    setDeleteUses(error ? null : Number(data ?? 0))
  }

  const confirmDelete = async () => {
    const value = deleting
    if (!value || !shopId) return
    setBusy(value)
    try {
      const { data, error } = await supabase.rpc("delete_shop_option", {
        p_organization_id: shopId,
        p_kind: kind,
        p_value: value,
      })
      if (error) throw error
      const result = data as { success?: boolean; message?: string }
      if (!result?.success) {
        toast.error(result?.message ?? "Could not remove that")
        return
      }
      await done(result.message ?? "Removed")
    } catch (err: any) {
      toast.error("Could not remove that", {
        description:
          err?.code === "PGRST202"
            ? "This shop's database has not been updated yet. Ask your administrator to run script 81."
            : err?.message,
      })
    } finally {
      setBusy(null)
      setDeleting(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Rename any {noun} to whatever this shop calls it, and take the
              ones you do not use off the list. The ones you added are deleted
              outright; a built-in is only hidden, because past records still
              point at it — it stops being offered and can be put back. Every
              past record follows a new name, so reports stay in one piece.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              placeholder={`New ${noun}`}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  add()
                }
              }}
            />
            <Button onClick={add} disabled={busy === "add" || !adding.trim()}>
              {busy === "add" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-2">Add</span>
            </Button>
          </div>

          <div className="max-h-[320px] space-y-1 overflow-y-auto">
            {builtIns.length > 0 && (
              <>
                <p className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Built in
                </p>
                {builtIns.map((b) => {
                  const current = labelFor(labels, kind, b.value, b.defaultLabel)
                  const renamed = current !== b.defaultLabel
                  const off = isOptionHidden(hidden, kind, b.value)
                  const rowKey = `builtin:${b.value}`

                  return (
                    <div
                      key={rowKey}
                      className="flex items-center gap-2 rounded-md border px-3 py-2"
                    >
                      {editingOf === rowKey ? (
                        <>
                          <Input
                            autoFocus
                            value={editedTo}
                            onChange={(e) => setEditedTo(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault()
                                relabel(b.value, b.defaultLabel, editedTo)
                              }
                              if (e.key === "Escape") setEditingOf(null)
                            }}
                            className="h-8"
                          />
                          <Button
                            size="sm"
                            onClick={() => relabel(b.value, b.defaultLabel, editedTo)}
                            disabled={busy === b.value || !editedTo.trim()}
                          >
                            {busy === b.value ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingOf(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <span
                            className={`flex-1 truncate text-sm ${
                              off ? "text-muted-foreground line-through" : ""
                            }`}
                          >
                            {current}
                            {renamed && (
                              <span className="ml-2 text-xs text-muted-foreground no-underline">
                                was {b.defaultLabel}
                              </span>
                            )}
                          </span>
                          {/* Hidden, not deleted: the application
                              branches on these values and past records
                              still point at them. See script 87. */}
                          <Button
                            size="icon"
                            variant="ghost"
                            title={
                              off
                                ? `Put "${current}" back on the list`
                                : `Take "${current}" off the list`
                            }
                            onClick={() =>
                              setBuiltInHidden(b.value, b.defaultLabel, !off)
                            }
                            disabled={busy === b.value}
                          >
                            {off ? (
                              <Eye className="h-4 w-4" />
                            ) : (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                          {renamed && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() =>
                                relabel(b.value, b.defaultLabel, b.defaultLabel)
                              }
                              disabled={busy === b.value}
                            >
                              Reset
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title={`Rename "${current}"`}
                            onClick={() => {
                              setEditingOf(rowKey)
                              setEditedTo(current)
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  )
                })}
                <p className="pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Added by this shop
                </p>
              </>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : values.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                This shop has not added any {noun}s yet.
              </p>
            ) : (
              values.map((value) => (
                <div
                  key={value}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  {editingOf === value ? (
                    <>
                      <Input
                        autoFocus
                        value={editedTo}
                        onChange={(e) => setEditedTo(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            rename(value)
                          }
                          if (e.key === "Escape") setEditingOf(null)
                        }}
                        className="h-8"
                      />
                      <Button
                        size="sm"
                        onClick={() => rename(value)}
                        disabled={busy === value || !editedTo.trim()}
                      >
                        {busy === value ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingOf(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm">{value}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Rename "${value}"`}
                        onClick={() => {
                          setEditingOf(value)
                          setEditedTo(value)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Remove "${value}"`}
                        onClick={() => askDelete(value)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &quot;{deleting}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUses === null
                ? "It will no longer be offered when recording a new entry."
                : deleteUses === 0
                  ? "Nothing is filed under it. It will no longer be offered when recording a new entry."
                  : `${deleteUses} record${deleteUses === 1 ? "" : "s"} ${
                      deleteUses === 1 ? "is" : "are"
                    } filed under it. Those keep their wording and still appear on reports — but you will no longer be able to pick it for a new entry, or filter by it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
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

/** The button that opens it. Owner-only — render nothing otherwise. */
export function ManageOptionsButton({
  isOwner,
  onClick,
  label = "Manage list",
}: {
  isOwner: boolean
  onClick: () => void
  label?: string
}) {
  if (!isOwner) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Settings2 className="h-4 w-4" />
    </Button>
  )
}
