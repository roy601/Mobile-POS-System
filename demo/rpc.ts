/**
 * The database functions the app calls with `supabase.rpc(...)`,
 * rewritten in TypeScript against the demo's tables.
 *
 * Each follows the latest version in the original scripts/ folder
 * (named beside it), cut down to what a demo needs: the checks that
 * protect a real shop's money across several tills are left out.
 * The few that are not worth copying for a demo answer with a polite
 * "not available in the demo" in the shape the screen expects.
 */
import {
  inventoryRows, insertRow, newUuid, persist, rawTable, saleCreditAmount,
  variantForBarcode, type Row,
} from "./db"
import { ok, removeRows, type Result } from "./query"

type Args = Record<string, any>

const num = (v: any) => (v == null || v === "" ? 0 : Number(v) || 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const lc = (v: any) => String(v ?? "").trim().toLowerCase()
const nowIso = () => new Date().toISOString()

const declined = (what: string) =>
  ok({ success: false, message: `${what} is switched off in this demo.` })

function productJson(inv: Row | undefined, notFound: string) {
  if (!inv) return { success: false, message: notFound }
  return {
    success: true,
    barcode: inv.barcode,
    name: inv.product_name,
    model: inv.model_number,
    variant: inv.variant,
    color: inv.color,
    category: inv.category,
    brand: inv.brand,
    price: inv.sale_price,
    available_quantity: inv.quantity,
    no_barcode: inv.no_barcode,
    defective: inv.defective,
  }
}

const liveInventory = (org: string) =>
  inventoryRows().filter((i) => i.organization_id === org && !i.deleted_at)

/** INV-000123: the count of sales so far, skipping any number in use. */
function nextInvoice(org: string, selfId: number) {
  const sales = rawTable("sales").filter((s) => s.organization_id === org)
  let seq = sales.length
  const used = new Set(sales.filter((s) => s.id !== selfId).map((s) => s.invoice_number))
  let inv = `INV-${String(seq).padStart(6, "0")}`
  while (used.has(inv)) inv = `INV-${String(++seq).padStart(6, "0")}`
  return inv
}

/** Timestamp for a sale dated `day` (yyyy-mm-dd): now if today, noon otherwise. */
function saleTimestamp(day?: string | null) {
  if (!day) return nowIso()
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  if (day === todayStr) return nowIso()
  return new Date(`${day}T12:00:00`).toISOString()
}

function recordSalePayments(org: string, saleId: number, payments: any) {
  removeRows("sale_payments", rawTable("sale_payments").filter((p) => p.sales_id === saleId))
  for (const line of payments?.lines ?? []) {
    const amount = num(line.amount)
    if (amount <= 0) continue
    insertRow("sale_payments", {
      organization_id: org,
      sales_id: saleId,
      method: line.method || "cash",
      bank_name: String(line.bank ?? "").trim() || null,
      channel: String(line.channel ?? "").trim() || null,
      amount,
    })
  }
}

function paymentFields(p: any) {
  return {
    cash_received: num(p?.cash),
    card_received: num(p?.card),
    bkash_received: num(p?.bkash),
    nagad_received: num(p?.nagad),
    rocket_received: num(p?.rocket),
    upay_received: num(p?.upay),
    bank_transfer_received: num(p?.bank_transfer),
    payment_method: p?.method ?? null,
    card_bank: p?.card_bank ?? null,
    bank_transfer_bank: p?.bank_transfer_bank ?? null,
  }
}

// ------------------------------------------------------------------ handlers

const handlers: Record<string, (a: Args) => any> = {
  // 51-exchanges.sql
  get_product_by_barcode(a) {
    const code = String(a.p_barcode ?? "").trim()
    const inv = liveInventory(a.p_organization_id).find((i) => i.barcode === code)
    return productJson(inv, "Barcode not found in inventory.")
  },

  // 104-product-search-brand.sql
  get_product_by_name(a) {
    const needle = lc(a.p_name)
    if (!needle) return { success: false, message: "Enter a product name." }
    const hits = liveInventory(a.p_organization_id)
      .filter((i) => i.no_barcode && lc(i.product_name).includes(needle))
      .sort((x, y) =>
        Number(lc(y.product_name) === needle) - Number(lc(x.product_name) === needle) ||
        Number(y.quantity > 0) - Number(x.quantity > 0) ||
        num(y.quantity) - num(x.quantity))
    return productJson(
      hits[0],
      `No product without a barcode matches "${String(a.p_name).trim()}". A product with a barcode is scanned.`,
    )
  },

  // 104-product-search-brand.sql
  search_product_names(a) {
    const q = lc(a.p_query)
    const limit = Math.max(1, Math.min(num(a.p_limit) || 8, 100))
    return liveInventory(a.p_organization_id)
      .filter((i) => i.no_barcode &&
        (lc(i.product_name).includes(q) || lc(i.brand).includes(q) || lc(i.model_number).includes(q)))
      .sort((x, y) =>
        Number(y.quantity > 0) - Number(x.quantity > 0) ||
        String(x.product_name).localeCompare(String(y.product_name)) ||
        String(x.brand ?? "").localeCompare(String(y.brand ?? "")))
      .slice(0, limit)
      .map((i) => ({
        barcode: i.barcode, product_name: i.product_name, color: i.color,
        variant: i.variant, model_number: i.model_number, sale_price: i.sale_price,
        quantity: i.quantity, no_barcode: i.no_barcode, brand: i.brand, supplier: i.supplier,
      }))
  },

  // 34-pos-functions.sql
  upsert_customer(a) {
    const name = String(a.p_name ?? "").trim()
    if (!name) return { success: false, message: "Customer name is required." }
    const phone = String(a.p_phone ?? "").trim()
    const email = String(a.p_email ?? "").trim()
    let c = phone
      ? rawTable("customers").find((r) =>
          r.organization_id === a.p_organization_id && r.phone_number === phone && !r.deleted_at)
      : undefined
    if (c) {
      c.name = name
      if (email) c.email = email
    } else {
      c = insertRow("customers", {
        organization_id: a.p_organization_id, name,
        phone_number: phone || null, email: email || null, dues: 0,
      })
    }
    return {
      success: true,
      customer: { id: c.id, name: c.name, phone: c.phone_number, email: c.email, dues: num(c.dues) },
    }
  },

  // 34-pos-functions.sql
  start_sale(a) {
    const org = a.p_organization_id
    const sale = insertRow("sales", { organization_id: org, status: "in_progress", sale_date: nowIso() })
    sale.invoice_number = nextInvoice(org, sale.id)
    insertRow("sale_customers", {
      organization_id: org, sales_id: sale.id, customer_id: a.p_customer_id ?? null,
      customer_name: a.p_customer_name ?? null, customer_phone: a.p_customer_phone ?? null,
      customer_email: a.p_customer_email ?? null,
    })
    return { success: true, sale_id: sale.id, invoice_number: sale.invoice_number }
  },

  // 98-supplier-promos.sql (complete_sale_core) + 49-payment-routes.sql
  complete_sale(a) {
    const org = a.p_organization_id
    const items: any[] = a.p_items ?? []
    const totals = a.p_totals ?? {}
    const payments = a.p_payments ?? {}

    if (a.p_client_txn_id) {
      const dup = rawTable("sales").find((s) => s.organization_id === org && s.client_txn_id === a.p_client_txn_id)
      if (dup) return { success: true, sale_id: dup.id, invoice_number: dup.invoice_number, duplicate: true, message: "This sale was already recorded." }
    }
    if (items.length === 0) return { success: false, message: "A sale needs at least one item." }

    // Check every line has stock before touching anything, as the
    // real function's transaction would roll back.
    const need = new Map<string, number>()
    for (const it of items) {
      const qty = Math.trunc(num(it.quantity))
      if (qty <= 0) throw new Error(`Quantity must be at least 1 for "${it.name ?? "item"}"`)
      const code = String(it.barcode ?? "").trim()
      if (code) need.set(code, (need.get(code) ?? 0) + qty)
    }
    for (const [code, qty] of need) {
      const cv = variantForBarcode(org, code)
      if (!cv || num(cv.quantity) < qty) {
        const name = items.find((i) => String(i.barcode ?? "").trim() === code)?.name ?? "item"
        throw new Error(`Not enough stock for "${name}" (barcode ${code})`)
      }
    }

    let sale = a.p_existing_sale_id != null
      ? rawTable("sales").find((s) =>
          s.id === Number(a.p_existing_sale_id) && s.organization_id === org &&
          (s.status === "in_progress" || s.status === "held"))
      : undefined
    if (!sale) {
      sale = insertRow("sales", { organization_id: org, status: "completed" })
      sale.invoice_number = nextInvoice(org, sale.id)
    }

    Object.assign(sale, {
      client_txn_id: sale.client_txn_id ?? a.p_client_txn_id ?? null,
      sale_date: saleTimestamp(a.p_sale_date),
      status: "completed",
      held_cart: null,
      held_at: null,
      subtotal: num(totals.subtotal),
      total_discount: num(totals.discount),
      previous_dues: num(totals.previous_dues),
      net_amount: num(totals.net_amount),
      total_amount: num(totals.total),
      total_received: num(totals.received),
      due_amount: num(totals.due),
      change_amount: num(totals.change),
      updated_at: nowIso(),
      ...paymentFields(payments),
    })
    sale.credit_amount = saleCreditAmount(sale)

    const customerId = a.p_customer?.id ? Number(a.p_customer.id) : null
    removeRows("sale_customers", rawTable("sale_customers").filter((r) => r.sales_id === sale!.id))
    insertRow("sale_customers", {
      organization_id: org, sales_id: sale.id, customer_id: customerId,
      customer_name: a.p_customer?.name ?? null, customer_phone: a.p_customer?.phone ?? null,
      customer_email: a.p_customer?.email ?? null,
    })

    removeRows("sold_products", rawTable("sold_products").filter((r) => r.sales_id === sale!.id))
    const purchases = new Map(rawTable("purchases").map((p) => [p.id, p]))
    for (const it of items) {
      const qty = Math.trunc(num(it.quantity))
      const code = String(it.barcode ?? "").trim() || null
      let cost: number | null = null
      let brand: string | null = null
      let category: string | null = null
      let supplier: string | null = null
      if (code) {
        const cv = variantForBarcode(org, code)!
        cv.quantity = Math.max(0, num(cv.quantity) - qty)
        cv.updated_at = nowIso()
        const p = purchases.get(cv.purchase_id)
        cost = p?.cost_price ?? null
        brand = p?.brand ?? null
        category = p?.category ?? null
        supplier = p?.supplier ?? null
      }
      const price = num(it.price)
      const discount = num(it.discount)
      insertRow("sold_products", {
        organization_id: org, sales_id: sale.id, barcode: code,
        product_name: it.name || "Unknown Product", model_number: it.model ?? null,
        variant: it.variant ?? null, color: it.color ?? null,
        brand: brand ?? it.brand ?? null, category: category ?? it.category ?? null,
        supplier: supplier ?? it.supplier ?? null,
        quantity: qty, unit_price: price, discount_percentage: 0,
        discount_amount: discount, total_price: (price - discount) * qty, cost_price: cost,
        is_gift: !!it.gift, promo_id: it.promo_id ?? null, promo_amount: num(it.promo),
      })
    }

    if (customerId) {
      const c = rawTable("customers").find((r) => r.id === customerId && r.organization_id === org)
      if (c) c.dues = Math.max(0, num(totals.due))
    }
    recordSalePayments(org, sale.id, payments)
    return { success: true, sale_id: sale.id, invoice_number: sale.invoice_number, duplicate: false, sale_date: sale.sale_date }
  },

  // 53-per-purchase-dues.sql
  settle_sale_due(a) {
    const org = a.p_organization_id
    const amount = round2(num(a.p_amount))
    if (amount <= 0) return { success: false, message: "Enter an amount greater than zero." }
    const purchase = rawTable("sales").find((s) => s.id === Number(a.p_sales_id) && s.organization_id === org)
    if (!purchase) return { success: false, message: "That purchase is not from this shop." }
    const outstanding = round2(num(purchase.credit_amount) - num(purchase.due_settled))
    if (outstanding <= 0) return { success: false, message: `${purchase.invoice_number} is already paid in full.` }
    if (amount > outstanding) return { success: false, message: `That is more than the ${outstanding.toFixed(2)} outstanding on this purchase.` }
    const link = rawTable("sale_customers").find((r) => r.sales_id === purchase.id)
    const customer = link?.customer_id ? rawTable("customers").find((c) => c.id === link.customer_id) : undefined
    if (!customer) return { success: false, message: "That purchase has no customer on it, so there is no account to credit." }

    const balanceAfter = round2(Math.max(0, num(customer.dues) - amount))
    purchase.due_settled = round2(num(purchase.due_settled) + amount)
    customer.dues = balanceAfter

    const row = insertRow("sales", {
      organization_id: org, client_txn_id: a.p_client_txn_id ?? null, sale_date: nowIso(),
      status: "completed", subtotal: 0, total_discount: 0, net_amount: 0, total_amount: 0,
      previous_dues: outstanding, settled_sale_id: purchase.id, balance_after: balanceAfter,
      total_received: amount, due_amount: 0, change_amount: 0,
      ...paymentFields(a.p_payments),
    })
    row.invoice_number = nextInvoice(org, row.id)
    insertRow("sale_customers", {
      organization_id: org, sales_id: row.id, customer_id: customer.id,
      customer_name: customer.name, customer_phone: customer.phone_number, customer_email: customer.email,
    })
    recordSalePayments(org, row.id, a.p_payments)
    return {
      success: true, sale_id: row.id, invoice_number: row.invoice_number,
      purchase_remaining: round2(outstanding - amount), remaining: balanceAfter, duplicate: false,
    }
  },

  // 48-cashbook-opening-balance.sql
  cashbook_baseline(a) {
    return rawTable("cashbook_opening_balances")
      .filter((b) => b.organization_id === a.p_organization_id && b.effective_date <= a.p_date)
      .sort((x, y) => (x.effective_date < y.effective_date ? 1 : -1))
      .slice(0, 1)
      .map((b) => ({ effective_date: b.effective_date, amount: b.amount }))
  },

  // 61-linked-shop-names.sql
  list_linked_shops(a) {
    const me = a.p_organization_id
    const partners = new Set<string>()
    for (const l of rawTable("shop_links")) {
      if (l.organization_id === me) partners.add(l.partner_organization_id)
      if (l.partner_organization_id === me) partners.add(l.organization_id)
    }
    return rawTable("organizations")
      .filter((o) => partners.has(o.id) && o.id !== me)
      .map((o) => ({ id: o.id, name: o.name }))
  },

  // 97-advance-pays-the-next-delivery.sql
  save_purchase_voucher(a) {
    const org = a.p_organization_id
    const v = a.p_voucher ?? {}
    const lines: any[] = a.p_lines ?? []
    if (lines.length === 0) return { success: false, message: "The voucher has no items on it." }

    let totalQty = 0
    let net = 0
    for (const l of lines) {
      const q = Math.max(0, Math.trunc(num(l.quantity)))
      totalQty += q
      net += q * num(l.cost_price)
    }
    net = round2(net)
    const discount = round2(Math.max(0, num(v.discount)))
    const adjustment = round2(num(v.adjustment))
    const party = round2(net - discount + adjustment)
    if (party < 0) return { success: false, message: "The discount is more than the voucher comes to." }
    const paid = round2(Math.max(0, num(v.paid_amount)))
    if (paid > party) return { success: false, message: `Paid is more than the ${party.toFixed(2)} owed on this voucher.` }

    const allCodes = lines.flatMap((l) => (l.no_barcode ? [] : (l.barcodes ?? []).map(String)))
    const taken = new Set(rawTable("color_variants").filter((c) => c.organization_id === org).map((c) => c.barcode))
    if (allCodes.some((c) => taken.has(c)) || new Set(allCodes).size !== allCodes.length) {
      return { success: false, message: "Could not save: one of these units is already in stock. Check the barcodes and try again." }
    }

    const count = rawTable("purchase_vouchers").filter((p) => p.organization_id === org).length
    const voucherNo = `PV-${String(count + 1).padStart(5, "0")}`
    const voucher = insertRow("purchase_vouchers", {
      organization_id: org, client_txn_id: a.p_client_txn_id ?? null, voucher_no: voucherNo,
      voucher_date: v.voucher_date || new Date().toISOString().slice(0, 10),
      supplier_id: v.supplier_id || null, supplier: v.supplier || null,
      total_quantity: totalQty, net_amount: net, discount, adjustment,
      party_amount: party, paid_amount: paid, due_amount: round2(party - paid), due_settled: 0,
      remarks: v.remarks || null,
    })

    for (const l of lines) {
      const p = insertRow("purchases", {
        organization_id: org, voucher_id: voucher.id, supplier_id: v.supplier_id || null,
        supplier: v.supplier || null, product_name: l.product_name,
        model_number: l.model_number || null, category: l.category, brand: l.brand,
        cost_price: num(l.cost_price), sale_price: num(l.sale_price), description: v.remarks || null,
      })
      if (l.no_barcode) {
        insertRow("color_variants", {
          organization_id: org, purchase_id: p.id, barcode: null, imei: null,
          color: l.color, variant: l.variant || null,
          quantity: Math.max(1, Math.trunc(num(l.quantity)) || 1), no_barcode: true,
        })
      } else {
        for (const code of l.barcodes ?? []) {
          insertRow("color_variants", {
            organization_id: org, purchase_id: p.id, barcode: String(code), imei: String(code),
            color: l.color, variant: l.variant || null, quantity: 1, no_barcode: false,
          })
        }
      }
    }

    if (paid > 0) {
      insertRow("expenses", {
        organization_id: org, date: voucher.voucher_date, category: "party_payment",
        description: v.supplier || "Supplier", amount: paid, payment_method: "cash",
        supplier_id: v.supplier_id || null, notes: `Paid on ${voucherNo}`,
        paid_with_voucher_id: voucher.id,
      })
    }
    return {
      success: true, voucher_id: voucher.id, voucher_no: voucherNo, total_quantity: totalQty,
      net_amount: net, party_amount: party, paid_amount: paid, due_amount: round2(party - paid),
      due_before_advance: round2(party - paid), advance_applied: 0, duplicate: false,
    }
  },

  // 56-owner-edit-purchases.sql
  update_purchase(a) {
    const p = rawTable("purchases").find((r) => r.id === Number(a.p_purchase_id) && r.organization_id === a.p_organization_id)
    if (!p) return { success: false, message: "That purchase is not in this shop." }
    Object.assign(p, a.p_fields ?? {}, { updated_at: nowIso() })
    return { success: true, message: "Purchase updated." }
  },

  delete_purchase(a) {
    const p = rawTable("purchases").find((r) => r.id === Number(a.p_purchase_id) && r.organization_id === a.p_organization_id)
    if (!p) return { success: false, message: "That purchase is not in this shop." }
    const stock = rawTable("color_variants").filter((c) => c.purchase_id === p.id).length
    removeRows("purchases", [p])
    return { success: true, stock_removed: stock, message: "Purchase deleted." }
  },

  // 103-delete-transfer-both-shops.sql, without the cross-shop part
  delete_sale(a) {
    const org = a.p_organization_id
    const s = rawTable("sales").find((r) => r.id === Number(a.p_sale_id) && r.organization_id === org)
    if (!s) return { success: false, message: "That sale is not in this shop." }
    // Stock goes back on the shelf.
    for (const sp of rawTable("sold_products").filter((r) => r.sales_id === s.id)) {
      if (!sp.barcode) continue
      const cv = variantForBarcode(org, sp.barcode)
      if (cv) cv.quantity = num(cv.quantity) + num(sp.quantity)
    }
    const link = rawTable("sale_customers").find((r) => r.sales_id === s.id)
    const customer = link?.customer_id ? rawTable("customers").find((c) => c.id === link.customer_id) : undefined
    if (customer) {
      const owed = num(s.credit_amount) - num(s.due_settled)
      customer.dues = Math.max(0, round2(num(customer.dues) - owed))
    }
    removeRows("sales", [s])
    return { success: true, message: `${s.invoice_number} removed and its stock returned.` }
  },

  // 85-linked-product-options.sql
  product_option_matches(a) {
    const want = (v: any) => String(v ?? "").trim()
    const purchases = rawTable("purchases").filter((p) =>
      p.organization_id === a.p_org && !p.deleted_at &&
      (!want(a.p_category) || lc(p.category) === lc(a.p_category)) &&
      (!want(a.p_brand) || lc(p.brand) === lc(a.p_brand)) &&
      (!want(a.p_product_name) || lc(p.product_name) === lc(a.p_product_name)) &&
      (!want(a.p_model_number) || lc(p.model_number) === lc(a.p_model_number)))
    let values: any[]
    if (a.p_kind === "variant") {
      const ids = new Set(purchases.map((p) => p.id))
      values = rawTable("color_variants").filter((c) => ids.has(c.purchase_id) && !c.deleted_at).map((c) => c.variant)
    } else {
      values = purchases.map((p) => p[a.p_kind])
    }
    const distinct = [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))].sort()
    return distinct.map((option_value) => ({ option_value }))
  },

  // 81-shop-option-management.sql
  shop_option_usage(a) {
    const column = a.p_kind
    return rawTable("purchases").filter((p) =>
      p.organization_id === a.p_organization_id && lc(p[column]) === lc(a.p_value)).length
  },

  rename_shop_option(a) {
    const org = a.p_organization_id
    for (const o of rawTable("product_options")) {
      if (o.organization_id === org && o.kind === a.p_kind && o.value === a.p_old) o.value = a.p_new
    }
    for (const p of rawTable("purchases")) {
      if (p.organization_id === org && p[a.p_kind] === a.p_old) p[a.p_kind] = a.p_new
    }
    return { success: true, message: `Renamed to "${a.p_new}".` }
  },

  delete_shop_option(a) {
    removeRows("product_options", rawTable("product_options").filter((o) =>
      o.organization_id === a.p_organization_id && o.kind === a.p_kind && o.value === a.p_value))
    return { success: true, message: `"${a.p_value}" removed from the list.` }
  },

  rename_supplier(a) {
    const s = rawTable("suppliers").find((r) => r.id === a.p_supplier_id && r.organization_id === a.p_organization_id)
    if (!s) return { success: false, message: "Supplier not found." }
    const name = String(a.p_new_name ?? "").trim()
    for (const p of rawTable("purchases")) if (p.supplier_id === s.id) p.supplier = name
    s.name = name
    return { success: true, message: `Now called "${name}".` }
  },

  delete_supplier(a) {
    const s = rawTable("suppliers").find((r) => r.id === a.p_supplier_id && r.organization_id === a.p_organization_id)
    if (!s) return { success: false, message: "Supplier not found." }
    if (rawTable("purchases").some((p) => p.supplier_id === s.id && !p.deleted_at)) {
      return { success: false, message: `${s.name} has purchases on record, so it stays on the list.` }
    }
    s.deleted_at = nowIso()
    return { success: true, message: `${s.name} removed.` }
  },

  // 95-manager-three-day-window.sql, simplified: oldest voucher first.
  settle_supplier_dues(a) {
    const org = a.p_organization_id
    let left = round2(num(a.p_amount))
    if (left <= 0) return { success: false, message: "Enter an amount greater than zero." }
    const pay = a.p_payment ?? {}
    const supplier = rawTable("suppliers").find((s) => s.id === a.p_supplier_id)
    const expense = insertRow("expenses", {
      organization_id: org, date: pay.date, category: "party_payment",
      description: pay.description || supplier?.name || "Supplier payment", amount: left,
      payment_method: pay.payment_method || "cash", bank_name: pay.bank_name ?? null,
      payment_channel: pay.payment_channel ?? null, notes: pay.notes ?? null,
      supplier_id: a.p_supplier_id,
    })
    const vouchers = rawTable("purchase_vouchers")
      .filter((v) => v.organization_id === org && v.supplier_id === a.p_supplier_id && !v.deleted_at &&
        num(v.due_amount) - num(v.due_settled) > 0)
      .sort((x, y) => (x.voucher_date < y.voucher_date ? -1 : 1))
    for (const v of vouchers) {
      if (left <= 0) break
      const take = round2(Math.min(left, num(v.due_amount) - num(v.due_settled)))
      v.due_settled = round2(num(v.due_settled) + take)
      insertRow("purchase_voucher_payments", { organization_id: org, expense_id: expense.id, voucher_id: v.id, amount: take })
      left = round2(left - take)
    }
    return { success: true, expense_id: expense.id, advance: left, message: "Payment recorded." }
  },

  // 99-supplier-promo-claims.sql, simplified: records the receipt.
  settle_supplier_promo(a) {
    const pay = a.p_payment ?? {}
    const income = insertRow("income_owner", {
      organization_id: a.p_organization_id, date: pay.date, income_type: "party_income",
      amount: round2(num(a.p_amount)), destination_type: pay.destination_type || "cash",
      description: pay.description ?? null, notes: pay.notes ?? null, supplier_id: a.p_supplier_id,
    })
    return { success: true, income_id: income.id, message: "Promo receipt recorded." }
  },

  process_exchange: () => declined("Exchanges"),
  process_purchase_return: () => declined("Returning stock to a supplier"),
  edit_sale: () => declined("Editing a finished sale"),
  transfer_stock_to_shop: () => declined("Transferring stock between shops"),
  settle_shop_transfer: () => declined("Settling a shop transfer"),
  create_organization: () => declined("Adding another shop"),
}

export function runRpc(name: string, args: Args = {}): Result {
  const handler = handlers[name]
  if (!handler) return declined(`"${name}"`)
  const data = handler(args)
  // Already a Result (the declined ones).
  if (data && typeof data === "object" && "error" in data && "status" in data) return data
  persist()
  return ok(data)
}

export { newUuid }
