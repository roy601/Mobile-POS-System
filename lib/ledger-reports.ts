import {
  dash,
  dayUK,
  esc,
  letterhead,
  money,
  openReport,
  type ReportHeader,
} from "@/lib/report-chrome"

/**
 * The sheets the shop reads off the Ledger.
 *
 * PURCHASE LEDGER      the running account with suppliers
 * PARTY DUES PAYMENT   what was owed against what was paid, per supplier
 *
 * Both are modelled on the shop's previous software, because these are
 * the two the owner reconciles by eye against a supplier's own book.
 */

export type LedgerLine = {
  id: string
  date: string
  description: string
  voucherType: string
  debit: number
  credit: number
  balance: number
  reference?: string
  supplier?: string
}

/** One supplier's account over the period, as the Ledger groups it. */
export type LedgerParty = {
  name: string
  /** What stood on the account the day before the period. */
  opening: number
  debit: number
  credit: number
  /** opening + debit - credit. */
  balance: number
  /**
   * Chronological, with the running balance on each row. A day's
   * purchases already arrive as ONE row: the shop reads what a day
   * cost, not the invoice's line per colour.
   */
  entries: LedgerLine[]
}

/**
 * PURCHASE LEDGER
 *
 * One block per supplier, laid out like the Own Expense Report the shop
 * asked this to match. The old sheet was one long table of every line
 * of every invoice — twenty-six rows of "Ismartu … Purchase" for a
 * single day — and the owner could not see where one supplier stopped
 * and the next began, or what any day had actually cost.
 *
 * Each block opens with that supplier's Balance Forward, lists each day
 * of purchases as one total and each payment or return as it happened,
 * and closes with the supplier's DR, CR and balance. The Grand Total is
 * across all of them.
 */
export function printPurchaseLedger(args: {
  header: ReportHeader
  period: string
  parties: LedgerParty[]
  filters?: string
}): boolean {
  const { header, period, parties, filters } = args

  let dr = 0
  let cr = 0
  let closing = 0

  const body = parties
    .map((p) => {
      dr += Number(p.debit) || 0
      cr += Number(p.credit) || 0
      closing += Number(p.balance) || 0

      const trs = p.entries
        .map(
          (e) => `
            <tr>
              <td class="c">${dayUK(e.date)}</td>
              <td>${dash(e.description || e.voucherType)}</td>
              <td class="num">${Number(e.debit) ? money(e.debit) : "&nbsp;"}</td>
              <td class="num">${Number(e.credit) ? money(e.credit) : "&nbsp;"}</td>
              <td class="num">${money(e.balance)}</td>
            </tr>`,
        )
        .join("")

      return `
        <div class="xtype">PARTY NAME: <span>${esc(p.name)}</span></div>
        <table class="grid xgrid">
          <thead><tr>
            <th style="width:15%">V.Date</th>
            <th style="width:37%">Particular</th>
            <th style="width:16%">DR</th>
            <th style="width:16%">CR</th>
            <th style="width:16%">Balance</th>
          </tr></thead>
          <tbody>
            <tr class="bf">
              <td>&nbsp;</td>
              <td>Balance Forward</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td class="num">${money(p.opening)}</td>
            </tr>
            ${trs}
          </tbody>
        </table>
        <table class="xtotals3">
          <tr>
            <td style="width:52%">Group Total</td>
            <td class="v" style="width:16%">${money(p.debit)}</td>
            <td class="v" style="width:16%">${money(p.credit)}</td>
            <td class="v" style="width:16%">${money(p.balance)}</td>
          </tr>
        </table>`
    })
    .join("")

  const html = `
    <style>${GROUPED_CSS}</style>
    ${letterhead(header, "PURCHASE LEDGER", period, filters)}
    ${body || '<div class="empty">Nothing bought or paid in this period.</div>'}

    <table class="xtotals3 grand">
      <tr>
        <td style="width:52%">Grand Total</td>
        <td class="v" style="width:16%">${money(dr)}</td>
        <td class="v" style="width:16%">${money(cr)}</td>
        <td class="v" style="width:16%">${money(closing)}</td>
      </tr>
    </table>

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return openReport("Purchase Ledger", html)
}

/** One movement on a supplier's account, for the dues sheet. */
export type PartyDuesRow = {
  supplier: string
  /** The delivery, where the movement is a purchase. */
  purchaseVoucherNo: string | null
  purchaseDate: string | null
  /** The payment, where the movement is money going out. */
  paymentVoucherNo: string | null
  paymentDate: string | null
  dues: number
  payment: number
}

/**
 * PARTY DUES PAYMENT REPORT
 *
 * Per supplier, what was owed against what was paid.
 *
 * Balance is per ROW — dues less payment for that line — not a running
 * figure down the column. That is what the shop's own sheet prints,
 * and it is the number they check: "this delivery owed 148,136, I paid
 * 204,309, so I am 56,173 ahead on it". A running total would answer a
 * different question and disagree with the paper they hold.
 *
 * Only the Payment column is totalled, for the same reason: dues and
 * balances belong to individual vouchers and adding them up says
 * nothing.
 */
export function printPartyDues(args: {
  header: ReportHeader
  period: string
  rows: PartyDuesRow[]
  filters?: string
}): boolean {
  const { header, period, rows, filters } = args

  const byParty = new Map<string, PartyDuesRow[]>()
  for (const r of rows) {
    const key = (r.supplier || "").trim() || "(no supplier)"
    const list = byParty.get(key)
    if (list) list.push(r)
    else byParty.set(key, [r])
  }

  let grand = 0

  const body = Array.from(byParty.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([party, list]) => {
      let paid = 0

      const trs = list
        .map((r) => {
          const dues = Number(r.dues) || 0
          const payment = Number(r.payment) || 0
          paid += payment
          return `
            <tr>
              <td class="c">${dash(r.purchaseVoucherNo)}</td>
              <td class="c">${r.purchaseDate ? dayUK(r.purchaseDate) : "&nbsp;"}</td>
              <td class="c">${dash(r.paymentVoucherNo)}</td>
              <td class="c">${r.paymentDate ? dayUK(r.paymentDate) : "&nbsp;"}</td>
              <td class="num">${money(dues)}</td>
              <td class="num">${money(payment)}</td>
              <td class="num">${money(dues - payment)}</td>
            </tr>`
        })
        .join("")

      grand += paid

      return `
        <div style="margin:14px 0 6px;font-size:13px;">Customer Name:
          <span class="party-name" style="display:inline;text-decoration:underline;font-size:15px;">${esc(party)}</span>
        </div>
        <table class="grid">
          <thead><tr>
            <th style="width:15%">Purchase Vou. No.</th>
            <th style="width:13%">Purchase V.Date</th>
            <th style="width:17%">Payment Voucher</th>
            <th style="width:13%">Payment V.Date</th>
            <th style="width:14%">Dues</th>
            <th style="width:14%">Payment</th>
            <th style="width:14%">Blance</th>
          </tr></thead>
          <tbody>${trs}</tbody>
        </table>
        <table class="totals" style="width:100%;">
          <tr class="under">
            <td class="label">Group Total :</td>
            <td class="val">${money(paid)}</td>
          </tr>
        </table>`
    })
    .join("")

  const html = `
    ${letterhead(header, "PARTY DUES PAYMENT REPORT", period, filters)}
    ${body || '<div class="empty">Nothing owed or paid in this period.</div>'}

    <table class="totals" style="width:100%;margin-top:14px;">
      <tr class="close">
        <td class="label">Grand Total :</td>
        <td class="val">${money(grand)}</td>
      </tr>
    </table>

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return openReport("Party Dues Payment Report", html)
}

