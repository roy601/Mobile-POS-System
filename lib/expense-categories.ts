/**
 * The expense heads that ship with the system.
 *
 * One list, because there were three: the Expenses screen had its own,
 * the Ledger had a second, and the Day Cashbook had none at all and
 * printed the raw column — "party_payment - Ismartu Technology Bd Ltd"
 * — on a sheet the owner reads every evening.
 *
 * `other` is the escape hatch rather than a head: it means the wording
 * is on the expense itself, in custom_category. The shop's own heads
 * live in product_options (script 81), and the WORDING of the ones
 * below can be changed per shop (script 82) without the values moving,
 * because expenses.category is a CHECK constraint listing exactly
 * these.
 */

export const EXPENSE_CATEGORIES = [
  { value: "party_payment", label: "Supplier Payment" },
  { value: "salaries", label: "Salaries" },
  { value: "printer_papers", label: "Printer Papers" },
  { value: "water_bill", label: "Water Bill" },
  { value: "mobile_bill", label: "Mobile Bill" },
  { value: "internet_bill", label: "Internet Bill" },
  { value: "land_bill", label: "Land Bill" },
  { value: "bank_charge", label: "Bank Charge" },
  { value: "shopping_bag", label: "Shopping Bag" },
  { value: "entertainment", label: "Entertainment" },
  { value: "office_supplies", label: "Office Supplies" },
  // Money drawn out by the owner — the mirror of 'owner_income'.
  // A head the reports branch on rather than a custom category,
  // because Gross Profit depends on telling it apart from the cost of
  // running the shop. See script 88.
  { value: "owner_payment", label: "Paid To Owner" },
  { value: "other", label: "Other (Custom)" },
] as const

/** Default label for a stored category value. */
export const EXPENSE_HEADS: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label]),
)

/**
 * Heads that are money leaving the till but NOT the cost of trading.
 *
 * Both are excluded from Shop Expense in the Profit & Loss, and both
 * are counted in Total Expense:
 *
 *   party_payment  — settling a supplier is buying stock.
 *   owner_payment  — the owner drawing their own money out.
 *
 * Counting either as a cost of running the shop would make Net Profit
 * fall every time the shop restocked or the owner took money, which is
 * the opposite of what those two events mean.
 */
export const NON_TRADING_EXPENSE_HEADS = ["party_payment", "owner_payment"] as const

/**
 * Stock arriving from a sister shop, which the transfer records as an
 * expense (scripts 60 and 62) under 'other' with this wording.
 *
 * It is stock bought, not the cost of running the shop, so it is kept
 * out of Shop Expense for the same reason party_payment is.
 */
export const STOCK_TRANSFER_CATEGORY = "Stock Transfer"

/** True when this expense is buying stock or paying the owner. */
export function isNonTradingExpense(row: {
  category?: string | null
  custom_category?: string | null
}): boolean {
  const head = (row.category ?? "").trim()
  if ((NON_TRADING_EXPENSE_HEADS as readonly string[]).includes(head)) return true
  return (
    head === "other" &&
    (row.custom_category ?? "").trim().toLowerCase() ===
      STOCK_TRANSFER_CATEGORY.toLowerCase()
  )
}

/** The heads a shop may re-word but never remove. */
export const BUILT_IN_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES.filter(
  (c) => c.value !== "other",
).map((c) => ({ value: c.value, defaultLabel: c.label }))
