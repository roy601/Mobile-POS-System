/**
 * The demo's database: plain arrays of rows, kept in this browser.
 *
 * Every visitor starts from the same sample shop (demo/seed.ts) and
 * whatever they change is saved to their own localStorage, so a sale
 * made in the demo shows up in Inventory and the Ledger afterwards.
 * Nothing ever leaves the browser. "Reset demo" puts the sample back.
 */
import { buildSeed } from "./seed"

export type Row = Record<string, any>
export type Tables = Record<string, Row[]>

interface State {
  version: number
  /** The day the sample was made. A new day starts a fresh sample, so
   *  "today" on the dashboard is always today. */
  seededOn: string
  tables: Tables
  seq: Record<string, number>
}

function today() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const STORAGE_KEY = "mpos-demo-db"
// Bump when the seed's shape changes, so old saved demos are replaced.
const VERSION = 1

/** Tables whose primary key is a uuid rather than a counter. */
const UUID_TABLES = new Set([
  "organizations", "users", "user_organizations", "subscriptions", "suppliers",
  "expenses", "income_owner", "cashbook_adjustments", "shop_links",
])

/** Tables with no `id` column at all. */
const KEYLESS_TABLES = new Set(["shop_labels"])

/**
 * Foreign keys, as the SQL scripts declare them. An embed such as
 * `sales(...)` inside `sold_products` follows one of these: towards the
 * referenced table it is a single object, away from it a list.
 */
export const RELATIONS: { table: string; column: string; ref: string }[] = [
  { table: "color_variants", column: "purchase_id", ref: "purchases" },
  { table: "purchases", column: "supplier_id", ref: "suppliers" },
  { table: "purchases", column: "voucher_id", ref: "purchase_vouchers" },
  { table: "income_owner", column: "supplier_id", ref: "suppliers" },
  { table: "expenses", column: "supplier_id", ref: "suppliers" },
  { table: "sold_products", column: "sales_id", ref: "sales" },
  { table: "sale_customers", column: "sales_id", ref: "sales" },
  { table: "sale_customers", column: "customer_id", ref: "customers" },
  { table: "sale_payments", column: "sales_id", ref: "sales" },
  { table: "sales_return_items", column: "return_id", ref: "sales_returns" },
  { table: "sales_return_items", column: "original_sold_product_id", ref: "sold_products" },
  { table: "purchase_return_items", column: "purchase_return_id", ref: "purchase_returns" },
  { table: "purchase_voucher_payments", column: "expense_id", ref: "expenses" },
  { table: "purchase_voucher_payments", column: "voucher_id", ref: "purchase_vouchers" },
  { table: "supplier_promo_settlements", column: "income_id", ref: "income_owner" },
  { table: "user_organizations", column: "user_id", ref: "users" },
  { table: "user_organizations", column: "organization_id", ref: "organizations" },
]

/** Column defaults the database would fill in on insert. */
const DEFAULTS: Record<string, Row> = {
  customers: { dues: 0 },
  color_variants: { quantity: 1, no_barcode: false, defective: false },
  sales: {
    status: "completed", subtotal: 0, total_discount: 0, total_amount: 0,
    cash_received: 0, card_received: 0, mobile_banking_received: 0,
    bank_transfer_received: 0, total_received: 0, change_amount: 0,
    previous_dues: 0, due_settled: 0,
  },
  sold_products: { discount_percentage: 0, discount_amount: 0, is_gift: false, promo_amount: 0 },
  sales_returns: { status: "processed", price_difference: 0, return_kind: "exchange", total_refund_amount: 0 },
  sales_return_items: { condition: "good", restock: true },
  purchase_returns: { status: "processed" },
  purchase_vouchers: {
    total_quantity: 0, net_amount: 0, discount: 0, adjustment: 0,
    party_amount: 0, paid_amount: 0, due_amount: 0, due_settled: 0,
  },
  shop_labels: { hidden: false },
  income_owner: { income_type: "owner_income", destination_type: "cash" },
}

let state: State | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function load(): State {
  if (state) return state
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as State
        if (parsed?.version === VERSION && parsed.seededOn === today() && parsed.tables) {
          state = parsed
          return state
        }
      }
    } catch {
      // Unreadable or blocked storage: fall through to a fresh sample.
    }
  }
  state = fresh()
  return state
}

