/**
 * Today, in the shop's own time, as "YYYY-MM-DD" — what a date input
 * holds.
 *
 * `new Date().toISOString().slice(0, 10)` is the date in UTC, and
 * Bangladesh is six hours ahead: from midnight until 6 am it names
 * YESTERDAY. The device the shop uses keeps local time, so reading the
 * local calendar fields gives the right day. The database's
 * shop_today() (script 93) is the same date, fixed to Dhaka, and the
 * two must agree or a manager's entry is refused as "not today".
 */
export function shopToday(): string {
  return shopDay(0)
}

/**
 * How far back a manager may date an expense or an income entry.
 *
 * The shop asked for "the last 3 days": today and the three days
 * before it, four dates in all. A manager back after a couple of days
 * off can still enter what was spent while they were away; anything
 * older is the owner's to enter. The database enforces the same window
 * (script 95) — this constant and that one must agree.
 */
export const MANAGER_BACKDATE_DAYS = 3

/**
 * A day relative to today in the shop's own time, as "YYYY-MM-DD".
 * shopDay(-3) is three days ago. Date does the month and year
 * arithmetic, including over the end of a month.
 */
export function shopDay(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The oldest day a manager may still record against. */
export function managerEarliestDay(): string {
  return shopDay(-MANAGER_BACKDATE_DAYS)
}

/** Whether a yyyy-mm-dd day is one a manager may record against. */
export function withinManagerWindow(day: string): boolean {
  return !!day && day >= managerEarliestDay() && day <= shopToday()
}
