/**
 * The sample shop every demo visitor starts with.
 *
 * Everything here is made up: the shop, the people, the phone numbers
 * and the IMEIs. Dates are worked out from today, so the dashboard
 * always shows "this week" and today's till has sales on it.
 *
 * The numbers are random but seeded, so every visitor sees the same
 * shop, and they add up: stock only leaves after it arrived, sold
 * handsets are gone from inventory, and customer dues equal what their
 * sales left unpaid.
 */
type Row = Record<string, any>

export const DEMO_ORG_ID = "00000000-0000-4000-8000-00000000d001"
export const DEMO_USER_ID = "00000000-0000-4000-8000-00000000a001"
export const DEMO_EMAIL = "demo@mobilepos.app"
export const DEMO_NAME = "Demo Owner"

const ORG = DEMO_ORG_ID
const DAYS = 24

// ---------------------------------------------------------------- helpers

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number) => String(n).padStart(2, "0")
const dayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function daysAgo(n: number, hour = 12, minute = 0) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d
}

let uuidCounter = 0
function seededUuid(prefix: string) {
  uuidCounter++
  return `00000000-0000-4000-8000-${prefix}${String(uuidCounter).padStart(12 - prefix.length, "0")}`
}

// ---------------------------------------------------------------- catalogue

interface Product {
  name: string
  brand: string
  model: string
  category: "Phone" | "Accessories"
  variant: string | null
  colors: string[]
  cost: number
  price: number
  supplier: number // index into SUPPLIERS
  noBarcode?: boolean
}

const SUPPLIERS = [
  { name: "Galaxy Telecom", contact: "Rafiq Hasan", phone: "01711-000101", address: "Bashundhara City, Dhaka" },
  { name: "Smart Tech Distribution", contact: "Nusrat Jahan", phone: "01811-000202", address: "Motijheel, Dhaka" },
  { name: "Mobile Hub Wholesale", contact: "Kamal Uddin", phone: "01911-000303", address: "Elephant Road, Dhaka" },
  { name: "Power Accessories BD", contact: "Sabbir Ahmed", phone: "01611-000404", address: "Gulistan, Dhaka" },
]

