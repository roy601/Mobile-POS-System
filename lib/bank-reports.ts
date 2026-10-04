import { dayUK, esc, letterhead, money, openReport } from "@/lib/report-chrome"

/**
 * What reached the bank, and from which account.
 *
 * Two sheets over the same figures, because the shop asks two
 * questions of them: "what is in each account" when reconciling a
 * month, and "which day did that come from" when a figure looks wrong.
 */

export type BankRow = { date: string; bankName: string; amount: number }

export type BankReportArgs = {
  header: { name: string; addressLine: string }
  period: string
  rows: BankRow[]
}

/** bank -> date -> total, and the order the shop reads them in. */
function group(rows: BankRow[]) {
  const banks = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const bank = (r.bankName || "").trim() || "Not specified"
    if (!banks.has(bank)) banks.set(bank, new Map())
    const byDate = banks.get(bank)!
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + (Number(r.amount) || 0))
  }
  return Array.from(banks.entries()).sort(([a], [b]) => a.localeCompare(b))
}

/**
 * BANK CASH INFORMATION DETAILS — every day, under its account.
 *
 * One row per account per DAY rather than per transaction: that is the
 * granularity a bank statement comes at, and the sheet exists to be
 * held next to one.
 */
export function printBankDetails({ header, period, rows }: BankReportArgs): boolean {
  const banks = group(rows)
  let grand = 0

  const body = banks
    .map(([bank, byDate]) => {
      const dates = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
      const total = dates.reduce((s, [, v]) => s + v, 0)
      grand += total

      return `
        <div class="group-name">${esc(bank)}</div>
        <table class="grid" style="width:70%;margin:0 auto 4px;">
          <thead><tr>
            <th style="width:26%">Date</th>
            <th style="width:48%">Bank Name</th>
            <th style="width:26%">Amount</th>
          </tr></thead>
          <tbody>
            ${dates
              .map(
                ([d, v]) => `
              <tr>
                <td class="c">${dayUK(d)}</td>
                <td class="c" style="font-weight:bold">${esc(bank)}</td>
                <td class="num">${money(v)}</td>
              </tr>`,
              )
              .join("")}
            <tr class="group-total">
              <td colspan="2" class="r">Group Total</td>
              <td class="num">${money(total)}</td>
            </tr>
          </tbody>
        </table>`
    })
    .join("")

  const html = `
    ${letterhead(header, "Bank Cash Information Details", period)}
    ${body || '<div class="empty">Nothing reached a bank account in this period.</div>'}

    <table class="totals" style="width:70%;margin:14px auto 0;">
      <tr class="close">
        <td class="label">Group Total</td>
        <td class="val">${money(grand)}</td>
      </tr>
    </table>

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return openReport("Bank Cash Information Details", html)
}

/**
 * BANK CASH INFORMATION — one line per account.
 *
 * The same money, without the days. This is the one that gets checked
 * against the accounts themselves at the end of a month.
 */
export function printBankSummary({ header, period, rows }: BankReportArgs): boolean {
  const banks = group(rows)
  let grand = 0

  const body = banks
    .map(([bank, byDate]) => {
      const total = Array.from(byDate.values()).reduce((s, v) => s + v, 0)
      grand += total
      return `
        <tr>
          <td style="font-weight:bold">${esc(bank)}</td>
          <td class="num">${money(total)}</td>
        </tr>`
    })
    .join("")

  const html = `
    ${letterhead(header, "Bank Cash Information", period)}

    <table class="grid" style="width:56%;margin:0 auto;">
      <thead><tr>
        <th style="width:62%">Bank Name</th>
        <th style="width:38%">Amount</th>
      </tr></thead>
      <tbody>
        ${body || '<tr><td colspan="2" class="c">Nothing reached a bank account.</td></tr>'}
      </tbody>
    </table>

    <table class="totals" style="width:56%;margin:10px auto 0;">
      <tr class="close">
        <td class="label">Grand Total</td>
        <td class="val">${money(grand)}</td>
      </tr>
    </table>

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return openReport("Bank Cash Information", html)
}