// ---- OWN EXPENSE / INCOME REPORTS ------------------------------------
//
// One layout, modelled on the shop's previous software, for both sheets:
//
//   <TITLE> (green)
//   <LABEL>: <type>        one block per type, A-Z
//     table of that type's rows
//     Group Total
//   Grand Total, double-ruled
//
// Shared so the two cannot drift apart: a change the shop asks for on
// one sheet is a change on both.

/**
 * The old sheets' block layout. The title is green, and each block is
 * indented and narrower than the page, with its total ruled beneath.
 * Local to the grouped reports — the other sheets keep their own look.
 */
const GROUPED_CSS = `
  .title { color: #1a7a2a; }
  .xtype { margin: 16px 0 6px; font-size: 12.5px; letter-spacing: .3px; }
  .xtype span { color: #7a1a1a; font-weight: bold; text-decoration: underline; font-size: 13.5px; }
  .xgrid { width: 82%; margin-left: 6%; }
  .xtotals { width: 82%; margin-left: 6%; margin-top: 2px; }
  .xtotals td.label { width: 70%; }
  .xgrand { width: 82%; margin-left: 6%; margin-top: 14px; }
  .xgrand td { padding: 3px 6px; font-size: 13px; font-weight: bold; text-align: right; }
  .xgrand td.val { width: 150px; border-bottom: 3px double #7a1a1a;
                   font-variant-numeric: tabular-nums; }
  /* A block with three figures — DR, CR, Balance — under its last three
     columns, for the Purchase Ledger. */
  .xtotals3 { width: 82%; margin-left: 6%; margin-top: 2px; border-collapse: collapse; }
  .xtotals3 td { padding: 3px 6px; font-size: 11.5px; font-weight: bold; text-align: right;
                 font-variant-numeric: tabular-nums; }
  .xtotals3 td.v { border-bottom: 1.5px solid #000; }
  .xtotals3.grand { margin-top: 14px; }
  .xtotals3.grand td { font-size: 13px; }
  .xtotals3.grand td.v { border-bottom: 3px double #7a1a1a; }
  .xgrid tr.bf td { font-style: italic; color: #444; }
`

type GroupedColumn<T> = {
  header: string
  width: string
  cell: (row: T) => string
  /** Right-aligned money column. The last one is the one that totals. */
  money?: boolean
}

