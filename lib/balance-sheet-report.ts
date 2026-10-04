import {
  dash,
  dayUK,
  esc,
  money,
  money0,
  openReport,
  type ReportHeader,
} from "@/lib/report-chrome"

/**
 * BALANCE SHEET
 *
 * Not one table: a cover page of six figures, then the six histories
 * those figures come out of. The owner reads the cover, finds a number
 * he does not believe, and turns to the section that explains it — so
 * every section total has to tie back to its line on the cover, and
 * they are computed from the same rows to make sure it does.
 *
 * Date formats differ between sections (dd/mm/yyyy in the purchase and
 * sales histories, yyyy-mm-dd in the rest). That is not an oversight:
 * it is what the shop's previous software printed, and this sheet gets
 * held up against those printouts.
 */

export type PartyPurchaseRow = {
  supplier: string
  date: string
  purchaseAmount: number
  paid: number
  dues: number
  discount: number
  adjustment: number
}

export type SalesHistoryRow = {
  date: string
  /** Before discount — the discount has its own column and is taken off at the foot. */
  salesAmount: number
  cashPaid: number
  bankPaid: number
  adjustment: number
  discount: number
  dues: number
}

export type DuesReceivedRow = {
  date: string
  duesAmount: number
  receiptAmount: number
}

export type IncomeHistoryRow = { date: string; amount: number }

export type PartyPaymentRow = { supplier: string; date: string; amount: number }

export type OwnExpenseRow = {
  head: string
  date: string
  party: string | null
  amount: number
}

export type BalanceSheetReportData = {
  partyPurchases: PartyPurchaseRow[]
  salesHistory: SalesHistoryRow[]
  duesReceived: DuesReceivedRow[]
  incomeHistory: IncomeHistoryRow[]
  partyPayments: PartyPaymentRow[]
  ownExpenses: OwnExpenseRow[]
}

const iso = (d: string) => esc(String(d ?? "").slice(0, 10))

const sum = <T,>(rows: T[], pick: (r: T) => number) =>
  rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0)

/** Keeps a group's rows in the order the shop entered them. */
function groupBy<T>(rows: T[], key: (r: T) => string) {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = (key(r) || "").trim() || "(none)"
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return Array.from(out.entries()).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )
}

const END = '<div class="end">----- END -----</div>'

/** The shop's "Total X : figure" strip, ruled underneath. */
function strip(label: string, value: string, colour = "#7a1a8a") {
  return `
    <table style="margin:6px 0 4px;border-collapse:collapse;">
      <tr>
        <td style="font-size:15px;font-weight:bold;padding-right:16px;white-space:nowrap;">${esc(label)}</td>
        <td style="font-size:15px;font-weight:bold;color:${colour};text-align:right;
                   min-width:220px;border-bottom:2px solid ${colour};
                   font-variant-numeric:tabular-nums;">${value}</td>
      </tr>
    </table>`
}

// ------------------------------------------------------------------
// 1. The cover
// ------------------------------------------------------------------
function cover(
  header: ReportHeader,
  period: string,
  t: {
    purchase: number
    sales: number
    partyPayment: number
    ownExpense: number
    duesReceived: number
    income: number
  },
) {
  const line = (label: string, value: number) => `
    <tr><td class="k">${esc(label)}</td><td class="v">${money(value)}</td></tr>`

  return `
    <div class="header">
      <div class="company">${header.name}</div>
      <div class="address">${header.addressLine}</div>
      <div class="bs-period">Period :${esc(period)}</div>
    </div>
    <div class="bs-title">BALANCE SHEET</div>
    <div class="bs-rule"></div>

    <table class="kv">
      ${line("Total Purchase Amount", t.purchase)}
      ${line("Total Sales Amount", t.sales)}
      ${line("Total Party Payment Amount", t.partyPayment)}
      ${line("Total Own Expense Amount", t.ownExpense)}
      ${line("Total Customer Dues Receive Amt", t.duesReceived)}
      ${line("Total Income Amount", t.income)}
    </table>`
}

