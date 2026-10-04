"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown, Loader2, Pencil, Plus, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { createClient } from "@/utils/supabase/component"
import { useRole } from "@/components/role-provider"
import { useToast } from "@/hooks/use-toast"

const supabase = createClient()

export type OptionKind =
  | "brand"
  | "category"
  | "product_name"
  | "model_number"
  | "variant"
  | "color"
  // Prices are a list the shop builds too — the same twenty figures
  // over and over. Stored as text like every other option; the form
  // parses them back. Needs script 64 for the widened CHECK.
  | "cost_price"
  | "sale_price"

type Option = { id: number; value: string }

/**
 * One line in the dropdown.
 *
 * `option` is null for a value the shop has genuinely stocked but which
 * is not in the saved list — entered before the list existed, or pruned
 * from it since. It is still offered, because refusing to show a brand
 * the shop demonstrably sells would be absurd; there is just nothing to
 * remove, so no delete button appears against it.
 */
type Row = { value: string; option: Option | null }

/** What has already been chosen further up the product hierarchy. */
export type OptionContext = {
  category?: string
  brand?: string
  product_name?: string
  model_number?: string
  /** Only colour and the prices read it — see "What was bought". */
  variant?: string
}

/**
 * Category narrows brand, brand narrows product name, and so on down.
 *
 * A field is narrowed only by the fields ABOVE it in this list, never by
 * the ones below. That is what the shop asked for and it is also the
 * only direction that behaves: narrowing upwards would mean picking a
 * model number quietly removed categories from the category list.
 *
 * The whole selection can therefore be handed to every field and each
 * one works out for itself which parts of it apply.
 */
const CASCADE_ORDER = ["category", "brand", "product_name", "model_number", "variant"] as const

/**
 * A dropdown that can be typed into, that remembers what you type, and
 * that can be tidied up.
 *
 * Stock entry in a phone shop is repetitive — the same twenty brands
 * and forty models over and over — but never quite fixed, because a new
 * model arrives every week. A plain <select> cannot cope with the new
 * arrival; a plain text box means "Samsung", "samsung" and "Samsng" all
 * end up in the reports as different brands.
 *
 * So: type to filter, and if what you typed is genuinely new, add it
 * with one click. It is saved to the shop's own list and offered from
 * then on. Obsolete entries can be removed from the list without
 * touching any product that used them.
 */
