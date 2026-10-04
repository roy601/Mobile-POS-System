import { esc, letterhead, money, openReport, type ReportHeader } from "@/lib/report-chrome"

/**
 * PROFIT & LOSS
 *
 * Rebuilt to the shop's own design. Two columns:
 *
 *   LEFT   what the business is standing on — stock, what it is owed,
 *          what it owes — opened, moved during the period, and closed.
 *   RIGHT  what it earned and what it spent, ending in the two profit
 *          figures the owner actually reads.
 *
 * THE TWO RULES THAT WERE DECIDED RATHER THAN ASSUMED
 *
 * 1. A SALE COUNTS ONLY WHAT THE CUSTOMER ACTUALLY PAID.
 *
 *    The credit part of a sale is not income the day it is made; it is
 *    a debt. It becomes income when it is collected, and it arrives
 *    then as Customer Due Collection inside Income.
 *
 *    So the full value of a sale IS counted, exactly once, but
 *    sometimes across two periods. The alternative — counting the
 *    whole sale now AND the collection later — would report the same
 *    money twice and inflate Gross Profit by every taka of credit the
 *    shop ever recovered.
 *
 *    Sale Profit is the trading margin on everything sold, paid for or
 *    not, because that is what Net Profit is asking about: whether the
 *    goods were sold well, not whether the customer has settled up.
 *    The sheet prints the reconciliation so the two are never confused.
 *
 * 2. STOCK MOVED TO A SISTER SHOP IS A SALE WITH NO PROFIT.
 *
 *    It goes out at cost, so value and cost cancel and it contributes
 *    nothing to Sale Profit. It is shown on its own line rather than
 *    buried, because a month with a big transfer would otherwise look
 *    like a month of unprofitable trading.
 *
 * WHAT IS KEPT OUT OF SHOP EXPENSE, AND WHY
 *
 * Shop Expense is the cost of RUNNING the shop, and it is what Net
 * Profit is measured against. Three things are money leaving the till
 * without being that: settling a supplier, stock arriving from the
 * sister shop, and the owner drawing money out. All three stay in
 * Total Expense. Counting them as Shop Expense would make the shop
 * look less profitable every time it restocked.
 */

export type ProfitLossData = {
  // ---- Opening (the day before the period)
  openingStock: number
  /** Supplier account: positive = advance paid, negative = owed. */
  openingSupplierBalance: number
  openingCustomerDue: number
  /** Last day's brought-forward cash. */
  openingCash: number

  // ---- The period
  purchasesByCategory: { category: string; amount: number }[]

  // ---- Trading
  /** Everything sold, at what the shop charged. */
  saleValue: number
  /** Of which, moved to a sister shop at cost — no profit in it. */
  transferValue: number
  /** What those goods had cost to buy. */
  productCost: number
  /** What customers actually handed over against this period's sales. */
  saleReceived: number
  /**
   * Supplier promos on this period's sales, already inside saleValue.
   * The customer did not pay it and does not owe it: the supplier does.
   */
  salePromo?: number

  // ---- Income
  ownerInvest: number
  supplierPaidToShop: number
  customerDueCollection: number

  // ---- Expense
  supplierPayment: number
  ownerPayment: number
  stockTransferIn: number
  /** The cost of running the shop: everything else. */
  shopExpense: number
  /**
   * The part of Supplier Paid to Shop that settled promo claims. Left
   * out of Net Profit: the promo is already in Sale Profit, the day the
   * handset was sold, and counting the repayment too would count it twice.
   */
  promoReceived?: number

  /** Where the till actually finished. */
  closingCash: number
}

