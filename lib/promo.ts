/**
 * Supplier promos: the discount the supplier pays for.
 *
 * A supplier runs a promo on one model — 200 taka off the Tecno Camon
 * 50 — and the shop sells it 200 below its own price. Weeks later the
 * supplier pays the total back. The 200 is therefore two facts at
 * once, and they have to be kept apart:
 *
 *   the discount   money off the customer's price. Ordinary, already
 *                  handled: it goes into the line's discount.
 *   the claim      how much of that discount the supplier owes back.
 *                  This is the new part, and it is what the shop had
 *                  been keeping on paper.
 *
 * Everything here is shared by the till, the Promos tab and the
 * printed statement, so the three cannot drift on what matches what
 * or on what a claim comes to. Scripts 98 and 99 hold the database
 * side.
 */

/** A promo as the database keeps it. */
export type SupplierPromo = {
  id: number
  organization_id: string
  supplier_id: string
  brand: string
  product_name: string
  model_number: string | null
  /**
   * One variant of the model — "8/256" — or null for every variant.
   * Optional because a database without script 100 has no column.
   */
  variant?: string | null
  amount: number
  starts_on: string
  ends_on: string | null
  note: string | null
  deleted_at: string | null
}

/** A promo with what it has earned, from the supplier_promo_claims view. */
export type PromoClaim = SupplierPromo & {
  promo_id: number
  units_sold: number
  units_returned: number
  claimed: number
  returned_amount: number
  received: number
  outstanding: number
}

/** What a sale line needs to know about the promo it was sold on. */
export type PromoOnLine = {
  id: number
  amount: number
  label: string
}

/**
 * The columns the claims view returns. One place, because the tab,
 * the till and the report all read it.
 */
export const PROMO_CLAIM_COLUMNS_WITHOUT_VARIANT =
  "promo_id, organization_id, supplier_id, brand, product_name, model_number, amount, " +
  "starts_on, ends_on, note, deleted_at, units_sold, units_returned, claimed, " +
  "returned_amount, received, outstanding"

export const PROMO_CLAIM_COLUMNS = PROMO_CLAIM_COLUMNS_WITHOUT_VARIANT + ", variant"

/** The columns the till reads off supplier_promos. */
export const PROMO_COLUMNS_WITHOUT_VARIANT =
  "id, organization_id, supplier_id, brand, product_name, model_number, amount, " +
  "starts_on, ends_on, note, deleted_at"

export const PROMO_COLUMNS = PROMO_COLUMNS_WITHOUT_VARIANT + ", variant"

/**
 * Whether a query failed only because the database has not run
 * script 100, so the variant column is not there yet.
 *
 * The caller asks again without it. Promos then cover every variant,
 * which is what they did before — far better than the till quietly
 * offering no promos at all.
 */
export function isMissingPromoVariant(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === "42703" ||
    (error.code === "PGRST204" && /\bvariant\b/i.test(error.message ?? "")) ||
    /\bvariant\b.*does not exist/i.test(error.message ?? "")
  )
}

/**
 * Loosely, for matching: trimmed and lower-cased, with runs of
 * whitespace closed up.
 *
 * The same model reaches the till from three directions — a scanned
 * barcode, a name lookup, a suggestion — and reaches a promo from a
 * person typing it. "Camon  50" and "camon 50" are the same handset,
 * and a promo that missed on a double space would be silently worth
 * nothing.
 */
export function promoKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

/** What the till knows about the item in front of it. */
type PromoItem = {
  brand?: string | null
  name?: string | null
  model?: string | null
  variant?: string | null
}

/**
 * Whether a promo covers this item.
 *
 * The product must match. The model matters only when the promo names
 * one: a promo on "Tecno / Camon" with no model covers every Camon,
 * which is how a supplier sometimes announces it. The variant is the
 * same: a promo on the 8/256 does not cover the 4/128, which the
 * supplier prices — and funds — differently.
 *
 * The brand is checked only when the till knows it. A scanned handset
 * carries its brand (get_product_by_barcode returns it), but a name
 * suggestion does not — search_product_names never selected the
 * column. Refusing the promo there would mean it applied to a scanned
 * sale and not to the same handset chosen by name, which is worse
 * than the far-fetched case this guards against: two shops' brands
 * sharing a product name.
 */