function groupedVoucherReport<T extends { type: string; date: string | null; amount: number }>(args: {
  header: ReportHeader
  period: string
  filters?: string
  title: string
  /** "EXPENSE TYPE", "INCOME TYPE". */
  typeLabel: string
  windowTitle: string
  emptyText: string
  rows: T[]
  columns: GroupedColumn<T>[]
  /** Tie-break inside a day, e.g. by voucher number. */
  tiebreak?: (a: T, b: T) => number
}): boolean {
  const { header, period, filters, title, typeLabel, windowTitle, emptyText, rows, columns, tiebreak } = args

  const byType = new Map<string, T[]>()
  for (const r of rows) {
    const key = (r.type || "").trim() || "Other"
    const list = byType.get(key)
    if (list) list.push(r)
    else byType.set(key, [r])
  }

  let grand = 0

  const body = Array.from(byType.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, list]) => {
      const sorted = [...list].sort(
        (a, b) =>
          String(a.date ?? "").localeCompare(String(b.date ?? "")) || (tiebreak ? tiebreak(a, b) : 0),
      )
      let total = 0
      const trs = sorted
        .map((r) => {
          total += Number(r.amount) || 0
          return `<tr>${columns
            .map((c) => `<td class="${c.money ? "num" : ""}">${c.cell(r)}</td>`)
            .join("")}</tr>`
        })
        .join("")

      grand += total

      return `
        <div class="xtype">${esc(typeLabel)}: <span>${esc(type)}</span></div>
        <table class="grid xgrid">
          <thead><tr>${columns
            .map((c) => `<th style="width:${c.width}">${esc(c.header)}</th>`)
            .join("")}</tr></thead>
          <tbody>${trs}</tbody>
        </table>
        <table class="totals xtotals">
          <tr class="under">
            <td class="label">Group Total</td>
            <td class="val">${money(total)}</td>
          </tr>
        </table>`
    })
    .join("")

  const html = `
    <style>${GROUPED_CSS}</style>
    ${letterhead(header, title, period, filters)}
    ${body || `<div class="empty">${esc(emptyText)}</div>`}

    <table class="xgrand">
      <tr>
        <td class="label">Grand Total</td>
        <td class="val">${money(grand)}</td>
      </tr>
    </table>

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return openReport(windowTitle, html)
}

export type OwnExpenseRow = {
  /** The head it is filed under: "Entertainment", "Cofi Bill". */
  type: string
  voucherNo: string | null
  /** The day the money moved, YYYY-MM-DD. */
  date: string | null
  /** Who was paid, or who paid it — the expense's description. */
  person: string | null
  amount: number
}

/**
 * What the shop spent on itself, one block per expense type.
 *
 * Supplier payments are NOT here — they are settling stock, not running
 * the shop, and the Party Dues Payment report is where the owner reads
 * them. "Own" is the old sheet's word for exactly that split.
 */
export function printOwnExpense(args: {
  header: ReportHeader
  period: string
  rows: OwnExpenseRow[]
  /** "Expense type: Entertainment" when the sheet is filtered. */
  filters?: string
}): boolean {
  return groupedVoucherReport<OwnExpenseRow>({
    ...args,
    title: "OWN EXPENSE REPORT",
    typeLabel: "EXPENSE TYPE",
    windowTitle: "Own Expense Report",
    emptyText: "No expenses in this period.",
    tiebreak: (a, b) => String(a.voucherNo ?? "").localeCompare(String(b.voucherNo ?? "")),
    columns: [
      { header: "Expense Voucher No.", width: "25%", cell: (r) => dash(r.voucherNo) },
      { header: "Expense V.Date", width: "18%", cell: (r) => `<div class="c">${dayUK(r.date)}</div>` },
      { header: "Payment Person", width: "35%", cell: (r) => dash(r.person) },
      { header: "Payment", width: "22%", cell: (r) => money(r.amount), money: true },
    ],
  })
}

export type IncomeReportRow = {
  /** Owner Income, Supplier Paid to Shop, or the shop's own type. */
  type: string
  /** The day the money came in, YYYY-MM-DD. */
  date: string | null
  /** Who it came from — the supplier, or the income's description. */
  from: string | null
  /** Where it went: Cash, or the bank. */
  destination: string
  amount: number
}

/**
 * Money that came in other than from sales, one block per income type —
 * the same sheet as the Own Expense Report, the other way round.
 *
 * There is no voucher number column: income is not numbered in this app
 * the way expenses are, and a column of blanks would suggest numbers
 * that were lost.
 */
export function printIncomeReport(args: {
  header: ReportHeader
  period: string
  rows: IncomeReportRow[]
  /** "Income type: Owner Income" when the sheet is filtered. */
  filters?: string
}): boolean {
  return groupedVoucherReport<IncomeReportRow>({
    ...args,
    title: "INCOME REPORT",
    typeLabel: "INCOME TYPE",
    windowTitle: "Income Report",
    emptyText: "No income in this period.",
    columns: [
      { header: "Income V.Date", width: "18%", cell: (r) => `<div class="c">${dayUK(r.date)}</div>` },
      { header: "Received From", width: "42%", cell: (r) => dash(r.from) },
      { header: "Destination", width: "18%", cell: (r) => `<div class="c">${esc(r.destination)}</div>` },
      { header: "Received", width: "22%", cell: (r) => money(r.amount), money: true },
    ],
  })
}
