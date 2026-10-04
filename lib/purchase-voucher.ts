import type { Shop } from "@/components/role-provider"
import { shopHeader } from "@/lib/utils/shop-header"
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt"

/**
 * A purchase voucher and the pieces that hang off it.
 *
 * Shared between the Purchases screen, which lists vouchers, and the
 * Expenses screen, which pays them off. Both show the same figures and
 * print the same document, and there is no version of this where the
 * two are allowed to disagree about what a supplier is owed.
 */

export type VoucherRow = {
  id: number
  voucher_no: string
  voucher_date: string
  supplier: string | null
  supplier_id: string | null
  total_quantity: number | null
  net_amount: number | null
  discount: number | null
  adjustment: number | null
  party_amount: number | null
  paid_amount: number | null
  due_amount: number | null
  due_settled: number | null
  remarks: string | null
  created_at?: string
}

/**
 * ONE UNIT on a voucher — one handset, one IMEI.
 *
 * Deliberately not grouped. A voucher is the document the shop argues
 * from, and the argument is always about a specific handset: which one
 * came in on this delivery, and is this the one that came back faulty.
 * A line saying "Camon 50, qty 2" cannot answer that, and the serials
 * are what the supplier's own invoice lists.
 *
 * Counted stock — cables, covers, glass — has no serial to list, so it
 * stays as the single row the shop actually recorded, carrying its
 * whole quantity.
 */
export type VoucherItem = {
  id: string
  /** The unit's serial. Null for counted stock, which has none. */
  imei: string | null
  product_name: string | null
  brand: string | null
  model_number: string | null
  category: string | null
  variant: string | null
  color: string | null
  cost_price: number | null
  sale_price: number | null
  /**
   * How many came in on this delivery — NOT how many are on the shelf
   * now. A handset sold the next day was still delivered and is still
   * in the voucher's total, so it must not print as 0.
   */
  quantity: number
}

/** A payment made against a voucher after the day it was written. */
export type VoucherPayment = {
  id: string
  date: string
  /** The part of the payment that went to THIS voucher. */
  amount: number
  /**
   * The whole payment, when only part of it reached this voucher. A
   * payment clears the oldest voucher first, so 1,75,000 handed over
   * can show here as 16,899 — the shop needs to see both to recognise it.
   */
  payment_total?: number | null
  payment_method: string | null
  bank_name: string | null
  reference: string | null
  notes: string | null
}