// ------------------------------------------------------------------
// 2. Party wise purchase history
// ------------------------------------------------------------------
function partyPurchaseSection(rows: PartyPurchaseRow[]) {
  const groups = groupBy(rows, (r) => r.supplier)

  const body = groups
    .map(([party, list]) => {
      const trs = list
        .map(
          (r) => `
        <tr>
          <td>${esc(party)}</td>
          <td class="c">${dayUK(r.date)}</td>
          <td class="num">${money0(r.purchaseAmount)}</td>
          <td class="num">${money0(r.paid)}</td>
          <td class="num">${money0(r.dues)}</td>
          <td class="num">${money0(r.discount)}</td>
          <td class="num">${money0(r.adjustment)}</td>
        </tr>`,
        )
        .join("")

      return `
        <tr class="grp"><td colspan="7">${esc(party)}</td></tr>
        ${trs}
        <tr class="spacer"><td colspan="7"></td></tr>
        <tr class="grp">
          <td></td><td></td>
          <td class="num" style="border-top:1.5px solid #000">${money0(sum(list, (r) => r.purchaseAmount))}</td>
          <td class="num" style="border-top:1.5px solid #000">${money0(sum(list, (r) => r.paid))}</td>
          <td class="num" style="border-top:1.5px solid #000">${money0(sum(list, (r) => r.dues))}</td>
          <td class="num" style="border-top:1.5px solid #000">${money0(sum(list, (r) => r.discount))}</td>
          <td class="num" style="border-top:1.5px solid #000">${money0(sum(list, (r) => r.adjustment))}</td>
        </tr>`
    })
    .join("")

  return `
    <div class="sec-title" style="page-break-before:always;">PARTY WISE PURCHASE HISTORY</div>
    <table class="grid">
      <thead><tr>
        <th style="width:26%">Party Name</th>
        <th style="width:12%">P.Date</th>
        <th style="width:14%">T.Purchase Amt</th>
        <th style="width:12%">T.Paid</th>
        <th style="width:12%">T.DUES</th>
        <th style="width:12%">T.DIS</th>
        <th style="width:12%">T.Adj. Amt</th>
      </tr></thead>
      <tbody>
        ${body || '<tr><td colspan="7" class="c">No purchases in this period.</td></tr>'}
        <tr class="group-total" style="color:#7a1a1a">
          <td class="r">Grand Total:</td><td></td>
          <td class="num">${money0(sum(rows, (r) => r.purchaseAmount))}</td>
          <td class="num">${money0(sum(rows, (r) => r.paid))}</td>
          <td class="num">${money0(sum(rows, (r) => r.dues))}</td>
          <td class="num">${money0(sum(rows, (r) => r.discount))}</td>
          <td class="num">${money0(sum(rows, (r) => r.adjustment))}</td>
        </tr>
      </tbody>
    </table>`
}

