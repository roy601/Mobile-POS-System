/**
 * The shop's own word for something whose identity is fixed.
 *
 * 'owner_income' and 'party_payment' are values the application
 * branches on and cannot be renamed (see script 82). What a shop calls
 * them is a different matter, and this is where that lives: a map from
 * '<list>:<value>' to the shop's wording, empty for a shop that is
 * happy with the defaults.
 *
 * Records store the value, never the label, so changing the wording
 * re-labels every past record too — including ones already printed.
 */

export type ShopLabels = Record<string, string>

export type LabelList = "income_type" | "expense_category" | "income_subtype" | "owner_invest_to"

export const labelKey = (list: LabelList, value: string) => `${list}:${value}`

/**
 * The entries this shop has taken off its lists, as '<list>:<value>'.
 *
 * A built-in cannot be deleted — expenses.category is a CHECK listing
 * exactly those values, and every past record still points at one — so
 * "remove it" means "stop offering it". The value keeps working and the
 * history keeps its name; the entry just leaves the dropdown, and can
 * be put back. See script 87.
 */
export type HiddenOptions = Set<string>

export function isOptionHidden(
  hidden: HiddenOptions | undefined,
  list: LabelList,
  value: string,
): boolean {
  return hidden?.has(labelKey(list, value)) ?? false
}

/** The shop's wording where it gave one, ours where it did not. */
export function labelFor(
  labels: ShopLabels | undefined,
  list: LabelList,
  value: string,
  fallback: string,
): string {
  return (labels?.[labelKey(list, value)] ?? "").trim() || fallback
}
