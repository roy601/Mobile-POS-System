/**
 * What is actually in the drawer, on a given date.
 *
 * ONE IMPLEMENTATION, BECAUSE THERE WERE TWO AND THEY DISAGREED
 *
 * The Day Cashbook worked this out one way and the Ledger another, and
 * the Ledger's was wrong in three separate ways at once:
 *
 *   * it SUBTRACTED bank and digital receipts. That money never
 *     reached the drawer, so it should simply not be counted — taking
 *     it away treats a card payment as if cash had left the shop.
 *
 *   * it subtracted every PURCHASE as well as the supplier payments
 *     that settle them. Buying stock on credit takes nothing out of
 *     the till; the payment does, and the payment is already an
 *     expense. The same stock came off the cash twice.
 *
 *   * it ignored the opening-balance baseline entirely, so a shop that
 *     had set one was short by whatever was in the drawer on day one.
 *
 * For Star Power 01 the two answered 147,142 and -2,367,321 for the
 * same day. The Profit & Loss printed the second, because that is what
 * the Ledger handed it.
 *
 * THE RULES, WHICH ARE THE DAY CASHBOOK'S
 *
 *   opening   the baseline the shop set, and everything since it
 *   + cash taken on sales        (cash only — see above)
 *   + purchase returns           money coming back from a supplier
 *   + income                     owner investment, supplier payments in
 *   - sales returns              money handed back to a customer
 *   - expenses                   everything that left the till
 *
 * Selling on credit is deliberately NOT subtracted: it takes nothing
 * out of the drawer. Subtracting it made every unpaid sale drag the
 * carried-forward figure below what was really there.
 */

export type CashInHandSources = {
  /** Baseline the shop set, and the date it applies from. */
  opening: number
  openingFrom: string
  salesCash: number
  purchaseReturns: number
  income: number
  salesReturns: number
  expenses: number
}

/**
 * NEVER BELOW ZERO.
 *
 * A drawer cannot hold negative cash, so the shop's rule is that cash
 * in hand — and therefore the next day's brought-forward figure — is
 * always positive.
 *
 * A computed negative means the books are short of something, not that
 * the till owes money. Almost always it is the opening balance: a shop
 * that began trading with cash already in the drawer and never
 * recorded it will run below zero for as long as that money is
 * missing. It can also be a payment made by bank and entered as cash.
 *
 * WHAT THE FLOOR COSTS
 *
 * On a day where it bites, the sheet stops adding up: Dr minus Cr will
 * come to less than the Cash in Hand printed under it, by exactly the
 * amount the books are short. That difference is the thing to go and
 * find — setting the shop's opening balance is what makes it go away
 * properly, and then this floor never comes into play at all.
 */
export function cashInHandFrom(s: CashInHandSources): number {
  const debits = s.salesCash + s.purchaseReturns + s.income
  const credits = s.salesReturns + s.expenses
  return Math.max(0, s.opening + debits - credits)
}

type Client = {
  from: (table: string) => any
  rpc: (fn: string, args: Record<string, unknown>) => any
}

/** Date part of a date or timestamp column, for lexical comparison. */
const day = (v: unknown) => String(v ?? "").slice(0, 10)

const sumBetween = (
  rows: any[],
  field: string,
  dateField: string,
  from: string,
  to: string,
) =>
  rows.reduce((t: number, r: any) => {
    const d = day(r?.[dateField])
    return d >= from && d <= to ? t + (Number(r?.[field]) || 0) : t
  }, 0)

/**
 * Cash in hand at the end of each of several dates, in one pass.
 *
 * The Ledger needs two of these on every load — the opening and the
 * closing — and asking twice meant ten queries where five will do. A
 * screen that fires a dozen requests at once turns one dropped
 * connection into a page of empty totals, so the count is worth
 * keeping down.
 *
 * Each date keeps its OWN baseline. A shop that set an opening balance
 * between the two dates has a different starting point for each, and
 * sharing one would quietly count the days before it twice.
 *
 * Every query falls back to nothing rather than throwing: a figure
 * that is slightly stale is worth more to the shop than a screen that
 * will not load.
 */
export async function loadCashInHandAt(
  supabase: Client,
  organizationId: string,
  dates: string[],
): Promise<number[]> {
  if (dates.length === 0) return []

  const baselines = await Promise.all(
    dates.map(async (date) => {
      const { data } = await supabase
        .rpc("cashbook_baseline", { p_organization_id: organizationId, p_date: date })
        .maybeSingle()
      return {
        date,
        from: (data?.effective_date as string) ?? "2000-01-01",
        opening: Number(data?.amount ?? 0),
      }
    }),
  )

  const earliest = baselines.reduce((a, b) => (a.from < b.from ? a : b)).from
  const latest = dates.reduce((a, b) => (a > b ? a : b))

  const safe = async (q: any) => {
    const result = await q
    return result?.error ? [] : (result?.data ?? [])
  }

  const [sales, purchaseReturns, income, salesReturns, expenses] = await Promise.all([
    safe(
      supabase
        .from("sales")
        .select("cash_received, sale_date")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        .gte("sale_date", earliest)
        .lte("sale_date", `${latest}T23:59:59.999Z`),
    ),
    safe(
      supabase
        .from("purchase_returns")
        .select("total_credit_amount, return_date")
        .eq("organization_id", organizationId)
        .eq("status", "processed")
        .gte("return_date", earliest)
        .lte("return_date", latest),
    ),
    safe(
      supabase
        .from("income_owner")
        .select("amount, date")
        .eq("organization_id", organizationId)
        .gte("date", earliest)
        .lte("date", latest),
    ),
    safe(
      supabase
        .from("sales_returns")
        .select("total_refund_amount, return_date")
        .eq("organization_id", organizationId)
        .eq("status", "processed")
        .gte("return_date", earliest)
        .lte("return_date", `${latest}T23:59:59.999Z`),
    ),
    safe(
      supabase
        .from("expenses")
        .select("amount, date")
        .eq("organization_id", organizationId)
        .gte("date", earliest)
        .lte("date", latest),
    ),
  ])

  return baselines.map((b) =>
    cashInHandFrom({
      opening: b.opening,
      openingFrom: b.from,
      salesCash: sumBetween(sales, "cash_received", "sale_date", b.from, b.date),
      purchaseReturns: sumBetween(
        purchaseReturns, "total_credit_amount", "return_date", b.from, b.date,
      ),
      income: sumBetween(income, "amount", "date", b.from, b.date),
      salesReturns: sumBetween(
        salesReturns, "total_refund_amount", "return_date", b.from, b.date,
      ),
      expenses: sumBetween(expenses, "amount", "date", b.from, b.date),
    }),
  )
}

/** One date. Everything above, for callers that only need the one. */
export async function loadCashInHand(
  supabase: Client,
  organizationId: string,
  date: string,
): Promise<number> {
  const [cash] = await loadCashInHandAt(supabase, organizationId, [date])
  return cash ?? 0
}