// ------------------------------------------------------------------
// 3. Sales history
// ------------------------------------------------------------------
function salesSection(rows: SalesHistoryRow[]) {
  const trs = rows
    .map(
      (r) => `
      <tr>
        <td class="c">${dayUK(r.date)}</td>
        <td class="num">${money(r.salesAmount)}</td>
        <td class="num">${money(r.cashPaid)}</td>
        <td class="num">${money(r.bankPaid)}</td>
        <td class="num">${money(r.adjustment)}</td>
        <td class="num">${money(r.discount)}</td>
        <td class="num">${money(r.dues)}</td>
      </tr>`,
    )
    .join("")

  const gross = sum(rows, (r) => r.salesAmount)
  const discount = sum(rows, (r) => r.discount)

  return `
    <div class="sec-title">SALES HISTORY</div>
    <table class="grid">
      <thead><tr>
        <th style="width:12%">Sales Date</th>
        <th style="width:15%">T.Sales Amt</th>
        <th style="width:15%">Cash Paid</th>
        <th style="width:15%">T.BANK Paid</th>
        <th style="width:12%">T.Adj.Amt</th>
        <th style="width:16%">T.Discount Amt</th>
        <th style="width:15%">T.Dues Amt</th>
      </tr></thead>
      <tbody>
        ${trs || '<tr><td colspan="7" class="c">No sales in this period.</td></tr>'}
        <tr class="group-total">
          <td class="c">Grand Total</td>
          <td class="num">${money(gross)}</td>
          <td class="num">${money(sum(rows, (r) => r.cashPaid))}</td>
          <td class="num">${money(sum(rows, (r) => r.bankPaid))}</td>
          <td class="num">${money(sum(rows, (r) => r.adjustment))}</td>
          <td class="num">${money(discount)}</td>
          <td class="num">${money(sum(rows, (r) => r.dues))}</td>
        </tr>
      </tbody>
    </table>
    ${/* Gross less discount, adjustment deliberately NOT added: the
        adjustment explains how the money split between cash and bank,
        not what the shop charged. Checked against their printout, where
        3,110,495.00 - 8,609.00 with a 799.00 adjustment foots to the
        3,101,886.00 they print. */ ""}
    ${strip("Total Sales", money(gross - discount))}
    ${END}`
}

// ------------------------------------------------------------------
// 4. Customer dues received
// ------------------------------------------------------------------
function duesReceivedSection(rows: DuesReceivedRow[]) {
  const trs = rows
    .map(
      (r) => `
      <tr>
        <td class="c">${iso(r.date)}</td>
        <td class="num">${money(r.duesAmount)}</td>
        <td class="num">${money(r.receiptAmount)}</td>
        <td></td>
      </tr>`,
    )
    .join("")

  const received = sum(rows, (r) => r.receiptAmount)

  return `
    <div class="sec-title">CUSTOMER DUES RECEIVED HISTORY</div>
    <table class="grid" style="width:88%;margin:0 auto;">
      <thead><tr>
        <th style="width:30%">Received Date</th>
        <th style="width:26%">Dues Amount</th>
        <th style="width:26%">Receipt Amount</th>
        <th style="width:18%"></th>
      </tr></thead>
      <tbody>
        ${trs || "<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>"}
        <tr class="group-total">
          <td class="c">Grand Total</td>
          <td class="num">${money(sum(rows, (r) => r.duesAmount))}</td>
          <td class="num">${money(received)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    ${strip("Total Dues", money(received), "#111")}
    ${END}`
}

// ------------------------------------------------------------------
// 5. Income history
// ------------------------------------------------------------------
function incomeSection(rows: IncomeHistoryRow[]) {
  const trs = rows
    .map(
      (r) => `
      <tr>
        <td class="c">${iso(r.date)}</td>
        <td class="num">${money(r.amount)}</td>
      </tr>`,
    )
    .join("")

  return `
    <div class="sec-title">Income History</div>
    <table class="grid" style="width:42%;margin:0 auto;">
      <thead><tr>
        <th style="width:52%">Receipt Date</th>
        <th style="width:48%">Receipt Amount</th>
      </tr></thead>
      <tbody>
        ${trs || '<tr><td colspan="2" class="c">No income in this period.</td></tr>'}
      </tbody>
    </table>
    ${strip("Total Income :", money(sum(rows, (r) => r.amount)))}
    ${END}`
}