const CSS = `
  .pl2 { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1.5px solid #333; }
  .pl2 > tbody > tr > td { border: 1px solid #333; vertical-align: top; padding: 0; }
  .side { width: 50%; }
  .band { display: flex; }
  .band-name { width: 108px; flex: none; border-right: 1px solid #333; padding: 10px 6px;
               font-weight: bold; font-size: 11px; }
  .band-body { flex: 1; padding: 10px 12px; }
  .ln { display: flex; justify-content: space-between; gap: 10px; font-size: 11px;
        padding: 2px 0; }
  .ln .lbl { flex: 1; }
  .ln .amt { font-family: "Courier New", monospace; white-space: nowrap; text-align: right; }
  .ln.ind .lbl { padding-left: 16px; }
  .ln.sum { font-weight: bold; border-top: 1px solid #333; margin-top: 6px; padding-top: 5px; }
  .ln.key { font-weight: bold; border: 1.5px solid #33f; padding: 5px 6px; margin: 7px 0; }
  .ln.muted .lbl, .ln.muted .amt { color: #555; }
  .grp { font-weight: bold; font-size: 11px; margin: 9px 0 3px; }
  .note { font-size: 9px; color: #666; padding: 1px 0 3px 16px; font-style: italic; }
  .cash { color: #b45309; font-weight: bold; }
  .bfc { color: #1d4ed8; font-weight: bold; }
  .spacer { height: 7px; }
`

const ln = (label: string, amount: number, cls = "") =>
  `<div class="ln ${cls}"><span class="lbl">${esc(label)}</span><span class="amt">${money(amount)}</span></div>`

const plain = (label: string, cls = "") =>
  `<div class="ln ${cls}"><span class="lbl">${esc(label)}</span><span class="amt"></span></div>`

const note = (text: string) => `<div class="note">${esc(text)}</div>`

/**
 * A supplier balance reads differently depending on its sign, and
 * "-50,000" against a line called "Supplier Due / Advance" tells the
 * reader nothing about which it is.
 */
const supplierLine = (label: string, balance: number) =>
  `<div class="ln"><span class="lbl">${esc(label)} ${
    balance < 0 ? "(due)" : balance > 0 ? "(advance)" : ""
  }</span><span class="amt">${money(Math.abs(balance))}</span></div>`