export function OptionCombobox({
  kind,
  value,
  onChange,
  placeholder = "Select or type…",
  label,
  id,
  disabled,
  className,
  onEnter,
  context,
  supplierId,
}: {
  kind: OptionKind
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  id?: string
  disabled?: boolean
  className?: string
  /**
   * The product being entered, so this list can show what actually
   * belongs with it first. Pass the whole selection — see CASCADE_ORDER
   * for how each field decides which parts of it constrain it.
   */
  context?: OptionContext
  /** Fired on Enter when the field already holds a value — lets the
   *  parent move focus on, keeping the keyboard flow intact. */
  onEnter?: () => void
  /**
   * Narrow the list to what this shop has actually bought FROM THIS
   * SUPPLIER.
   *
   * For the supplier promos screen: a promo belongs to one supplier,
   * and offering every brand in the shop invites a promo on a handset
   * that supplier has never sold — which then matches nothing at the
   * till, or worse, matches another supplier's stock.
   *
   * Applies to brand, product name, model and variant only; the other
   * lists are not things a supplier has an opinion about. Nothing is hidden for
   * good: "Show all" is still there, and a genuinely new value can
   * still be typed and added, which is what happens on the first
   * delivery of a model.
   */
  supplierId?: string | null
}) {
  const { currentShopId, accountType } = useRole()
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Inline rename, one row at a time.
  const [editingOf, setEditingOf] = useState<string | null>(null)
  const [editedTo, setEditedTo] = useState("")

  /**
   * Values this shop has actually stocked under the current selection.
   *
   * null means "not narrowing" — either nothing has been chosen above
   * this field, or the lookup was unavailable. An empty array is
   * different and means "asked, and this shop has never bought one".
   */
  const [matches, setMatches] = useState<string[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  const isOwner = accountType === "owner"

  /**
   * Who may do what with an entry (script 92).
   *
   * RENAME — anyone in the shop. These are the lists typed while taking
   * stock in, and a manager who saves "Samsng" should not have to find
   * the owner to fix a spelling. rename_shop_option carries every
   * record that used the old name along with it.
   *
   * REMOVE — the owner, on every list. Anyone, on the cost and
   * selling price lists (script 96).
   *
   * Removing an entry mid-shift changes what everyone else can pick,
   * which is why it is the owner's decision nearly everywhere. Prices
   * are the exception the shop asked for: the list fills with a new
   * figure on every purchase at a new cost, and the manager taking
   * stock in is the one facing a dropdown of two hundred numbers. A
   * colour is a fact about the product; a price is a number that was
   * true on one invoice.
   *
   * Nothing recorded changes either way — these lists only decide what
   * the dropdowns offer.
   *
   * The RLS policy in script 96 is what enforces this; the code here
   * only decides which buttons to show, so a stale build cannot grant
   * anything.
   */
  /** The four a supplier actually determines. */
  const supplierNarrows =
    !!supplierId &&
    (kind === "brand" || kind === "product_name" || kind === "model_number" || kind === "variant")

  const isPriceList = kind === "cost_price" || kind === "sale_price"
  const canRemove = isOwner || isPriceList
  const canRename = true

  const load = async () => {
    if (!currentShopId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("product_options")
        .select("id, value")
        .eq("organization_id", currentShopId)
        .eq("kind", kind)
        .order("value")
      if (error) throw error
      setOptions((data ?? []) as Option[])
    } catch (err: any) {
      // A dropdown that cannot load its list must not stop the user
      // typing a value — the field still works as a plain text input.
      console.error(`Could not load ${kind} options:`, err?.message ?? err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentShopId, kind])

  /**
   * The parts of the selection that constrain THIS field.
   *
   * Depends on the individual values rather than on `context` itself:
   * callers build that object inline, so it is a new object on every
   * render and using it as a dependency would refetch on every keystroke
   * anywhere on the form.
   */
  const ancestors = useMemo(() => {
    const rank = CASCADE_ORDER.indexOf(kind as (typeof CASCADE_ORDER)[number])
    // Not a cascading field (colour, prices), or the top of the
    // hierarchy — categories are narrowed by nothing.
    if (rank < 1 || !context) return null

    const above = (k: (typeof CASCADE_ORDER)[number], v?: string) =>
      CASCADE_ORDER.indexOf(k) < rank ? (v ?? "").trim() : ""

    const a = {
      p_category: above("category", context.category),
      p_brand: above("brand", context.brand),
      p_product_name: above("product_name", context.product_name),
      p_model_number: above("model_number", context.model_number),
    }
    return Object.values(a).some(Boolean) ? a : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, context?.category, context?.brand, context?.product_name, context?.model_number])

  /**
   * WHAT WAS BOUGHT: colour and the two prices, narrowed by the whole
   * product above them.
   *
   * They sit below the cascade, so everything chosen above applies:
   * a Camon Air 8+256 lists the colours and prices it has actually come
   * in at, not every colour and price the shop has ever typed. Read
   * straight off the purchases, as the supplier narrowing is. When the
   * product is new and nothing matches, the full list stands in, as it
   * does for every other field.
   */
  const productFilter = useMemo(() => {
    if (kind !== "color" && kind !== "cost_price" && kind !== "sale_price") return null
    if (!context) return null
    const f = {
      category: (context.category ?? "").trim(),
      brand: (context.brand ?? "").trim(),
      product_name: (context.product_name ?? "").trim(),
      model_number: (context.model_number ?? "").trim(),
      variant: (context.variant ?? "").trim(),
    }
    return Object.values(f).some(Boolean) ? f : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, context?.category, context?.brand, context?.product_name, context?.model_number, context?.variant])

  const contextKey =
    (ancestors ? Object.values(ancestors).join("|") : "") +
    (productFilter ? "#" + Object.values(productFilter).join("|") : "")
  const ancestorLabel = ancestors
    ? Object.values(ancestors).filter(Boolean).join(" › ")
    : productFilter
      ? Object.values(productFilter).filter(Boolean).join(" › ")
      : ""

  useEffect(() => {
    if (!open || !currentShopId || (!ancestors && !supplierNarrows && !productFilter)) {
      if (!ancestors && !supplierNarrows && !productFilter) setMatches(null)
      return
    }

    let cancelled = false
    ;(async () => {
      if (productFilter && !supplierNarrows) {
        const f = productFilter
        const isColor = kind === "color"
        const column = kind as "color" | "cost_price" | "sale_price"
        // Colour lives on the unit, prices on the purchase; either way
        // the purchase carries the product and the unit the variant.
        let q = isColor
          ? supabase
              .from("color_variants")
              .select("color, variant, purchases!inner(category, brand, product_name, model_number)")
              .eq("organization_id", currentShopId)
              .is("deleted_at", null)
              .not("color", "is", null)
          : supabase
              .from("purchases")
              .select(`${column}, color_variants!inner(variant)`)
              .eq("organization_id", currentShopId)
              .is("deleted_at", null)
              .not(column, "is", null)
        const on = isColor ? "purchases." : ""
        if (f.category) q = q.ilike(`${on}category`, f.category)
        if (f.brand) q = q.ilike(`${on}brand`, f.brand)
        if (f.product_name) q = q.ilike(`${on}product_name`, f.product_name)
        if (f.model_number) q = q.ilike(`${on}model_number`, f.model_number)
        if (f.variant) q = q.ilike(isColor ? "variant" : "color_variants.variant", f.variant)

        const { data, error } = await q.order("created_at", { ascending: false }).limit(1000)
        if (cancelled) return
        if (error) {
          console.warn(`Could not narrow the ${kind} list:`, error.message)
          setMatches(null)
          return
        }

        const seen = new Set<string>()
        const values: string[] = []
        for (const row of (data ?? []) as any[]) {
          const raw = row[column]
          if (raw == null || raw === "") continue
          // Prices are numbers in the purchase and text in the list:
          // 46012 and "46012" must be one entry.
          const v = isColor ? String(raw).trim() : String(Number(raw))
          const key = v.toLowerCase()
          if (!v || seen.has(key)) continue
          seen.add(key)
          values.push(v)
        }
        setMatches(values)
        return
      }

      // What this supplier has delivered, read straight off the
      // purchases. product_option_matches (script 85) knows how to
      // narrow by category and brand but nothing about who sold the
      // stock, and teaching it would be a migration for a list.
      if (supplierNarrows) {
        const column = kind as "brand" | "product_name" | "model_number" | "variant"

        // A variant is not on the purchase but on its colour rows, so
        // those are read instead, joined to the purchase they came in
        // on for the supplier and everything chosen above.
        const viaVariants = kind === "variant"
        const on = viaVariants ? "purchases." : ""

        let q = viaVariants
          ? supabase
              .from("color_variants")
              .select("variant, purchases!inner(supplier_id, brand, product_name, model_number)")
              .eq("organization_id", currentShopId)
              .eq("purchases.supplier_id", supplierId as string)
              .is("purchases.deleted_at", null)
          : supabase
              .from("purchases")
              .select(column)
              .eq("organization_id", currentShopId)
              .eq("supplier_id", supplierId as string)
        q = q.is("deleted_at", null).not(column, "is", null)

        // Still narrowed by what is chosen above it, so picking Tecno
        // leaves only Tecno's products from this supplier, and picking
        // the Camon 50 leaves only the variants of the Camon 50.
        const brand = (context?.brand ?? "").trim()
        const product = (context?.product_name ?? "").trim()
        const model = (context?.model_number ?? "").trim()
        if (kind !== "brand" && brand) q = q.ilike(`${on}brand`, brand)
        if ((kind === "model_number" || viaVariants) && product) {
          q = q.ilike(`${on}product_name`, product)
        }
        if (viaVariants && model) q = q.ilike(`${on}model_number`, model)

        const { data, error } = await q.limit(1000)
        if (cancelled) return

        if (error) {
          console.warn(`Could not narrow the ${kind} list to this supplier:`, error.message)
          setMatches(null)
          return
        }

        const seen = new Set<string>()
        const values: string[] = []
        for (const row of (data ?? []) as any[]) {
          const v = String(row[column] ?? "").trim()
          const key = v.toLowerCase()
          if (!v || seen.has(key)) continue
          seen.add(key)
          values.push(v)
        }
        setMatches(values)
        return
      }

      const { data, error } = await supabase.rpc("product_option_matches", {
        p_org: currentShopId,
        p_kind: kind,
        ...ancestors,
      })
      if (cancelled) return

      if (error) {
        // Script 85 may not have been run yet, or the lookup failed.
        // Either way the field must keep working exactly as it did
        // before: the full list, and anything can still be typed.
        console.warn(`Could not narrow the ${kind} list:`, error.message)
        setMatches(null)
        return
      }
      setMatches((data ?? []).map((r: { option_value: string }) => r.option_value))
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentShopId, kind, contextKey, supplierNarrows, supplierId, productFilter])

  // "Show all" is a way out of one particular narrowing, not a setting.
  useEffect(() => {
    setShowAll(false)
  }, [contextKey, open])

  const trimmed = query.trim()

  const allRows = useMemo<Row[]>(
    () => options.map((o) => ({ value: o.value, option: o })),
    [options]
  )

  /** The saved list cut down to what belongs with the current product. */
  const narrowed = useMemo<Row[]>(() => {
    if (!matches?.length) return []
    const byValue = new Map(options.map((o) => [o.value.toLowerCase(), o]))
    const seen = new Set<string>()
    const rows: Row[] = []

    const push = (v: string) => {
      const key = v.trim().toLowerCase()
      if (!key || seen.has(key)) return
      seen.add(key)
      const option = byValue.get(key)
      rows.push({ value: option?.value ?? v.trim(), option: option ?? null })
    }

    matches.forEach(push)
    // Never hide what is already selected. A field that cannot show its
    // own value looks broken, and this happens legitimately: the shop
    // types a brand new brand, then opens the list again to check it.
    if (value) push(value)

    return rows.sort((a, b) => a.value.localeCompare(b.value))
  }, [matches, options, value])

  /**
   * An empty `matches` means the shop has never bought one of these
   * under the current selection — the first Tecno phone, a category
   * added this morning. Showing an empty box there would stop stock
   * entry dead, so the full list stands in.
   */
  const narrowing = narrowed.length > 0 && !showAll
  const source = narrowing ? narrowed : allRows

  // How much of the saved list the narrowing is holding back. Counted
  // rather than compared by length, because `narrowed` can contain
  // values that are not in the saved list at all — so the two lengths
  // say nothing on their own about whether anything is hidden.
  const hidden = useMemo(() => {
    if (!narrowing) return 0
    const shown = new Set(narrowed.map((r) => r.value.toLowerCase()))
    return allRows.filter((r) => !shown.has(r.value.toLowerCase())).length
  }, [narrowing, narrowed, allRows])

  const filtered = useMemo(() => {
    if (!trimmed) return source
    const q = trimmed.toLowerCase()
    return source.filter((r) => r.value.toLowerCase().includes(q))
  }, [source, trimmed])

  // Only offer to create when it is genuinely new — comparing without
  // case so "samsung" does not get added alongside "Samsung".
  const canCreate =
    trimmed.length > 0 &&
    !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())

  const choose = (v: string) => {
    onChange(v)
    setQuery("")
    setOpen(false)
  }

  const create = async () => {
    if (!trimmed || !currentShopId) return
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from("product_options")
        .insert({ organization_id: currentShopId, kind, value: trimmed })
        .select("id, value")
        .single()

      if (error) {
        // Someone else added the same value first; that is a success
        // from the user's point of view, not an error.
        if (error.code === "23505") {
          choose(trimmed)
          load()
          return
        }
        throw error
      }

      setOptions((prev) => [...prev, data as Option].sort((a, b) => a.value.localeCompare(b.value)))
      choose(trimmed)
    } catch (err: any) {
      // Still let them use the value — it just will not be remembered.
      choose(trimmed)
      toast({
        title: "Could not save to the list",
        description: `"${trimmed}" has been used for this product, but was not added to the list for next time.`,
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Rename an entry, taking every record that used it along.
   *
   * Through the RPC rather than an UPDATE here, because a colour is
   * written into five tables and a rename that moved the dropdown but
   * not the stock rows would leave a shop unable to reconcile a stock
   * take. See script 87.
   */
  const rename = async (from: string) => {
    const to = editedTo.trim()
    if (!to || !currentShopId || to === from) {
      setEditingOf(null)
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc("rename_shop_option", {
        p_organization_id: currentShopId,
        p_kind: kind,
        p_old: from,
        p_new: to,
      })
      if (error) throw error

      const result = data as { success?: boolean; message?: string }
      if (!result?.success) {
        toast({
          title: "Could not rename that",
          description: result?.message ?? "The change was refused.",
          variant: "destructive",
        })
        return
      }

      setEditingOf(null)
      await load()
      // The field itself may be holding the old spelling.
      if (value === from) onChange(to)
      toast({ title: "Renamed", description: result.message })
    } catch (err: any) {
      toast({
        title: "Could not rename that",
        description:
          err?.code === "PGRST202"
            ? "This shop's database has not been updated yet. Ask your administrator to run script 87."
            : (err?.message ?? "The change was refused."),
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (opt: Option, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!currentShopId) return
    setBusy(true)
    try {
      // .select() so a refusal is visible. A delete blocked by
      // row-level security matches no rows and returns NO error, so
      // without this the list would report success, drop the entry
      // from the screen, and have it reappear on the next load.
      const { data, error } = await supabase
        .from("product_options")
        .delete()
        .eq("id", opt.id)
        .eq("organization_id", currentShopId)
        .select("id")
      if (error) throw error

      if (!data || data.length === 0) {
        toast({
          title: "Not allowed",
          description: isPriceList
            ? "This price could not be removed. Try again, or ask the shop owner."
            : "Only the shop owner can remove entries from this list.",
          variant: "destructive",
        })
        return
      }

      setOptions((prev) => prev.filter((o) => o.id !== opt.id))
      toast({
        title: "Removed from the list",
        description: `"${opt.value}" will no longer be offered. Products already using it are unchanged.`,
      })
    } catch (err: any) {
      toast({
        title: "Could not remove it",
        description: err?.message ?? "The option could not be deleted.",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {label}
        </label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground"
            )}
          >
            <span className="truncate">{value || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
          onOpenAutoFocus={(e) => {
            // Focus the search box, not the first option, so the user
            // can just start typing.
            e.preventDefault()
            searchRef.current?.focus()
          }}
        >
          <div className="border-b p-2">
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search or add…"
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  // Enter takes the exact match if there is one,
                  // otherwise the first result, otherwise creates.
                  const exact = filtered.find(
                    (o) => o.value.toLowerCase() === trimmed.toLowerCase()
                  )
                  if (exact) choose(exact.value)
                  else if (filtered.length > 0) choose(filtered[0].value)
                  else if (canCreate) create()
                }
                if (e.key === "Escape") setOpen(false)
              }}
            />
          </div>

          {/* Says why the list is short, so a missing entry reads as
              "not stocked under this selection" rather than "lost". */}
          {narrowing && (
            <p className="border-b bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
              Stocked under{" "}
              <span className="font-medium text-foreground">{ancestorLabel}</span>
            </p>
          )}

          <div className="max-h-[240px] overflow-y-auto p-1">
            {loading && (
              <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
            )}

            {!loading && filtered.length === 0 && !canCreate && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Nothing here yet — start typing to add the first one.
              </p>
            )}

            {filtered.map((row) =>
              editingOf === row.value ? (
                <div
                  key={row.value.toLowerCase()}
                  className="flex items-center gap-1 rounded-sm p-1"
                >
                  <Input
                    autoFocus
                    value={editedTo}
                    onChange={(e) => setEditedTo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        rename(row.value)
                      }
                      if (e.key === "Escape") {
                        e.preventDefault()
                        setEditingOf(null)
                      }
                    }}
                    className="h-8"
                  />
                  <button
                    type="button"
                    onClick={() => rename(row.value)}
                    disabled={busy || !editedTo.trim()}
                    className="rounded px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingOf(null)}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
              <div
                key={row.value.toLowerCase()}
                className="group flex items-center justify-between gap-1 rounded-sm hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => choose(row.value)}
                  className="flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === row.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{row.value}</span>
                </button>

                {/* Fixing a typo without losing the records that used
                    it — see canRename. Offered on names that come only
                    from past purchases too: a spelling saved on a
                    product but never added to the list is exactly the
                    kind that needs correcting, and the rename carries
                    those records all the same. */}
                {canRename && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setEditingOf(row.value)
                      setEditedTo(row.value)
                    }}
                    disabled={busy}
                    aria-label={`Rename ${row.value}`}
                    title="Rename"
                    className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* The owner only — see canRemove above.
                    `row.option` is null for a value that comes from the
                    shop's purchase history but is not in the saved list
                    — there is nothing there to delete. */}
                {canRemove && row.option && (
                  <button
                    type="button"
                    onClick={(e) => remove(row.option!, e)}
                    disabled={busy}
                    aria-label={`Remove ${row.value} from the list`}
                    title="Remove from list"
                    className="mr-1 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              )
            )}

            {canCreate && (
              <button
                type="button"
                onClick={create}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  Add <span className="font-medium">&quot;{trimmed}&quot;</span>
                </span>
              </button>
            )}
          </div>

          {/* The narrowing is a shortcut, never a wall. A shop that
              starts selling covers under a category it has only ever
              used for handsets must be able to reach the whole list
              without undoing what it has already filled in. */}
          {narrowing && hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full border-t px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Show all {allRows.length} — {hidden} not stocked under this
            </button>
          )}
        </PopoverContent>
      </Popover>

      {/* Hidden input so Enter-to-advance keyboard flow still works from
          the closed control, matching the rest of the form. */}
      {onEnter && (
        <input
          type="text"
          className="sr-only"
          tabIndex={-1}
          value={value}
          readOnly
          onKeyDown={(e) => {
            if (e.key === "Enter" && value) {
              e.preventDefault()
              onEnter()
            }
          }}
        />
      )}
    </div>
  )
}