export function promoCoversItem(
  promo: Pick<SupplierPromo, "brand" | "product_name" | "model_number" | "variant">,
  item: PromoItem,
): boolean {
  const itemBrand = promoKey(item.brand)
  if (itemBrand && promoKey(promo.brand) !== itemBrand) return false
  if (promoKey(promo.product_name) !== promoKey(item.name)) return false
  if (promo.model_number && promoKey(promo.model_number) !== promoKey(item.model)) return false
  if (promo.variant && promoKey(promo.variant) !== promoKey(item.variant)) return false
  return true
}

/**
 * Whether a promo is running on a given day (yyyy-mm-dd).
 *
 * Compared as strings, which is exact for this format and avoids the
 * timezone trap that has bitten this app before: `new Date("2026-09-28")`
 * is midnight UTC, which is still the 27th in Dhaka.
 */
export function promoRunsOn(
  promo: Pick<SupplierPromo, "starts_on" | "ends_on" | "deleted_at">,
  day: string,
): boolean {
  if (promo.deleted_at) return false
  if (promo.starts_on > day) return false
  if (promo.ends_on && promo.ends_on < day) return false
  return true
}

/**
 * The promo to offer for an item today, or null.
 *
 * Where two could apply — a promo on the model and another on the
 * whole product — the more specific one wins, and the bigger amount
 * breaks a tie. Naming the model counts for more than naming only a
 * variant: "Camon 50" is narrower than "every Camon in 8/256", and
 * "Camon 50 8/256" is narrower than both. The alternative is offering whichever the database
 * happened to return first, which would pay differently on two
 * identical sales.
 */
export function promoForItem(
  promos: SupplierPromo[],
  item: PromoItem,
  day: string,
): SupplierPromo | null {
  const fits = promos.filter((p) => promoRunsOn(p, day) && promoCoversItem(p, item))
  if (fits.length === 0) return null
  return fits.sort((a, b) => {
    const specific = (p: SupplierPromo) => (p.model_number ? 2 : 0) + (p.variant ? 1 : 0)
    return specific(b) - specific(a) || Number(b.amount) - Number(a.amount)
  })[0]
}

/** "Tecno Camon 50 8/256", for a line on screen or on the statement. */
export function promoLabel(
  promo: Pick<SupplierPromo, "brand" | "product_name" | "model_number" | "variant">,
): string {
  return [promo.brand, promo.product_name, promo.model_number, promo.variant]
    .filter(Boolean)
    .join(" ")
}

/** "1 Sep 2026 – 30 Sep 2026", or "from 1 Sep 2026" while it is open. */
export function promoPeriod(promo: Pick<SupplierPromo, "starts_on" | "ends_on">): string {
  const day = (value: string) => {
    const [y, m, d] = value.split("-")
    return `${d}/${m}/${y}`
  }
  return promo.ends_on ? `${day(promo.starts_on)} – ${day(promo.ends_on)}` : `from ${day(promo.starts_on)}`
}

/** Rounded to the poisha, the way every other money figure here is. */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * What a sold line's promo comes to: per unit, times the quantity.
 */
export function linePromo(line: { promo_amount?: unknown; quantity?: unknown }): number {
  return round2((Number(line.promo_amount) || 0) * (Number(line.quantity) || 0))
}

/**
 * A sold line as the SHOP counts it: the supplier's promo is not the
 * shop's discount.
 *
 * At the till the promo still comes off what the customer pays, and it
 * is stored that way -- inside the line's discount -- so cash, dues and
 * the cashbook are exactly what was taken. But the supplier pays that
 * money back, so to the shop the handset sold at full price: the promo
 * is added back to the line's value and taken out of its discount.
 * Every sale figure the shop reads (sales, discount, profit) goes
 * through here; what the customer paid never does.
 */
export function promoAsSaleValue<
  T extends { total_price?: unknown; discount_amount?: unknown; promo_amount?: unknown; quantity?: unknown },
>(line: T): T {
  const promo = linePromo(line)
  if (!promo) return line
  return {
    ...line,
    total_price: round2((Number(line.total_price) || 0) + promo),
    discount_amount: round2(
      Math.max(0, (Number(line.discount_amount) || 0) - (Number(line.promo_amount) || 0)),
    ),
  }
}