export function printProfitLoss({
  header,
  period,
  data,
}: {
  header: ReportHeader
  period: string
  data: ProfitLossData
}): boolean {
  const d = data

  // ---- LEFT
  const totalPurchase = d.purchasesByCategory.reduce((s, p) => s + p.amount, 0)

  const A = d.openingStock + d.openingSupplierBalance + d.openingCustomerDue
  const B = totalPurchase
  const closing = A + B - d.productCost + d.closingCash

  // ---- RIGHT
  //
  // The transfer is at cost, so it cancels out of the margin on its
  // own; subtracting it from both sides states that rather than
  // relying on it.
  const saleProfit = d.saleValue - d.transferValue - (d.productCost - d.transferValue)
  const salePromo = d.salePromo ?? 0
  const promoReceived = d.promoReceived ?? 0
  const unpaid = d.saleValue - salePromo - d.saleReceived

  const income = d.ownerInvest + d.supplierPaidToShop + d.customerDueCollection
  const totalIncome = d.saleReceived + income

  const totalExpense =
    d.shopExpense + d.supplierPayment + d.ownerPayment + d.stockTransferIn

  const grossProfit = totalIncome - totalExpense
  const netProfit = saleProfit + d.supplierPaidToShop - promoReceived - d.shopExpense

  const left = `
    <div class="band">
      <div class="band-name">Opening Details</div>
      <div class="band-body">
        ${ln("Opening Stock (all categories, at cost)", d.openingStock)}
        ${note("Last day's closing stock")}
        ${supplierLine("Opening Supplier Due / Advance", d.openingSupplierBalance)}
        ${ln("Customer Due", d.openingCustomerDue)}
        <div class="ln"><span class="lbl bfc">Cash in hand — last day BFC</span><span class="amt bfc">${money(d.openingCash)}</span></div>
        ${ln("A = Opening Stock + Supplier Balance + Customer Due", A, "sum")}
      </div>
    </div>

    <div class="band" style="border-top:1px solid #333">
      <div class="band-name">Today</div>
      <div class="band-body">
        <div class="grp">Purchase Details (category wise)</div>
        ${
          d.purchasesByCategory.length
            ? d.purchasesByCategory.map((p) => ln(p.category, p.amount, "ind")).join("")
            : plain("Nothing bought in this period", "ind muted")
        }
        ${ln("Total Purchase", totalPurchase, "ind")}
        ${ln("B = Total Purchase", B, "sum")}
      </div>
    </div>

    <div class="band" style="border-top:1px solid #333">
      <div class="band-name">Closing Details</div>
      <div class="band-body">
        ${ln("A + B", A + B)}
        ${ln("Less: cost of products sold", -d.productCost, "ind")}
        <div class="ln"><span class="lbl cash">Add: cash in hand</span><span class="amt cash">${money(d.closingCash)}</span></div>
        ${ln("Closing Total", closing, "sum")}
      </div>
    </div>`

  const right = `
    <div class="band">
      <div class="band-body">
        <div class="ln"><span class="lbl bfc">Last Day BFC</span><span class="amt bfc">${money(d.openingCash)}</span></div>

        <div class="grp">Sale</div>
        ${ln("Total Product Cost", d.productCost, "ind")}
        ${ln("Sale Profit", saleProfit, "ind")}
        ${
          d.transferValue > 0
            ? ln("Stock moved to sister shop (at cost)", d.transferValue, "ind muted") +
              note("Counted in the sale, carries no profit")
            : ""
        }
        ${ln("Sale", d.saleValue, "ind")}
        ${salePromo > 0 ? ln("Less: supplier promo (claimed from the supplier)", -salePromo, "ind muted") : ""}
        ${unpaid !== 0 ? ln("Less: unpaid (customer due)", -unpaid, "ind muted") : ""}
        ${ln("Sale — received", d.saleReceived, "sum")}
        ${note("Only what the customer paid counts here. The rest arrives as Customer Due Collection when it is collected.")}

        <div class="grp">Income</div>
        ${ln("Owner Invest", d.ownerInvest, "ind")}
        ${ln("Supplier Paid to Shop", d.supplierPaidToShop, "ind")}
        ${ln("Customer Due Collection", d.customerDueCollection, "ind")}
        ${ln("Total Income (from income)", income, "sum")}

        <div class="grp">Expense</div>
        ${ln("Shop Expense", d.shopExpense, "ind")}
        ${note("Running the shop only")}
        ${ln("Supplier Payment", d.supplierPayment, "ind")}
        ${d.stockTransferIn > 0 ? ln("Stock from sister shop", d.stockTransferIn, "ind") : ""}
        ${ln("Paid to Owner (bank + cash)", d.ownerPayment, "ind")}
        ${ln("Total Expense", totalExpense, "sum")}

        <div class="spacer"></div>
        ${ln("Total Income = Sale + Income", totalIncome, "sum")}
        ${ln("Gross Profit = Total Income − Total Expense", grossProfit, "key")}
        ${ln("Net Profit = Sale Profit + Supplier Paid to Shop − Shop Expense", netProfit, "key")}
        ${
          promoReceived > 0
            ? note(`Promo repayments (${money(promoReceived)}) are left out: the promo is already in Sale Profit.`)
            : ""
        }

        <div class="spacer"></div>
        <div class="ln"><span class="lbl cash">Cash in hand — Day Cashbook</span><span class="amt cash">${money(d.closingCash)}</span></div>
      </div>
    </div>`

  const html = `
    <style>${CSS}</style>
    ${letterhead(header, "PROFIT & LOSS", period)}
    <table class="pl2">
      <tbody>
        <tr>
          <td class="side">${left}</td>
          <td class="side">${right}</td>
        </tr>
      </tbody>
    </table>
    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return openReport("Profit & Loss", html)
}
