/**
 * What to call a kind of income.
 *
 * income_type holds a machine value the application branches on —
 * the supplier field appears for 'party_income' and not otherwise.
 * 'other' means the shop named this one itself, and the wording is in
 * custom_type beside it (script 67).
 *
 * Shared rather than repeated because it was repeated: the Income
 * screen, the ledger and the day cashbook each had their own
 * `x === 'owner_income' ? … : 'Supplier Income'`, so anything that was
 * not one of the two original values printed as the other one. A shop
 * that files rent income would have found it labelled as coming from a
 * supplier on three different reports.
 */

import { labelFor, type ShopLabels } from "@/lib/shop-labels"

/**
 * What a supplier payment was for — the second level of the tree:
 *
 *   Income Type ─┬─ Owner Invest
 *                └─ Supplier Paid to Shop ─┬─ BM
 *                                          ├─ Incentive
 *                                          └─ Demo Adjust
 *
 * Only 'party_income' carries one. The list itself lives in
 * product_options under this kind (script 86), so the owner can rename,
 * remove and add to it exactly like every other dropdown in the shop —
 * these three are the seed, not the whole set, so nothing here should
 * ever branch on the particular words.
 */
export const INCOME_SUBTYPE_KIND = "income_subtype"

/**
 * The same second level, for Owner Invest: where the owner's money went
 * — into stock, into the till. Its own list (script 91), because the
 * words a shop uses for one have nothing to do with the other.
 */
export const OWNER_INVEST_TO_KIND = "owner_invest_to"

export type SubtypeKind = typeof INCOME_SUBTYPE_KIND | typeof OWNER_INVEST_TO_KIND

export type SubtypeField = {
  kind: SubtypeKind
  label: string
  placeholder: string
  noun: string
}

/**
 * Which second box a kind of income asks for, if any.
 *
 * Both sit in income_owner.income_subtype. One column is enough because
 * a row has exactly one income_type, and that decides which list its
 * sub-type came from — the two can never be confused on the same row.
 */
export function subtypeFieldFor(type: string | null | undefined): SubtypeField | null {
  if (type === "party_income") {
    return {
      kind: INCOME_SUBTYPE_KIND,
      label: "Paid For",
      placeholder: "BM, Incentive, Demo Adjust…",
      noun: "supplier payment type",
    }
  }
  if (type === "owner_income") {
    return {
      kind: OWNER_INVEST_TO_KIND,
      label: "To",
      placeholder: "As stock, cash…",
      noun: "owner investment destination",
    }
  }
  return null
}

export const BUILT_IN_INCOME_TYPES = [
  { value: "owner_income", label: "Owner Income" },
  { value: "party_income", label: "Supplier Income" },
] as const

/**
 * `labels` is the shop's own wording for the two built-ins, from
 * useShopLabels (script 82). The VALUE never changes — the supplier
 * field still keys off 'party_income' — only what it is called. Passing
 * nothing keeps our defaults, which is what every report did before the
 * shop could rename anything.
 */
export function incomeTypeLabel(
  type: string | null | undefined,
  customType?: string | null,
  labels?: ShopLabels,
  // Optional so that every caller written before sub-types existed
  // keeps working and simply shows the heading on its own.
  subtype?: string | null,
): string {
  if (type === "owner_income") {
    const head = labelFor(labels, "income_type", "owner_income", "Owner Income")
    const detail = (subtype ?? "").trim()
    return detail ? `${head} — ${detail}` : head
  }
  if (type === "party_income") {
    const head = labelFor(labels, "income_type", "party_income", "Supplier Income")
    const detail = (subtype ?? "").trim()
    // Both halves, because either alone loses something: "Supplier Paid
    // to Shop" does not say what for, and "BM" does not say it came
    // from a supplier at all.
    return detail ? `${head} — ${detail}` : head
  }
  // Falls back rather than showing a blank: a row with no wording
  // should still read as something on a printed report.
  return (customType ?? "").trim() || "Other Income"
}

/**
 * The Select carries one string per choice, but a custom type is two
 * facts — 'other' plus the wording. These pack and unpack that, so the
 * form never has to hold a second piece of state that can drift out of
 * step with the first.
 */
export const CUSTOM_PREFIX = "custom:"

export function packIncomeType(type: string, customType?: string | null) {
  return type === "other" ? `${CUSTOM_PREFIX}${(customType ?? "").trim()}` : type
}

export function unpackIncomeType(value: string): {
  income_type: string
  custom_type: string | null
} {
  if (value.startsWith(CUSTOM_PREFIX)) {
    return {
      income_type: "other",
      custom_type: value.slice(CUSTOM_PREFIX.length).trim() || null,
    }
  }
  return { income_type: value, custom_type: null }
}

/**
 * "That column does not exist" — script 67 has not been run here yet.
 *
 * The app and the database are versioned independently: SQL is applied
 * by hand, and a till can update before the migration lands. Asking for
 * custom_type against an older database is a hard PostgREST failure, so
 * every read of it has to be able to fall back to the columns that were
 * always there. Without this the Ledger and the Day Cashbook go blank —
 * not degraded, blank — until someone opens the SQL editor.
 */
export function isMissingCustomType(error: any): boolean {
  return isMissingColumn(error, "custom_type")
}

/** The same, for income_subtype — script 86. */
export function isMissingIncomeSubtype(error: any): boolean {
  return isMissingColumn(error, "income_subtype")
}

function isMissingColumn(error: any, column: string): boolean {
  if (!error) return false
  // 42703 is Postgres "undefined column"; PGRST204 is PostgREST's own
  // "column not found in schema cache", which is what a stale cache
  // gives instead.
  if (error.code === "42703" || error.code === "PGRST204") return true
  return new RegExp(column, "i").test(String(error.message ?? ""))
}