const PRODUCTS: Product[] = [
  { name: "Galaxy A15", brand: "Samsung", model: "SM-A155F", category: "Phone", variant: "6/128", colors: ["Black", "Light Blue"], cost: 17500, price: 19999, supplier: 0 },
  { name: "Galaxy A25 5G", brand: "Samsung", model: "SM-A256E", category: "Phone", variant: "8/128", colors: ["Blue Black", "Yellow"], cost: 26500, price: 29999, supplier: 0 },
  { name: "Redmi 13C", brand: "Xiaomi", model: "23100RN82L", category: "Phone", variant: "4/128", colors: ["Midnight Black", "Navy Blue"], cost: 13200, price: 14999, supplier: 1 },
  { name: "Redmi Note 13", brand: "Xiaomi", model: "23129RAA4G", category: "Phone", variant: "8/256", colors: ["Ice Blue", "Midnight Black"], cost: 24800, price: 27499, supplier: 1 },
  { name: "C55", brand: "Realme", model: "RMX3710", category: "Phone", variant: "6/128", colors: ["Sunshower", "Rainy Night"], cost: 17200, price: 18999, supplier: 2 },
  { name: "Y18", brand: "Vivo", model: "V2333", category: "Phone", variant: "4/128", colors: ["Space Black", "Gem Green"], cost: 14300, price: 15999, supplier: 2 },
  { name: "A18", brand: "Oppo", model: "CPH2591", category: "Phone", variant: "4/64", colors: ["Glowing Blue", "Glowing Black"], cost: 12400, price: 13999, supplier: 2 },
  { name: "Hot 40i", brand: "Infinix", model: "X6528B", category: "Phone", variant: "8/128", colors: ["Starlit Black", "Palm Blue"], cost: 12900, price: 14499, supplier: 1 },
  { name: "Spark 20", brand: "Tecno", model: "KJ5", category: "Phone", variant: "8/256", colors: ["Gravity Black", "Cyber White"], cost: 15100, price: 16999, supplier: 1 },
  { name: "iPhone 13", brand: "Apple", model: "A2633", category: "Phone", variant: "128GB", colors: ["Midnight", "Starlight"], cost: 76000, price: 82999, supplier: 0 },
  { name: "105 (2023)", brand: "Nokia", model: "TA-1557", category: "Phone", variant: null, colors: ["Charcoal"], cost: 1650, price: 1990, supplier: 2 },
  { name: "25W Fast Charger", brand: "Samsung", model: "EP-TA800", category: "Accessories", variant: null, colors: ["White"], cost: 950, price: 1450, supplier: 3, noBarcode: true },
  { name: "USB-C Cable 1m", brand: "Baseus", model: "CATKLF", category: "Accessories", variant: null, colors: ["Black"], cost: 220, price: 450, supplier: 3, noBarcode: true },
  { name: "Tempered Glass", brand: "Remax", model: "GL-27", category: "Accessories", variant: null, colors: ["Clear"], cost: 60, price: 250, supplier: 3, noBarcode: true },
  { name: "Silicone Back Cover", brand: "Generic", model: null as unknown as string, category: "Accessories", variant: null, colors: ["Black", "Clear"], cost: 80, price: 300, supplier: 3, noBarcode: true },
  { name: "Wireless Earbuds T13", brand: "QCY", model: "T13", category: "Accessories", variant: null, colors: ["Black"], cost: 1350, price: 1990, supplier: 3, noBarcode: true },
  { name: "Power Bank 10000mAh", brand: "Xiaomi", model: "PB100DZM", category: "Accessories", variant: null, colors: ["Black"], cost: 1450, price: 1990, supplier: 1, noBarcode: true },
  { name: "Memory Card 64GB", brand: "SanDisk", model: "Ultra microSDXC", category: "Accessories", variant: null, colors: ["Red"], cost: 480, price: 750, supplier: 3, noBarcode: true },
]

const CUSTOMERS = [
  ["Rahim Uddin", "01712-345601"], ["Fatema Begum", "01812-345602"], ["Tanvir Ahmed", "01912-345603"],
  ["Nasrin Akter", "01612-345604"], ["Shakil Hossain", "01512-345605"], ["Mitu Rahman", "01713-345606"],
  ["Arif Chowdhury", "01813-345607"], ["Sumaiya Islam", "01913-345608"], ["Jahid Hasan", "01613-345609"],
  ["Rumana Khatun", "01714-345610"], ["Imran Kabir", "01814-345611"], ["Farhana Yasmin", "01914-345612"],
  ["Sohel Rana", "01614-345613"], ["Tasnim Ferdous", "01715-345614"],
]

// Deliveries: [days ago, [product index, units or quantity]...]
// Phones: about 120 handsets in, roughly half sold over the period.
const DELIVERIES: [number, [number, number][]][] = [
  [DAYS, [[0, 8], [1, 4], [2, 8], [3, 5], [9, 3]]],
  [DAYS - 1, [[4, 6], [5, 6], [6, 6], [10, 8]]],
  [DAYS - 1, [[11, 30], [12, 60], [13, 80], [14, 60], [15, 15], [17, 25]]],
  [DAYS - 2, [[7, 6], [8, 5], [16, 12]]],
  [16, [[0, 5], [2, 5], [4, 4], [6, 4]]],
  [12, [[1, 3], [5, 4], [10, 6], [9, 2]]],
  [8, [[0, 5], [2, 5], [3, 4], [7, 4]]],
  [6, [[12, 40], [13, 50], [11, 15], [15, 10]]],
  [3, [[3, 3], [6, 4], [8, 4], [5, 4]]],
]

// ---------------------------------------------------------------- build

