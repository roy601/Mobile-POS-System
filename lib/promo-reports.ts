/**
 * The promo statement: what each supplier owes the shop, and for what.
 *
 * The shop hands this to the supplier's representative, or checks it
 * against the figure they bring. So it is not a total — it is every
 * handset, with the date it went out and the amount claimed on it,
 * under the promo it was sold on, under the supplier who funded it.
 *
 * Set out like the shop's other grouped reports (Purchase Ledger, Own
 * Expense), so it reads as one of the family rather than a new kind of
 * document.
 */

import { dayUK, esc, letterhead, money, openReport, type ReportHeader } from "@/lib/report-chrome"
import { promoLabel, promoPeriod, round2, type PromoClaim } from "@/lib/promo"

/** A sold line that carried a promo. */
export type PromoSaleLine = {
  id: number
  sales_id: number | null
  promo_id: number
  promo_amount: number
  quantity: number
  product_name: string | null
  model_number: string | null
  variant?: string | null
  barcode: string | null
  created_at: string
}

const GROUPED_CSS = `
  .title { color: #1a7a2a; }
  .xsupplier { margin: 18px 0 4px; font-size: 13.5px; letter-spacing: .3px; }
  .xsupplier span { color: #7a1a1a; font-weight: bold; text-decoration: underline; }
  .xpromo { margin: 10px 0 4px 6%; font-size: 12.5px; font-weight: bold; }
  .xpromo .muted { font-weight: normal; color: #444; }
  .xgrid { width: 88%; margin-left: 6%; }
  .xtotals3 { width: 88%; margin-left: 6%; margin-top: 2px; border-collapse: collapse; }
  .xtotals3 td { padding: 3px 6px; font-size: 11.5px; font-weight: bold; text-align: right;
                 font-variant-numeric: tabular-nums; }
  .xtotals3 td.v { border-bottom: 1.5px solid #000; }
  .xtotals3.grand { margin-top: 16px; }
  .xtotals3.grand td { font-size: 13px; }
  .xtotals3.grand td.v { border-bottom: 3px double #7a1a1a; }
  .xnone { margin-left: 6%; font-size: 11.5px; font-style: italic; color: #555; }
`

export function printPromoStatement(args: {
  header: ReportHeader
  claims: PromoClaim[]
  lines: PromoSaleLine[]
  supplierName: (id: string) => string
  filters?: string
}): boolean {
  const { header, claims, lines, supplierName, filters } = args

  const linesByPromo = new Map<number, PromoSaleLine[]>()
  for (const l of lines) {
    const list = linesByPromo.get(l.promo_id)
    if (list) list.push(l)
    else linesByPromo.set(l.promo_id, [l])
  }

  // One block per supplier, and inside it one per promo: the order the
  // conversation with the supplier actually takes.
  const bySupplier = new Map<string, PromoClaim[]>()
  for (const c of claims) {
    const list = bySupplier.get(c.supplier_id)
    if (list) list.push(c)
    else bySupplier.set(c.supplier_id, [c])
  }

  let grandClaimed = 0
  let grandReceived = 0
  let grandOutstanding = 0

  const body = [...bySupplier.entries()]
    .map(([supplierId, promos]) => {
      let sClaimed = 0
      let sReceived = 0
      let sOutstanding = 0

      const blocks = promos
        .map((c) => {
          // Claimable is what went out less what came back: a returned
          // handset is not the supplier's to fund.
          const claimable = round2(Number(c.claimed || 0) - Number(c.returned_amount || 0))
          sClaimed = round2(sClaimed + claimable)
          sReceived = round2(sReceived + Number(c.received || 0))
          sOutstanding = round2(sOutstanding + Number(c.outstanding || 0))

          const rows = (linesByPromo.get(c.promo_id) ?? [])
            .map(
              (l) => `
            <tr>
              <td class="c">${dayUK(l.created_at)}</td>
              <td>${esc(
                [l.product_name, l.model_number, l.variant].filter(Boolean).join(" ") || "—",
              )}</td>
              <td>${esc(l.barcode || "—")}</td>
              <td class="num">${l.quantity}</td>
              <td class="num">${money(l.promo_amount)}</td>
              <td class="num">${money(round2(Number(l.promo_amount) * Number(l.quantity)))}</td>
            </tr>`,
            )
            .join("")

          return `
        <div class="xpromo">${esc(promoLabel(c))} — ${money(c.amount)} per unit
          <span class="muted">(${esc(promoPeriod(c))})</span></div>
        ${
          rows
            ? `<table class="grid xgrid">
          <thead><tr>
            <th style="width:14%">Date</th>
            <th style="width:32%">Item</th>
            <th style="width:24%">IMEI / code</th>
            <th style="width:8%">Qty</th>
            <th style="width:11%">Per unit</th>
            <th style="width:11%">Claimed</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : `<div class="xnone">Nothing sold on this promo yet.</div>`
        }
        <table class="xtotals3">
          <tr>
            <td style="width:55%">Claimed${
              Number(c.returned_amount) ? ` (after ${money(c.returned_amount)} returned)` : ""
            }</td>
            <td class="v" style="width:15%">${money(claimable)}</td>
            <td style="width:15%">Received ${money(c.received)}</td>
            <td class="v" style="width:15%">${money(c.outstanding)}</td>
          </tr>
        </table>`
        })
        .join("")

      grandClaimed = round2(grandClaimed + sClaimed)
      grandReceived = round2(grandReceived + sReceived)
      grandOutstanding = round2(grandOutstanding + sOutstanding)

      return `
        <div class="xsupplier">SUPPLIER: <span>${esc(supplierName(supplierId))}</span></div>
        ${blocks}
        <table class="xtotals3">
          <tr>
            <td style="width:55%">Supplier total</td>
            <td class="v" style="width:15%">${money(sClaimed)}</td>
            <td style="width:15%">Received ${money(sReceived)}</td>
            <td class="v" style="width:15%">${money(sOutstanding)}</td>
          </tr>
        </table>`
    })
    .join("")

  const html = `
    <style>${GROUPED_CSS}</style>
    ${letterhead(header, "SUPPLIER PROMO STATEMENT", "", filters)}
    ${body || '<div class="empty">No promos recorded.</div>'}
    <table class="xtotals3 grand">
      <tr>
        <td style="width:55%">Grand Total</td>
        <td class="v" style="width:15%">${money(grandClaimed)}</td>
        <td style="width:15%">Received ${money(grandReceived)}</td>
        <td class="v" style="width:15%">${money(grandOutstanding)}</td>
      </tr>
    </table>`

  return openReport("Supplier Promo Statement", html)
}