function fresh(): State {
  const tables = buildSeed()
  const seq: Record<string, number> = {}
  for (const [name, rows] of Object.entries(tables)) {
    seq[name] = rows.reduce((max, r) => (typeof r.id === "number" && r.id > max ? r.id : max), 0)
  }
  return { version: VERSION, seededOn: today(), tables, seq }
}

/** Write to localStorage shortly after the last change. */
export function persist() {
  if (typeof window === "undefined") return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(load()))
    } catch {
      // Storage full or blocked: the demo keeps working for this visit.
    }
  }, 150)
}

export function resetDemo() {
  state = fresh()
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing saved to remove.
  }
}

export function rawTable(name: string): Row[] {
  const s = load()
  return (s.tables[name] ??= [])
}

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function nextId(table: string): string | number {
  if (UUID_TABLES.has(table)) return uuid()
  const s = load()
  s.seq[table] = (s.seq[table] ?? 0) + 1
  return s.seq[table]
}

/** A new row with the database's defaults, ids and timestamps. */
export function withDefaults(table: string, values: Row): Row {
  const now = new Date().toISOString()
  const row: Row = {
    ...(KEYLESS_TABLES.has(table) ? {} : { id: nextId(table) }),
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...(DEFAULTS[table] ?? {}),
  }
  for (const [k, v] of Object.entries(values)) if (v !== undefined) row[k] = v
  if (table === "expenses" && !row.reference) row.reference = `EXP-${1000 + rawTable("expenses").length + 1}`
  if (table === "sales") row.credit_amount = saleCreditAmount(row)
  return row
}

/**
 * What one sale put on the customer's account (script 53). Kept by a
 * trigger in the real database; recomputed on every write here.
 */
export function saleCreditAmount(s: Row): number {
  const total = Number(s.total_amount ?? 0)
  if (total === 0 || s.settled_sale_id != null) return 0
  const prev = Number(s.previous_dues ?? 0)
  const goods = Number(s.net_amount ?? 0) > 0 ? Number(s.net_amount) : Math.max(0, total - prev)
  const towardGoods = Math.max(0, Number(s.total_received ?? 0) - prev)
  return Math.max(0, Math.round((goods - towardGoods) * 100) / 100)
}

export function insertRow(table: string, values: Row): Row {
  const row = withDefaults(table, values)
  rawTable(table).push(row)
  return row
}

/**
 * `inventory` is a table kept in step with color_variants by triggers
 * in the real database. Here it is worked out from them on every read,
 * so the two can never disagree.
 */
export function inventoryRows(): Row[] {
  const purchases = new Map(rawTable("purchases").map((p) => [p.id, p]))
  const out: Row[] = []
  for (const cv of rawTable("color_variants")) {
    const p = purchases.get(cv.purchase_id)
    if (!p || p.deleted_at) continue
    out.push({
      organization_id: cv.organization_id,
      barcode: cv.no_barcode || !cv.barcode ? `NB-${cv.id}` : cv.barcode,
      purchase_id: p.id,
      product_name: p.product_name,
      model_number: p.model_number,
      category: p.category,
      brand: p.brand,
      supplier: p.supplier,
      cost_price: p.cost_price,
      sale_price: p.sale_price,
      unit_price: p.sale_price,
      description: p.description,
      color: cv.color,
      quantity: cv.quantity,
      imei: cv.imei,
      created_at: cv.created_at,
      updated_at: cv.updated_at,
      deleted_at: cv.deleted_at,
      variant: cv.variant,
      no_barcode: !!cv.no_barcode,
      defective: !!cv.defective,
      __cv: cv.id,
    })
  }
  return out
}

/** The color_variants row behind an inventory barcode. */
export function variantForBarcode(orgId: string, barcode: string): Row | undefined {
  const code = String(barcode ?? "").trim()
  const nb = /^NB-(\d+)$/.exec(code)
  return rawTable("color_variants").find((cv) =>
    cv.organization_id === orgId &&
    (nb ? cv.id === Number(nb[1]) : cv.barcode === code),
  )
}

export function newUuid() {
  return uuid()
}