export function buildSeed(): Record<string, Row[]> {
  uuidCounter = 0
  const r = rng(20261005)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const t: Record<string, Row[]> = {}
  const table = (name: string) => (t[name] ??= [])
  const ids: Record<string, number> = {}
  const add = (name: string, row: Row) => {
    const iso = new Date().toISOString()
    const full: Row = { created_at: iso, updated_at: iso, deleted_at: null, ...row }
    if (full.id === undefined) full.id = (ids[name] = (ids[name] ?? 0) + 1)
    table(name).push(full)
    return full
  }

  // ---- the shop and its owner
  const openedOn = daysAgo(DAYS + 1, 9)
  add("organizations", {
    id: ORG, name: "Demo Mobile Shop", address: "Shop 14, Level 3, Demo Tower, Dhaka",
    phone: "01700-000000", phone_secondary: "01800-000000", email: "hello@demo-mobile.shop",
    tax_id: null, is_active: true, bank_names: {}, receipt_watermark: "DEMO",
    receipt_footer_bn: "ধন্যবাদ, আবার আসবেন", receipt_footer_en: "Thank you for shopping with us!",
    created_at: openedOn.toISOString(),
  })
  add("users", {
    id: DEMO_USER_ID, full_name: DEMO_NAME, email: DEMO_EMAIL, phone: null, role: "owner", is_active: true,
  })
  add("user_organizations", { id: seededUuid("b"), user_id: DEMO_USER_ID, organization_id: ORG, role: "owner" })
  const end = new Date()
  end.setFullYear(end.getFullYear() + 1)
  add("subscriptions", {
    id: seededUuid("c"), organization_id: ORG, plan: "pro", status: "active",
    start_date: openedOn.toISOString(), end_date: end.toISOString(),
  })

  // ---- lists the forms offer
  for (const v of ["Phone", "Accessories"]) add("product_options", { organization_id: ORG, kind: "category", value: v })
  for (const v of [...new Set(PRODUCTS.map((p) => p.brand))]) add("product_options", { organization_id: ORG, kind: "brand", value: v })
  for (const v of ["Cash", "Adjust with dues"]) add("product_options", { organization_id: ORG, kind: "credit_method", value: v })
  add("payment_methods", { organization_id: ORG, scope: "mobile", bank_name: null, name: "bKash" })
  add("payment_methods", { organization_id: ORG, scope: "mobile", bank_name: null, name: "Nagad" })
  add("payment_methods", { organization_id: ORG, scope: "bank", bank_name: "BRAC Bank", name: "Card" })
  add("payment_methods", { organization_id: ORG, scope: "bank", bank_name: "City Bank", name: "Transfer" })

  // ---- suppliers
  const suppliers = SUPPLIERS.map((s) => add("suppliers", {
    id: seededUuid("d"), organization_id: ORG, name: s.name, contact_person: s.contact,
    phone: s.phone, email: null, address: s.address, owner: DEMO_USER_ID,
    created_at: openedOn.toISOString(),
  }))

  // ---- customers
  const customers = CUSTOMERS.map(([name, phone]) => add("customers", {
    organization_id: ORG, name, phone_number: phone, email: null, address: "Dhaka", dues: 0,
    created_at: openedOn.toISOString(),
  }))

  // ---- opening cash and capital
  add("cashbook_opening_balances", {
    organization_id: ORG, effective_date: dayStr(daysAgo(DAYS + 1)), amount: 25000,
    note: "Cash in the drawer when the shop opened", created_by: DEMO_USER_ID,
  })
  // Sized at the end, once every taka that leaves the drawer is known,
  // so the cash book never goes below zero.
  const capital = add("income_owner", {
    id: seededUuid("e"), organization_id: ORG, date: dayStr(daysAgo(DAYS)), income_type: "owner_income",
    amount: 0, destination_type: "cash", description: "Owner investment", notes: null,
    supplier_id: null, income_subtype: "As stock", created_at: daysAgo(DAYS, 9, 30).toISOString(),
  })

  // ---- deliveries: one voucher per supplier per delivery day
  interface Unit { cv: Row; purchase: Row; product: Product; arrived: number }
  const stock: Unit[] = []
  let imeiSerial = 0
  const imei = () => `35${String(8829104 + int(0, 99999)).padStart(7, "0")}${String(++imeiSerial).padStart(6, "0")}`
  const vouchers: Row[] = []

  for (const [ago, lines] of DELIVERIES) {
    const bySupplier = new Map<number, [number, number][]>()
    for (const line of lines) {
      const s = PRODUCTS[line[0]].supplier
      bySupplier.set(s, [...(bySupplier.get(s) ?? []), line])
    }
    for (const [sIdx, sLines] of bySupplier) {
      const supplier = suppliers[sIdx]
      const when = daysAgo(ago, 10, int(0, 50))
      let qty = 0
      let net = 0
      for (const [pIdx, n] of sLines) {
        qty += n
        net += n * PRODUCTS[pIdx].cost
      }
      // The shop pays most of each delivery at the door; the rest is owed.
      const paid = Math.round((net * (0.6 + r() * 0.3)) / 1000) * 1000
      const voucher = add("purchase_vouchers", {
        organization_id: ORG, voucher_no: `PV-${String(vouchers.length + 1).padStart(5, "0")}`,
        voucher_date: dayStr(when), supplier_id: supplier.id, supplier: supplier.name,
        total_quantity: qty, net_amount: net, discount: 0, adjustment: 0, party_amount: net,
        paid_amount: paid, due_amount: net - paid, due_settled: 0, remarks: null,
        created_at: when.toISOString(),
      })
      vouchers.push(voucher)
      add("expenses", {
        id: seededUuid("f"), organization_id: ORG, date: voucher.voucher_date, category: "party_payment",
        custom_category: null, description: supplier.name, amount: paid, payment_method: "cash",
        reference: `EXP-${1000 + table("expenses").length + 1}`, notes: `Paid on ${voucher.voucher_no}`,
        user_id: DEMO_USER_ID, supplier_id: supplier.id, paid_with_voucher_id: voucher.id,
        created_at: when.toISOString(),
      })

      for (const [pIdx, n] of sLines) {
        const p = PRODUCTS[pIdx]
        const purchase = add("purchases", {
          organization_id: ORG, voucher_id: voucher.id, supplier_id: supplier.id, supplier: supplier.name,
          product_name: p.name, model_number: p.model ?? null, category: p.category, brand: p.brand,
          cost_price: p.cost, sale_price: p.price, description: null, created_at: when.toISOString(),
        })
        if (p.noBarcode) {
          // Counted stock: one line per colour.
          const per = Math.floor(n / p.colors.length)
          p.colors.forEach((color, i) => {
            const cv = add("color_variants", {
              organization_id: ORG, purchase_id: purchase.id, color, barcode: null, imei: null,
              variant: p.variant, quantity: i === 0 ? n - per * (p.colors.length - 1) : per,
              no_barcode: true, defective: false, created_at: when.toISOString(),
            })
            stock.push({ cv, purchase, product: p, arrived: ago })
          })
        } else {
          for (let u = 0; u < n; u++) {
            const code = imei()
            const cv = add("color_variants", {
              organization_id: ORG, purchase_id: purchase.id, color: p.colors[u % p.colors.length],
              barcode: code, imei: code, variant: p.variant, quantity: 1,
              no_barcode: false, defective: false, created_at: when.toISOString(),
            })
            stock.push({ cv, purchase, product: p, arrived: ago })
          }
        }
      }
    }
  }

  const barcodeOf = (u: Unit) => (u.cv.no_barcode ? `NB-${u.cv.id}` : u.cv.barcode)

  // ---- sales
  const now = new Date()
  let invoiceSeq = 0
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    const isToday = ago === 0
    const weekend = daysAgo(ago).getDay() === 5 // Friday is the busy day
    // The shop opens at 10. Before then there is nothing to show for
    // today, and afterwards today's sales sit between 10 and a minute
    // ago, so none is in the future.
    const opening = daysAgo(0, 10)
    const openFor = now.getTime() - 60000 - opening.getTime()
    const count = isToday ? (openFor > 0 ? Math.min(6, 1 + Math.floor(openFor / 3600000)) : 0) : int(3, 6) + (weekend ? 3 : 0)
    for (let k = 0; k < count; k++) {
      let when = daysAgo(ago, 11 + Math.floor((k * 10) / count), int(0, 59))
      if (isToday) when = new Date(opening.getTime() + (openFor * (k + 0.5)) / count)

      // What goes in the basket.
      const basket: { unit: Unit; qty: number; discount: number }[] = []
      const phones = stock.filter((u) => !u.cv.no_barcode && u.cv.quantity > 0 && u.arrived >= ago)
      if (r() < 0.45 && phones.length) {
        // Cheaper handsets sell more often.
        const sorted = [...phones].sort((a, b) => a.product.price - b.product.price)
        const unit = sorted[Math.floor(Math.pow(r(), 1.6) * sorted.length)]
        const discount = r() < 0.4 ? pick([200, 300, 500]) : 0
        basket.push({ unit, qty: 1, discount })
      }
      const extras = basket.length ? int(0, 2) : int(1, 3)
      for (let e = 0; e < extras; e++) {
        const acc = stock.filter((u) => u.cv.no_barcode && u.cv.quantity > 2 && u.arrived >= ago && !basket.some((b) => b.unit === u))
        if (!acc.length) break
        const unit = pick(acc)
        basket.push({ unit, qty: unit.product.price < 500 && r() < 0.4 ? 2 : 1, discount: 0 })
      }
      if (!basket.length) continue

      const subtotal = basket.reduce((s, b) => s + b.unit.product.price * b.qty, 0)
      const discount = basket.reduce((s, b) => s + b.discount * b.qty, 0)
      const net = subtotal - discount

      // Who is buying, and how they pay.
      const regular = r() < 0.5
      const customer = regular ? pick(customers) : null
      const roll = r()
      let lines: { method: string; channel: string | null; bank: string | null; amount: number }[]
      let received = net
      if (customer && net > 5000 && roll < 0.12) {
        // Pays part now, the rest later.
        received = Math.round((net * 0.6) / 500) * 500
        lines = [{ method: "cash", channel: null, bank: null, amount: received }]
      } else if (roll < 0.55) {
        lines = [{ method: "cash", channel: null, bank: null, amount: net }]
      } else if (roll < 0.75) {
        lines = [{ method: "mobile_banking", channel: "bKash", bank: null, amount: net }]
      } else if (roll < 0.83) {
        lines = [{ method: "mobile_banking", channel: "Nagad", bank: null, amount: net }]
      } else if (roll < 0.92) {
        lines = [{ method: "bank_transfer", channel: "Card", bank: "BRAC Bank", amount: net }]
      } else {
        const cash = Math.round(net / 2 / 100) * 100
        lines = [
          { method: "cash", channel: null, bank: null, amount: cash },
          { method: "mobile_banking", channel: "bKash", bank: null, amount: net - cash },
        ]
      }
      const due = net - received
      const sum = (pred: (l: (typeof lines)[number]) => boolean) =>
        lines.filter(pred).reduce((s, l) => s + l.amount, 0)

      const sale = add("sales", {
        organization_id: ORG, sale_date: when.toISOString(), invoice_number: `INV-${String(++invoiceSeq).padStart(6, "0")}`,
        status: "completed", subtotal, total_discount: discount, previous_dues: 0, net_amount: net,
        total_amount: net, total_received: received, due_amount: due, change_amount: 0,
        cash_received: sum((l) => l.method === "cash"),
        card_received: sum((l) => l.channel === "Card"),
        bkash_received: sum((l) => l.channel === "bKash"),
        nagad_received: sum((l) => l.channel === "Nagad"),
        rocket_received: 0, upay_received: 0, mobile_banking_received: 0,
        bank_transfer_received: 0,
        payment_method: lines.length > 1 ? "split" : lines[0].channel || lines[0].method,
        card_bank: lines.find((l) => l.channel === "Card")?.bank ?? null,
        bank_transfer_bank: null, held_cart: null, held_at: null,
        credit_amount: due, due_settled: 0, settled_sale_id: null, balance_after: null,
        transfer_to_org_id: null, client_txn_id: null,
        created_at: when.toISOString(), updated_at: when.toISOString(),
      })
      add("sale_customers", {
        organization_id: ORG, sales_id: sale.id, customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? "Walk-in customer", customer_phone: customer?.phone_number ?? null,
        customer_email: null, created_at: when.toISOString(),
      })
      for (const l of lines) {
        add("sale_payments", {
          organization_id: ORG, sales_id: sale.id, method: l.method, bank_name: l.bank,
          channel: l.channel, amount: l.amount, created_at: when.toISOString(),
        })
      }
      for (const b of basket) {
        const p = b.unit.product
        b.unit.cv.quantity -= b.qty
        add("sold_products", {
          organization_id: ORG, sales_id: sale.id, barcode: barcodeOf(b.unit), product_name: p.name,
          model_number: p.model ?? null, variant: p.variant, color: b.unit.cv.color, brand: p.brand,
          category: p.category, supplier: b.unit.purchase.supplier, quantity: b.qty, unit_price: p.price,
          discount_percentage: 0, discount_amount: b.discount, total_price: (p.price - b.discount) * b.qty,
          cost_price: p.cost, is_gift: false, promo_id: null, promo_amount: 0,
          created_at: when.toISOString(),
        })
      }
      if (customer && due > 0) customer.dues += due
    }
  }

  // ---- a customer paying off part of what they owe
  const owing = table("sales").find((s) => s.credit_amount > 0 && s.sale_date < daysAgo(4).toISOString())
  if (owing) {
    const link = table("sale_customers").find((c) => c.sales_id === owing.id)!
    const customer = customers.find((c) => c.id === link.customer_id)!
    const amount = Math.min(owing.credit_amount, 2000)
    const when = daysAgo(2, 17, 15)
    owing.due_settled = amount
    customer.dues -= amount
    const pay = add("sales", {
      organization_id: ORG, sale_date: when.toISOString(), invoice_number: `INV-${String(++invoiceSeq).padStart(6, "0")}`,
      status: "completed", subtotal: 0, total_discount: 0, net_amount: 0, total_amount: 0,
      previous_dues: owing.credit_amount, settled_sale_id: owing.id, balance_after: customer.dues,
      cash_received: amount, card_received: 0, bkash_received: 0, nagad_received: 0, rocket_received: 0,
      upay_received: 0, mobile_banking_received: 0, bank_transfer_received: 0, total_received: amount,
      due_amount: 0, change_amount: 0, payment_method: "cash", credit_amount: 0, due_settled: 0,
      created_at: when.toISOString(),
    })
    add("sale_customers", {
      organization_id: ORG, sales_id: pay.id, customer_id: customer.id, customer_name: customer.name,
      customer_phone: customer.phone_number, customer_email: null,
    })
    add("sale_payments", { organization_id: ORG, sales_id: pay.id, method: "cash", channel: null, bank_name: null, amount })
  }

  // ---- a returned accessory
  const accSale = table("sold_products").find((sp) => sp.category === "Accessories" && sp.quantity === 1 &&
    table("sales").find((s) => s.id === sp.sales_id)!.sale_date < daysAgo(5).toISOString())
  if (accSale) {
    const when = daysAgo(4, 15, 40)
    const cust = table("sale_customers").find((c) => c.sales_id === accSale.sales_id)
    const ret = add("sales_returns", {
      organization_id: ORG, return_date: when.toISOString(), original_sale_id: accSale.sales_id,
      customer_id: cust?.customer_id ?? null, customer_name: cust?.customer_name ?? "Walk-in customer",
      customer_phone: cust?.customer_phone ?? null, return_reason: "Not working",
      total_refund_amount: accSale.total_price, refund_method: "cash", status: "processed",
      notes: "Swapped faulty unit back to supplier", return_kind: "refund", price_difference: 0,
      exchange_barcode: null, created_at: when.toISOString(),
    })
    add("sales_return_items", {
      organization_id: ORG, return_id: ret.id, original_sold_product_id: accSale.id, barcode: accSale.barcode,
      product_name: accSale.product_name, model_number: accSale.model_number, color: accSale.color,
      quantity: 1, unit_price: accSale.unit_price, total_refund_amount: accSale.total_price,
      condition: "good", restock: true, created_at: when.toISOString(),
    })
    const unit = stock.find((u) => barcodeOf(u) === accSale.barcode)
    if (unit) unit.cv.quantity += 1
  }

  // ---- running costs
  const expense = (ago: number, category: string, description: string, amount: number, extra: Row = {}) =>
    add("expenses", {
      id: seededUuid("f"), organization_id: ORG, date: dayStr(daysAgo(ago)), category,
      custom_category: null, description, amount, payment_method: "cash",
      reference: `EXP-${1000 + table("expenses").length + 1}`, notes: null, user_id: DEMO_USER_ID,
      supplier_id: null, created_at: daysAgo(ago, 18, int(0, 59)).toISOString(), ...extra,
    })
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    if (r() < 0.7) expense(ago, "entertainment", "Tea and snacks", pick([120, 150, 180, 200]))
    if (ago % 4 === 1) expense(ago, "shopping_bag", "Shopping bags", pick([250, 300, 350]))
  }
  expense(20, "land_bill", "Shop rent", 35000, { payment_method: "bank_transfer", bank_name: "City Bank" })
  expense(19, "internet_bill", "Broadband - monthly", 1500)
  expense(19, "mobile_bill", "Shop phone recharge", 500, { payment_method: "mobile_banking", payment_channel: "bKash" })
  expense(15, "printer_papers", "Receipt paper rolls", 450)
  expense(10, "office_supplies", "Price tags and markers", 380)
  expense(DAYS - 3, "salaries", "Sales staff salary", 24000)

  // ---- paying a supplier for an earlier delivery
  const firstDue = vouchers.find((v) => v.due_amount > 0)
  if (firstDue) {
    const amount = Math.min(firstDue.due_amount, 20000)
    const e = expense(8, "party_payment", firstDue.supplier, amount, {
      supplier_id: firstDue.supplier_id, payment_method: "bank_transfer", bank_name: "City Bank",
      notes: `Towards ${firstDue.voucher_no}`,
    })
    firstDue.due_settled = amount
    add("purchase_voucher_payments", { organization_id: ORG, expense_id: e.id, voucher_id: firstDue.id, amount })
  }

  // ---- a supplier incentive received
  add("income_owner", {
    id: seededUuid("e"), organization_id: ORG, date: dayStr(daysAgo(9)), income_type: "party_income",
    amount: 3000, destination_type: "cash", description: "Sales target incentive", notes: null,
    supplier_id: suppliers[0].id, income_subtype: "Incentive", created_at: daysAgo(9, 16).toISOString(),
  })

  // Customers' dues as whole taka.
  for (const c of customers) c.dues = Math.max(0, Math.round(c.dues))

  // Enough capital that the drawer covers every cash payment out, with
  // a working float left over: rounded up to the next lakh.
  const cashOut = table("expenses")
    .filter((e) => e.payment_method === "cash")
    .reduce((s, e) => s + e.amount, 0)
  capital.amount = Math.ceil((cashOut + 150000) / 100000) * 100000

  return t
}