// ------------------------------------------------------------------
// 6. Party payment history
// ------------------------------------------------------------------
function partyPaymentSection(rows: PartyPaymentRow[]) {
  const groups = groupBy(rows, (r) => r.supplier)

  const body = groups
    .map(([party, list]) => {
      const trs = list
        .map(
          (r) => `
        <tr>
          <td class="c">${iso(r.date)}</td>
          <td class="num">${money(r.amount)}</td>
        </tr>`,
        )
        .join("")

      return `
        <div style="margin:16px 0 6px;color:#8a1a8a;font-size:13px;">Party Name :
          <span style="font-weight:bold;text-decoration:underline;font-size:14px;">${esc(party)}</span>
        </div>
        <table class="grid" style="width:42%;margin:0 auto;">
          <thead><tr>
            <th style="width:52%">Payment Date</th>
            <th style="width:48%">Payment Amount</th>
          </tr></thead>
          <tbody>
            ${trs}
            <tr class="group-total">
              <td class="c">Group Total :</td>
              <td class="num">${money(sum(list, (r) => r.amount))}</td>
            </tr>
          </tbody>
        </table>`
    })
    .join("")

  return `
    <div class="sec-title">PARTY PAYMENT HISTORY</div>
    ${body || '<div class="empty">No supplier payments in this period.</div>'}
    ${strip("Total Payment :", money(sum(rows, (r) => r.amount)))}
    ${END}`
}

// ------------------------------------------------------------------
// 7. Own expense history
// ------------------------------------------------------------------
function ownExpenseSection(rows: OwnExpenseRow[]) {
  const groups = groupBy(rows, (r) => r.head)

  const body = groups
    .map(([head, list]) => {
      const trs = list
        .map(
          (r) => `
        <tr>
          <td></td>
          <td class="c">${iso(r.date)}</td>
          <td class="c">${dash(r.party)}</td>
          <td class="num">${money(r.amount)}</td>
        </tr>`,
        )
        .join("")

      return `
        <tr class="headrow"><td colspan="4">${esc(head)}</td></tr>
        ${trs}
        <tr class="headrow">
          <td>Total ${esc(head)}</td><td></td><td></td>
          <td class="num" style="border-top:1.5px solid #000;color:#111">${money(
            sum(list, (r) => r.amount),
          )}</td>
        </tr>`
    })
    .join("")

  return `
    <div class="sec-title">OWN EXPENSE HISTORY</div>
    <table class="grid">
      <thead><tr>
        <th style="width:34%">A/C Head</th>
        <th style="width:18%"></th>
        <th style="width:30%">Party Name</th>
        <th style="width:18%">Payment Amt</th>
      </tr></thead>
      <tbody>
        ${body || '<tr><td colspan="4" class="c">No expenses in this period.</td></tr>'}
        <tr class="group-total">
          <td>Grand Total:</td><td></td><td></td>
          <td class="num">${money(sum(rows, (r) => r.amount))}</td>
        </tr>
      </tbody>
    </table>
    ${END}`
}

// ------------------------------------------------------------------

export function printBalanceSheet(args: {
  header: ReportHeader
  period: string
  data: BalanceSheetReportData
}): boolean {
  const { header, period, data } = args

  // The cover is footed from the very rows the sections print, so a
  // figure on page one can never disagree with the page explaining it.
  const salesGross = sum(data.salesHistory, (r) => r.salesAmount)
  const salesDiscount = sum(data.salesHistory, (r) => r.discount)

  const html = `
    ${cover(header, period, {
      purchase: sum(data.partyPurchases, (r) => r.purchaseAmount),
      sales: salesGross - salesDiscount,
      partyPayment: sum(data.partyPayments, (r) => r.amount),
      ownExpense: sum(data.ownExpenses, (r) => r.amount),
      duesReceived: sum(data.duesReceived, (r) => r.receiptAmount),
      income: sum(data.incomeHistory, (r) => r.amount),
    })}

    ${partyPurchaseSection(data.partyPurchases)}
    ${salesSection(data.salesHistory)}
    ${duesReceivedSection(data.duesReceived)}
    ${incomeSection(data.incomeHistory)}
    ${partyPaymentSection(data.partyPayments)}
    ${ownExpenseSection(data.ownExpenses)}

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return openReport("Balance Sheet", html)
}