export const money = (n: unknown) =>
  `৳${(Number(n) || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

/**
 * What a voucher has been paid, by either route.
 *
 * paid_amount is the money handed over on the day the stock arrived;
 * due_settled is everything paid against it since. A shop that always
 * pays later has paid_amount 0 on every voucher, so counting only that
 * reported "Paid 0.00" over a wall of vouchers that were fully paid -
 * which is what Star Power 02 saw. The two together are what the
 * supplier has actually had.
 */
export const paidOf = (v: VoucherRow) =>
  Math.round(((Number(v.paid_amount) || 0) + (Number(v.due_settled) || 0)) * 100) / 100

/**
 * What is still owed on a voucher.
 *
 * due_amount is what it owed on the day it was written and is never
 * edited afterwards — reports read the day's figures, and quietly
 * changing a closed day a fortnight later gives the shop books that no
 * longer add up to what they were told at the time. Payments since
 * move due_settled, so the live balance is the difference.
 */
export const outstandingOf = (v: VoucherRow) =>
  Math.max(
    0,
    Math.round(((Number(v.due_amount) || 0) - (Number(v.due_settled) || 0)) * 100) / 100,
  )

function esc(v: unknown) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const day = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB") : "—"

/**
 * Every unit on one voucher, in the order it was entered.
 *
 * One row per handset, carrying its IMEI. Counted stock contributes
 * the single row it was recorded as.
 */
export async function loadVoucherItems(
  supabase: any,
  organizationId: string,
  voucherId: number,
): Promise<VoucherItem[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, product_name, brand, model_number, category, cost_price, sale_price, color_variants(id, quantity, color, variant, barcode, imei, no_barcode, deleted_at)",
    )
    .eq("organization_id", organizationId)
    .eq("voucher_id", voucherId)
    .is("deleted_at", null)
    .order("id", { ascending: true })

  if (error) throw error

  const items: VoucherItem[] = []
  /** Each item's stock barcode, to work out what it was received as. */
  const barcodeOf = new Map<VoucherItem, string>()

  for (const p of (data ?? []) as any[]) {
    const base = {
      product_name: p.product_name,
      brand: p.brand,
      model_number: p.model_number,
      category: p.category,
      cost_price: p.cost_price,
      sale_price: p.sale_price,
    }

    const variants = (p.color_variants ?? [])
      .filter((v: any) => !v.deleted_at)
      // A nested select comes back in no guaranteed order, and a
      // voucher whose serials shuffle between two viewings is not a
      // document anyone can check against paper.
      .sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0))

    // A purchase with no units recorded is still a line on the
    // supplier's invoice; hiding it would make the voucher's own total
    // look wrong.
    if (variants.length === 0) {
      items.push({
        id: `${p.id}`,
        imei: null,
        variant: null,
        color: null,
        quantity: 0,
        ...base,
      })
      continue
    }

    for (const v of variants) {
      const item: VoucherItem = {
        id: `${p.id}-${v.id}`,
        imei: v.imei || v.barcode || null,
        variant: v.variant ?? null,
        color: v.color ?? null,
        quantity: Number(v.quantity) || 0,
        ...base,
      }
      items.push(item)
      if (v.barcode) barcodeOf.set(item, String(v.barcode))
    }
  }

  await restoreReceivedQuantities(supabase, organizationId, barcodeOf)
  return items
}

/**
 * Turn each line's quantity from "on the shelf now" into "came in".
 *
 * The stock row is the only place a unit is recorded, and its quantity
 * goes down as the unit leaves. Nothing stores what it arrived as, so
 * it is worked back from what moved it since:
 *
 *   received = on the shelf now
 *            + sold                          (a sister-shop transfer is a sale too)
 *            + sent back to the supplier
 *            - came back from a customer and went back on the shelf
 *
 * Without this, a handset sold the day after delivery printed with
 * quantity 0 and amount 0 on the voucher, while the voucher's total
 * still counted it — a document whose lines do not add up to its total.
 *
 * If any of it cannot be read, the shelf figures stand: a voucher that
 * opens is worth more than one that refuses to over a lookup.
 */
async function restoreReceivedQuantities(
  supabase: any,
  organizationId: string,
  barcodeOf: Map<VoucherItem, string>,
) {
  const barcodes = Array.from(new Set(barcodeOf.values()))
  if (barcodes.length === 0) return

  const moved = new Map<string, number>()
  const add = (barcode: string | null | undefined, n: unknown) => {
    if (!barcode) return
    moved.set(barcode, (moved.get(barcode) ?? 0) + (Number(n) || 0))
  }

  try {
    // In slices: a long voucher's barcodes would otherwise overrun the
    // length of a request URL.
    for (let i = 0; i < barcodes.length; i += 150) {
      const slice = barcodes.slice(i, i + 150)
      const [sold, sentBack, restocked] = await Promise.all([
        supabase
          .from("sold_products")
          .select("barcode, quantity")
          .eq("organization_id", organizationId)
          .in("barcode", slice)
          .is("deleted_at", null),
        supabase
          .from("purchase_return_items")
          .select("barcode, return_quantity")
          .eq("organization_id", organizationId)
          .in("barcode", slice)
          .is("deleted_at", null),
        supabase
          .from("sales_return_items")
          .select("barcode, quantity")
          .eq("organization_id", organizationId)
          .in("barcode", slice)
          .eq("restock", true)
          .is("deleted_at", null),
      ])
      if (sold.error || sentBack.error || restocked.error) return

      for (const r of sold.data ?? []) add(r.barcode, r.quantity)
      for (const r of sentBack.data ?? []) add(r.barcode, r.return_quantity)
      for (const r of restocked.data ?? []) add(r.barcode, -(Number(r.quantity) || 0))
    }
  } catch {
    return
  }

  for (const [item, barcode] of barcodeOf) {
    item.quantity = Math.max(0, item.quantity + (moved.get(barcode) ?? 0))
  }
}

/**
 * Every payment recorded against a voucher, oldest first.
 *
 * Two places hold them. A payment to the SUPPLIER (script 69 onward —
 * how the shop pays today) is split across the open vouchers, oldest
 * first, and each part is a row in purchase_voucher_payments. A
 * payment made against one named voucher, before that, is the expense
 * itself with purchase_voucher_id set.
 *
 * Reading only the second is how a voucher printed "Paid 16,899" over
 * "No payments have been recorded against this voucher": the 16,899
 * was the last part of a 1,75,000 payment, and it lived in the first.
 */
export async function loadVoucherPayments(
  supabase: any,
  organizationId: string,
  voucherId: number,
): Promise<VoucherPayment[]> {
  const [direct, allocated] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, date, amount, payment_method, bank_name, reference, notes")
      .eq("organization_id", organizationId)
      .eq("purchase_voucher_id", voucherId)
      .is("deleted_at", null),
    supabase
      .from("purchase_voucher_payments")
      .select(
        "id, amount, expense_id, expenses(id, date, amount, payment_method, bank_name, reference, notes, deleted_at)",
      )
      .eq("organization_id", organizationId)
      .eq("voucher_id", voucherId)
      .not("expense_id", "is", null),
  ])

  if (direct.error) throw direct.error

  const payments: VoucherPayment[] = (direct.data ?? []) as VoucherPayment[]
  const seen = new Set(payments.map((p) => p.id))

  // A database without script 69 has no allocation table; the direct
  // payments above are then the whole history.
  if (!allocated.error) {
    for (const row of (allocated.data ?? []) as any[]) {
      const e = Array.isArray(row.expenses) ? row.expenses[0] : row.expenses
      if (!e || e.deleted_at || seen.has(e.id)) continue
      seen.add(e.id)
      const part = Number(row.amount) || 0
      const whole = Number(e.amount) || 0
      payments.push({
        id: e.id,
        date: e.date,
        amount: part,
        payment_total: Math.abs(whole - part) > 0.005 ? whole : null,
        payment_method: e.payment_method,
        bank_name: e.bank_name,
        reference: e.reference,
        notes: e.notes,
      })
    }
  }

  return payments.sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/**
 * One voucher on paper: what arrived, what it came to, and where the
 * money stands.
 *
 * This is the document a manager takes to a supplier, so it carries
 * the payment history as well as the balance — "we paid you this on
 * the 4th and this on the 19th" is the whole point of the argument.
 */
export function printVoucher(
  voucher: VoucherRow,
  items: VoucherItem[],
  shop: Shop | null | undefined,
  payments: VoucherPayment[] = [],
) {
  const win = window.open("", "_blank", "width=900,height=700")
  if (!win) return false

  const info = shopHeader(shop)
  const outstanding = outstandingOf(voucher)
  const paidTotal = paidOf(voucher)

  const rows = items
    .map(
      (it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="serial">${esc(it.imei) || "—"}</td>
        <td>${esc(it.product_name)}</td>
        <td>${esc(it.brand)}</td>
        <td>${esc(it.model_number)}</td>
        <td>${esc(it.variant)}</td>
        <td>${esc(it.color)}</td>
        <td class="num">${it.quantity}</td>
        <td class="num">${money(it.cost_price)}</td>
        <td class="num">${money(it.quantity * (Number(it.cost_price) || 0))}</td>
      </tr>`,
    )
    .join("")

  const history = payments.length
    ? `
    <div class="section-title">Payment history</div>
    <table>
      <thead><tr><th>Date</th><th>Reference</th><th>Method</th><th>Note</th><th>Amount</th></tr></thead>
      <tbody>
        ${payments
          .map(
            (p) => `
          <tr>
            <td>${day(p.date)}</td>
            <td>${esc(p.reference)}</td>
            <td>${esc(p.bank_name ? `${p.payment_method} — ${p.bank_name}` : p.payment_method)}</td>
            <td>${esc(p.notes)}</td>
            <td class="num">${money(p.amount)}${
              p.payment_total
                ? `<div class="part">of a ${money(p.payment_total)} payment</div>`
                : ""
            }</td>
          </tr>`,
          )
          .join("")}
        <tr class="total">
          <td colspan="4">Paid since the voucher was written</td>
          <td class="num">${money(voucher.due_settled)}</td>
        </tr>
      </tbody>
    </table>`
    : `<div class="note">No payments have been recorded against this voucher since the day it was written.</div>`

  win.document.write(`<!DOCTYPE html><html><head>
    <title>${esc(voucher.voucher_no)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 16px; font-size: 12px; }
      .header { text-align: center; margin-bottom: 14px; }
      .company-name { font-size: 18px; font-weight: bold; }
      .title { font-size: 15px; font-weight: bold; margin: 8px 0 2px; }
      .meta { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 12px 0; font-size: 12px; }
      .meta div span { color: #555; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; border: 2px solid #000; }
      th, td { border: 1px solid #000; padding: 5px; font-size: 11px; }
      th { background: #f0f0f0; text-align: center; }
      .num { text-align: right; font-family: monospace; }
      .serial { font-family: monospace; font-size: 10px; }
      .part { font-family: Arial, sans-serif; font-size: 9.5px; color: #555; }
      tr.total td { background: #f6f6f6; font-weight: bold; }
      .section-title { font-weight: bold; margin-top: 14px; }
      .note { font-size: 11px; color: #666; margin: 8px 0 14px; }
      .totals { width: 340px; margin-left: auto; border: none; }
      .totals td { border: none; padding: 3px 6px; font-size: 12px; }
      .totals td.num { font-weight: bold; }
      .totals tr.rule td { border-top: 1px solid #000; }
      .totals tr.grand td { border-top: 2px solid #000; font-size: 14px; font-weight: bold; }
      @media print { body { margin: 10px; } }
    ${DOCUMENT_TOOLBAR_CSS}
    </style></head><body>
    ${documentToolbar(esc(voucher.voucher_no))}

    <div class="header">
      <div class="company-name">${info.name}</div>
      <div>${info.addressLine}</div>
      <div class="title">Purchase Voucher</div>
    </div>

    <div class="meta">
      <div><span>Voucher No:</span> <b>${esc(voucher.voucher_no)}</b></div>
      <div><span>Date:</span> ${day(voucher.voucher_date)}</div>
      <div><span>Party Name:</span> <b>${esc(voucher.supplier ?? "—")}</b></div>
      ${voucher.remarks ? `<div><span>Remarks:</span> ${esc(voucher.remarks)}</div>` : ""}
    </div>

    <table>
      <thead><tr>
        <th>#</th><th>IME No</th><th>Item Name</th><th>Brand</th><th>Model</th>
        <th>Variant</th><th>Color</th><th>Qty</th><th>Unit Price</th><th>T.Amount</th>
      </tr></thead>
      <tbody>
        ${rows || `<tr><td colspan="10">No items recorded.</td></tr>`}
        <tr class="total">
          <td colspan="7">Total</td>
          <td class="num">${voucher.total_quantity ?? 0}</td>
          <td></td>
          <td class="num">${money(voucher.net_amount)}</td>
        </tr>
      </tbody>
    </table>

    <table class="totals">
      <tr><td>Net Amount</td><td class="num">${money(voucher.net_amount)}</td></tr>
      <tr><td>Discount (-)</td><td class="num">${money(voucher.discount)}</td></tr>
      <tr><td>Adjustment</td><td class="num">${money(voucher.adjustment)}</td></tr>
      <tr class="rule"><td>Party Amount</td><td class="num">${money(voucher.party_amount)}</td></tr>
      <tr><td>Paid Amount</td><td class="num">${money(paidTotal)}</td></tr>
      <tr class="grand"><td>Dues Amount</td><td class="num">${money(outstanding)}</td></tr>
    </table>

    ${history}

    <div style="margin-top:24px;text-align:center;font-size:11px;color:#666;">
      Generated on ${new Date().toLocaleString("en-GB")}
    </div>
    </body></html>`)

  win.document.close()
  return true
}
