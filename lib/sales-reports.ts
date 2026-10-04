import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt"

/**
 * The three sheets the shop actually reads.
 *
 * Each answers a different question, which is why one report could not
 * be made to serve all three:
 *
 *   SALES REPORT          what sold, by brand, and what it earned
 *   DETAILS SALES REPORT  every line with who bought it and how it was paid
 *   IME WISE STATEMENT    which specific handsets left, by serial
 *
 * They are modelled on the sheets the shop used before this software,
 * down to the order of the closing totals, because those are what the
 * owner checks against by eye at the end of a day.
 */

export type ReportProduct = {
  barcode: string | null
  product_name: string
  model_number: string | null
  color: string | null
  quantity: number
  unit_price: number
  discount_amount: number | null
  total_price: number
  cost_price: number | null
  brand: string | null
  category: string | null
  variant: string | null
}

export type ReportSale = {
  id: string
  invoiceNumber: string | null
  dateISO: string
  customer: string | null
  customerPhone: string | null
  total: number
  totalDiscount: number
  cashPaid: number
  bankPaid: number
  dues: number
  products: ReportProduct[]
}

/** What came back over the same period, for the returns line. */
export type ReportReturn = { qty: number; amount: number }

export type ReportHeader = { name: string; addressLine: string }

const money = (n: number) =>
  (Number(n) || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

const day = (iso: string) => {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

const dash = (v: unknown) => {
  const s = String(v ?? "").trim()
  return s === "" ? "—" : esc(s)
}

/**
 * Shared chrome.
 *
 * The rule above the title and the double rule under the closing total
 * are not decoration — they are how the owner finds the bottom of a
 * sheet in a stack of them.
 */
const CSS = `
  body { font-family: Arial, sans-serif; margin: 16px; font-size: 12px; color: #111; }
  .header { text-align: center; margin-bottom: 6px; }
  .company { font-size: 20px; font-weight: bold; color: #7a1a1a; letter-spacing: .5px; }
  .address { font-size: 10.5px; margin-top: 2px; }
  .title { font-size: 14px; font-weight: bold; margin-top: 10px; letter-spacing: .5px; }
  .rule { border-top: 2px solid #7a1a1a; margin: 6px 0 8px; }
  .period { text-align: center; font-size: 12px; margin-bottom: 12px; }
  .filters { text-align: center; font-size: 10.5px; color: #666; margin-bottom: 10px; }

  table { width: 100%; border-collapse: collapse; }
  .grid { border: 1.5px solid #000; margin-bottom: 4px; }
  .grid th, .grid td { border: 1px solid #000; padding: 4px 6px; font-size: 11px; }
  .grid th { background: #fff; font-weight: bold; text-align: center; }
  .c { text-align: center; }
  .r { text-align: right; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .serial { font-family: "Courier New", monospace; }
  /* Serials wrap inside their cell rather than stretching the row off
     the page. Each is kept whole, so one never breaks across lines. */

  .group-name { text-align: center; font-weight: bold; color: #1a7a3c; margin: 14px 0 4px; font-size: 13px; }
  .group-total td { font-weight: bold; border-top: 1.5px solid #1a7a3c; }
  .group-rule { border-top: 2px solid #1a7a3c; margin: 2px 0 10px; }

  .totals { width: 62%; margin-left: auto; margin-top: 10px; }
  .totals td { padding: 3px 6px; font-size: 12px; }
  .totals td.label { text-align: right; }
  .totals td.val { text-align: right; font-variant-numeric: tabular-nums; width: 140px; }
  .totals tr.big td { font-size: 14px; font-weight: bold; }
  .totals tr.grand td { border-top: 1.5px solid #1a7a3c; font-weight: bold; }
  .totals tr.close td { border-top: 2px solid #7a1a1a; border-bottom: 2px solid #7a1a1a; font-size: 14px; font-weight: bold; }
  .muted { color: #3a3aa0; }

  .empty { text-align: center; padding: 30px; color: #666; }
  .foot { margin-top: 22px; text-align: center; font-size: 10px; color: #666; }
  @media print { body { margin: 10px; } }
`

function open(title: string, body: string): boolean {
  const win = window.open("", "_blank", "width=1100,height=760")
  if (!win) return false
  win.document.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title>
    <style>${CSS}${DOCUMENT_TOOLBAR_CSS}</style></head>
    <body>${documentToolbar(title)}${body}</body></html>`)
  win.document.close()
  return true
}

function letterhead(header: ReportHeader, title: string, period: string, filters?: string) {
  return `
    <div class="header">
      <div class="company">${header.name}</div>
      <div class="address">${header.addressLine}</div>
      <div class="title">${esc(title)}</div>
    </div>
    <div class="rule"></div>
    <div class="period">${esc(period)}</div>
    ${filters ? `<div class="filters">${esc(filters)}</div>` : ""}`
}

/**
 * SALES REPORT — what sold, grouped by brand.
 *
 * Identical brand + model + colour collapse into one line, so ten sales
 * of the same handset read as one row of ten rather than ten rows of
 * one. That is what makes the sheet comparable week to week.
 */
export function printSalesReport(args: {
  header: ReportHeader
  period: string
  filters?: string
  sales: ReportSale[]
  returns: ReportReturn
  adjustment?: number
}): boolean {
  const { header, period, filters, sales, returns } = args
  const adjustment = args.adjustment ?? 0

  type Line = {
    brand: string
    model: string
    color: string
    qty: number
    amount: number
    profit: number
  }
  const groups = new Map<string, Map<string, Line>>()

  for (const sale of sales) {
    for (const p of sale.products) {
      const brand = (p.brand || "").trim() || "Unbranded"
      const model = (p.model_number || "").trim() || "—"
      const color = (p.color || "").trim() || "—"
      const qty = Number(p.quantity) || 0
      const amount = Number(p.total_price) || 0
      const cost = (Number(p.cost_price) || 0) * qty

      if (!groups.has(brand)) groups.set(brand, new Map())
      const rows = groups.get(brand)!
      const key = `${model}|${color}`
      const found = rows.get(key)
      if (found) {
        found.qty += qty
        found.amount += amount
        found.profit += amount - cost
      } else {
        rows.set(key, { brand, model, color, qty, amount, profit: amount - cost })
      }
    }
  }

  let sl = 0
  let grandQty = 0
  let grandAmount = 0
  let grandProfit = 0

  const body = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, rows]) => {
      const lines = Array.from(rows.values()).sort(
        (a, b) => a.model.localeCompare(b.model) || a.color.localeCompare(b.color),
      )

      let gQty = 0
      let gAmount = 0
      let gProfit = 0

      const trs = lines
        .map((l) => {
          sl += 1
          gQty += l.qty
          gAmount += l.amount
          gProfit += l.profit
          // Every serial on the line, numbered, not "+7 more". This is
          // the column the shop checks the sheet against the shelf
          // with, and a hidden serial is one that cannot be checked.
          // Counted stock has none, so it reads as a dash.
          return `
            <tr>
              <td class="c">${sl}</td>
              <td class="c">${dash(l.brand)}</td>
              <td class="c">${dash(l.model)}</td>
              <td class="c">${dash(l.color)}</td>
              <td class="c">${l.qty}</td>
              <td class="num">${money(l.amount)}</td>
              <td class="num">${money(l.profit)}</td>
            </tr>`
        })
        .join("")

      grandQty += gQty
      grandAmount += gAmount
      grandProfit += gProfit

      return `
        <div class="group-name">${dash(brand)}</div>
        <table class="grid">
          <thead><tr>
            <th style="width:5%">SL.</th>
            <th style="width:20%">Brandname</th>
            <th style="width:24%">Model</th>
            <th style="width:17%">Color</th>
            <th style="width:8%">Qty</th>
            <th style="width:13%">Amount</th>
            <th style="width:13%">Profit</th>
          </tr></thead>
          <tbody>
            ${trs}
            <tr class="group-total">
              <td colspan="4" class="r">Group Total :</td>
              <td class="c">${gQty}</td>
              <td class="num">${money(gAmount)}</td>
              <td class="num">${money(gProfit)}</td>
            </tr>
          </tbody>
        </table>
        <div class="group-rule"></div>`
    })
    .join("")

  const dues = sales.reduce((s, x) => s + x.dues, 0)
  const discount = sales.reduce((s, x) => s + x.totalDiscount, 0)

  // What the shop actually took, after everything that reduces it.
  // Stated in the order the old sheet stated it, because that is the
  // order the owner reads down.
  const actual = grandAmount - returns.amount - dues - adjustment

  const html = `
    ${letterhead(header, "SALES REPORT", period, filters)}
    ${body || '<div class="empty">No sales in this period.</div>'}

    <table class="totals">
      <tr class="grand">
        <td class="label">Grand Total</td>
        <td class="val">${grandQty}</td>
        <td class="val">${money(grandAmount)}</td>
        <td class="val">${money(grandProfit)}</td>
      </tr>
      <tr>
        <td class="label">Total Sales Return Qty</td>
        <td class="val">${returns.qty}</td>
        <td class="val">${money(returns.amount)}</td>
        <td class="val"></td>
      </tr>
      <tr class="big"><td class="label">Total Dues (-)</td><td class="val"></td><td class="val">${money(dues)}</td><td class="val"></td></tr>
      <tr class="big"><td class="label">Total Discount (-)</td><td class="val"></td><td class="val">${money(discount)}</td><td class="val"></td></tr>
      <tr><td class="label muted">Adjectment Total(-)</td><td class="val"></td><td class="val muted">${money(adjustment)}</td><td class="val"></td></tr>
      <tr class="close">
        <td class="label">Actual Total</td>
        <td class="val"></td>
        <td class="val">${money(actual)}</td>
        <td class="val">${money(grandProfit)}</td>
      </tr>
    </table>

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return open("Sales Report", html)
}

/**
 * DETAILS SALES REPORT — every line, with who bought it and how.
 *
 * One row per product sold rather than per invoice, with the invoice's
 * own figures repeated across its lines. The shop reads this against a
 * bank statement, which is why cash and bank are separate columns.
 */
export function printDetailsReport(args: {
  header: ReportHeader
  period: string
  filters?: string
  sales: ReportSale[]
  adjustment?: number
}): boolean {
  const { header, period, filters, sales } = args
  const adjustment = args.adjustment ?? 0

  let sl = 0
  let tQty = 0
  let tAmount = 0
  let tDiscount = 0
  let tCash = 0
  let tBank = 0
  let tDues = 0

  const rows = sales
    .slice()
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id))
    .flatMap((s) =>
      s.products.map((p, i) => {
        sl += 1
        const qty = Number(p.quantity) || 0
        const amount = Number(p.total_price) || 0
        const discount = (Number(p.discount_amount) || 0) * qty

        tQty += qty
        tAmount += amount
        tDiscount += discount

        // The invoice's money lands on its FIRST line only. Repeating it
        // on every line would make a two-product sale look like it took
        // the money twice, and the column would not foot.
        const first = i === 0
        if (first) {
          tCash += s.cashPaid
          tBank += s.bankPaid
          tDues += s.dues
        }

        return `
          <tr>
            <td class="c">${sl}</td>
            <td class="c">${day(s.dateISO)}</td>
            <td class="c">${dash(s.invoiceNumber)}</td>
            <td>${dash(s.customer)}</td>
            <td class="c">${dash(s.customerPhone)}</td>
            <td class="c">${dash(p.brand)}</td>
            <td class="c">${dash(p.model_number)}</td>
            <td class="c">${dash(p.color)}</td>
            <td class="c">${qty}</td>
            <td class="num">${money(amount)}</td>
            <td class="num">${money(discount)}</td>
            <td class="num">${first ? money(s.cashPaid) : ""}</td>
            <td class="num">${first ? money(s.bankPaid) : ""}</td>
            <td class="num">${first ? money(s.dues) : ""}</td>
          </tr>`
      }),
    )
    .join("")

  const html = `
    ${letterhead(header, "DETAILS SALES REPORT", period, filters)}

    <table class="grid">
      <thead><tr>
        <th>SL#</th><th>Sales</th><th>Voucher No</th><th>Purchase Person</th>
        <th>Address</th><th>Brand Name</th><th>Model</th><th>Color</th>
        <th>Qty</th><th>Amount</th><th>Discount</th>
        <th>Cash paid</th><th>Bank paid</th><th>Dues Amount</th>
      </tr></thead>
      <tbody>
        ${rows || '<tr><td colspan="14" class="c">No sales in this period.</td></tr>'}
        <tr class="group-total">
          <td colspan="8" class="r">GRAND TOTAL :</td>
          <td class="c">${tQty}</td>
          <td class="num">${money(tAmount)}</td>
          <td class="num">${money(tDiscount)}</td>
          <td class="num">${money(tCash)}</td>
          <td class="num">${money(tBank)}</td>
          <td class="num">${money(tDues)}</td>
        </tr>
      </tbody>
    </table>

    <table class="totals">
      <tr><td class="label">Total Adjectment (-)</td><td class="val">${money(adjustment)}</td></tr>
      <tr class="close"><td class="label">CLOSE SALES :</td><td class="val">${money(tAmount - adjustment)}</td></tr>
    </table>

    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return open("Details Sales Report", html)
}

/**
 * IME WISE SALES STATEMENT — which handsets left, by serial.
 *
 * Brand, then model, then colour, then the serials underneath. This is
 * the sheet someone reaches for when a customer comes back with a
 * handset and a question, so it lists every unit individually and never
 * collapses them into a quantity.
 */
export function printImeiReport(args: {
  header: ReportHeader
  period: string
  filters?: string
  sales: ReportSale[]
}): boolean {
  const { header, period, filters, sales } = args

  type Unit = { imei: string; date: string }
  // brand -> model -> colour -> units
  const tree = new Map<string, Map<string, Map<string, Unit[]>>>()

  for (const sale of sales) {
    for (const p of sale.products) {
      const brand = (p.brand || "").trim() || "Unbranded"
      const model = (p.model_number || "").trim() || "—"
      const color = (p.color || "").trim() || "—"

      // Counted stock carries a generated key rather than a serial, and
      // printing NB-4213 next to real IMEIs would read as one. Shown as
      // a dash: the shop knows those units are not individually tracked.
      const raw = (p.barcode || "").trim()
      const imei = !raw || raw.startsWith("NB-") ? "—" : raw

      if (!tree.has(brand)) tree.set(brand, new Map())
      const models = tree.get(brand)!
      if (!models.has(model)) models.set(model, new Map())
      const colors = models.get(model)!
      if (!colors.has(color)) colors.set(color, [])

      // One row per unit. A line of three handsets is three serials on
      // the shop's own paperwork, even where only one was recorded.
      const units = colors.get(color)!
      const qty = Math.max(1, Number(p.quantity) || 1)
      for (let i = 0; i < qty; i++) units.push({ imei, date: sale.dateISO })
    }
  }

  const body = Array.from(tree.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, models]) => {
      const inner = Array.from(models.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([model, colors]) => {
          const byColor = Array.from(colors.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([color, units]) => {
              const trs = units
                .map(
                  (u, i) => `
                  <tr>
                    <td class="c" style="width:14%">${i + 1}</td>
                    <td class="c serial" style="width:50%">${dash(u.imei)}</td>
                    <td class="c" style="width:36%">${day(u.date)}</td>
                  </tr>`,
                )
                .join("")

              return `
                <div style="margin-left:56px;margin-top:6px;">
                  <div style="font-weight:bold;color:#1a3a8a;">COLOR : <span style="color:#1a3a8a;">${dash(color)}</span></div>
                  <table class="grid" style="width:52%;margin-left:24px;margin-top:4px;">
                    <thead><tr><th>SL.</th><th>IME NO</th><th>SALES DATE</th></tr></thead>
                    <tbody>${trs}</tbody>
                  </table>
                </div>`
            })
            .join("")

          return `
            <div style="margin-left:28px;margin-top:10px;">
              <div style="font-weight:bold;color:#7a6a1a;">MODEL No. : <span style="color:#1a7a3c;">${dash(model)}</span></div>
              ${byColor}
            </div>`
        })
        .join("")

      return `
        <div style="margin-top:16px;">
          <div style="font-weight:bold;">BRAND NAME <span style="color:#7a1a1a;">${dash(brand)}</span></div>
          ${inner}
        </div>`
    })
    .join("")

  const html = `
    ${letterhead(header, "IME WISE SALES STATEMENT", period, filters)}
    ${body || '<div class="empty">No sales in this period.</div>'}
    <div class="foot">Generated on ${new Date().toLocaleString("en-GB")}</div>`

  return open("IME Wise Sales Statement", html)
}
