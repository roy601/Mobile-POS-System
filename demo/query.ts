/**
 * A small stand-in for Supabase's query builder (PostgREST), covering
 * what this app actually calls: select with embedded tables (and
 * `!inner`), the usual filters, `or`, order, range, limit, single,
 * maybeSingle, insert, update, upsert and delete.
 */
import {
  RELATIONS, inventoryRows, insertRow, persist, rawTable, saleCreditAmount,
  variantForBarcode, withDefaults, type Row,
} from "./db"

export interface PgError {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

export interface Result<T = any> {
  data: T
  error: PgError | null
  count?: number | null
  status: number
  statusText: string
}

type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is" | "in"

interface Filter {
  column: string // may be "embed.column"
  op: Op
  value: any
  negate?: boolean
}

type Condition = Filter | { or: Filter[] }

// ---------------------------------------------------------------- select parsing

interface SelectNode {
  name: string // column or embedded table
  alias?: string
  inner?: boolean
  children?: SelectNode[] // present for an embed
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of s) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      parts.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

function parseSelect(s: string | undefined): SelectNode[] {
  const src = (s ?? "*").replace(/\s+/g, " ").trim() || "*"
  return splitTopLevel(src).map((token) => {
    const open = token.indexOf("(")
    let head = open === -1 ? token : token.slice(0, open)
    let alias: string | undefined
    const colon = head.indexOf(":")
    if (colon !== -1) {
      alias = head.slice(0, colon).trim()
      head = head.slice(colon + 1)
    }
    const [name, hint] = head.trim().split("!")
    const node: SelectNode = { name: name.trim().replace(/::\w+$/, ""), alias }
    if (open !== -1) {
      node.inner = hint === "inner"
      node.children = parseSelect(token.slice(open + 1, token.lastIndexOf(")")))
    }
    return node
  })
}

// ---------------------------------------------------------------- comparison

const isNumeric = (v: unknown) =>
  typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))

function compare(a: any, b: any): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b)
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b)
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

const looseEq = (a: any, b: any) => (a == null || b == null ? a == b : compare(a, b) === 0)

function likeToRegex(pattern: string, insensitive: boolean) {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, "[\\s\\S]*")
    .replace(/_/g, "[\\s\\S]")
    .replace(/\*/g, "[\\s\\S]*")
  return new RegExp(`^${escaped}$`, insensitive ? "i" : "")
}

function parseIs(v: any) {
  if (v === null || v === "null") return null
  if (v === true || v === "true") return true
  if (v === false || v === "false") return false
  return v
}

function test(row: Row, f: Filter): boolean {
  const v = row?.[f.column]
  let ok: boolean
  switch (f.op) {
    case "eq": ok = looseEq(v, f.value); break
    case "neq": ok = !looseEq(v, f.value); break
    case "gt": ok = v != null && compare(v, f.value) > 0; break
    case "gte": ok = v != null && compare(v, f.value) >= 0; break
    case "lt": ok = v != null && compare(v, f.value) < 0; break
    case "lte": ok = v != null && compare(v, f.value) <= 0; break
    case "like": ok = v != null && likeToRegex(f.value, false).test(String(v)); break
    case "ilike": ok = v != null && likeToRegex(f.value, true).test(String(v)); break
    case "is": {
      const want = parseIs(f.value)
      ok = want === null ? v == null : v === want
      break
    }
    case "in": {
      const list = Array.isArray(f.value)
        ? f.value
        : String(f.value).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, ""))
      ok = list.some((x: any) => looseEq(v, x))
      break
    }
    default: ok = true
  }
  return f.negate ? !ok : ok
}

/** `a.ilike.%x%,b.eq.3` — the form this app passes to `.or()`. */
function parseOr(expr: string, prefix?: string): Filter[] {
  return splitTopLevel(expr).map((part) => {
    const m = /^([^.]+)\.(not\.)?([a-z]+)\.([\s\S]*)$/.exec(part.trim())
    if (!m) return { column: "__never__", op: "eq", value: Symbol() } as Filter
    return {
      column: prefix ? `${prefix}.${m[1]}` : m[1],
      op: m[3] as Op,
      value: m[4],
      negate: !!m[2],
    }
  })
}

// ---------------------------------------------------------------- embeds

function relationFor(parent: string, embed: string) {
  const toOne = RELATIONS.find((r) => r.table === parent && r.ref === embed)
  if (toOne) return { kind: "one" as const, column: toOne.column }
  const toMany = RELATIONS.find((r) => r.table === embed && r.ref === parent)
  if (toMany) return { kind: "many" as const, column: toMany.column }
  return null
}

function tableRows(name: string): Row[] {
  return name === "inventory" ? inventoryRows() : rawTable(name)
}

/** Conditions that apply at this level of the tree (no dots left). */
function localConditions(conds: Condition[], path: string): Condition[] {
  const strip = (f: Filter): Filter | null => {
    if (path === "") return f.column.includes(".") ? null : f
    if (!f.column.startsWith(path + ".")) return null
    const rest = f.column.slice(path.length + 1)
    return rest.includes(".") ? null : { ...f, column: rest }
  }
  const out: Condition[] = []
  for (const c of conds) {
    if ("or" in c) {
      const inner = c.or.map(strip)
      if (inner.every(Boolean)) out.push({ or: inner as Filter[] })
    } else {
      const s = strip(c)
      if (s) out.push(s)
    }
  }
  return out
}

function passes(row: Row, conds: Condition[]) {
  return conds.every((c) => ("or" in c ? c.or.some((f) => test(row, f)) : test(row, c)))
}

const visible = (row: Row) => {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) if (!k.startsWith("__")) out[k] = v
  return out
}

/**
 * Shape one row for the response. Returns null when an `!inner` embed
 * came up empty, which drops the row as an inner join would.
 */
function project(table: string, row: Row, nodes: SelectNode[], conds: Condition[], path: string): Row | null {
  const out: Row = {}
  for (const node of nodes) {
    if (!node.children) {
      if (node.name === "*") Object.assign(out, visible(row))
      else out[node.alias ?? node.name] = row[node.name] ?? null
      continue
    }
    const rel = relationFor(table, node.name)
    const subPath = path ? `${path}.${node.name}` : node.name
    const subConds = localConditions(conds, subPath)
    const key = node.alias ?? node.name
    if (!rel) {
      out[key] = null
      if (node.inner) return null
      continue
    }
    if (rel.kind === "one") {
      const target = row[rel.column] == null
        ? undefined
        : tableRows(node.name).find((r) => looseEq(r.id, row[rel.column]))
      const shaped = target && passes(target, subConds)
        ? project(node.name, target, node.children, conds, subPath)
        : null
      if (!shaped && node.inner) return null
      out[key] = shaped
    } else {
      const shaped = tableRows(node.name)
        .filter((r) => looseEq(r[rel.column], row.id) && passes(r, subConds))
        .map((r) => project(node.name, r, node.children!, conds, subPath))
        .filter(Boolean)
      if (node.inner && shaped.length === 0) return null
      out[key] = shaped
    }
  }
  return out
}

// ---------------------------------------------------------------- builder

const ok = <T>(data: T, status = 200, count: number | null = null): Result<T> =>
  ({ data, error: null, count, status, statusText: "OK" })

const fail = (message: string, code = "DEMO"): Result<any> =>
  ({ data: null, error: { message, code, details: null, hint: null }, count: null, status: 400, statusText: "Bad Request" })

type Action = "select" | "insert" | "update" | "upsert" | "delete"

/** Children removed with their parent, as `on delete cascade` does. */
const CASCADES: Record<string, { table: string; column: string }[]> = {
  sales: [
    { table: "sold_products", column: "sales_id" },
    { table: "sale_customers", column: "sales_id" },
    { table: "sale_payments", column: "sales_id" },
  ],
  sales_returns: [{ table: "sales_return_items", column: "return_id" }],
  purchase_returns: [{ table: "purchase_return_items", column: "purchase_return_id" }],
  purchases: [{ table: "color_variants", column: "purchase_id" }],
  expenses: [{ table: "purchase_voucher_payments", column: "expense_id" }],
  purchase_vouchers: [{ table: "purchase_voucher_payments", column: "voucher_id" }],
  income_owner: [{ table: "supplier_promo_settlements", column: "income_id" }],
}

export function removeRows(table: string, doomed: Row[]) {
  if (doomed.length === 0) return
  const set = new Set(doomed)
  const rows = rawTable(table)
  for (let i = rows.length - 1; i >= 0; i--) if (set.has(rows[i])) rows.splice(i, 1)
  for (const child of CASCADES[table] ?? []) {
    const ids = new Set(doomed.map((d) => String(d.id)))
    removeRows(child.table, rawTable(child.table).filter((r) => ids.has(String(r[child.column]))))
  }
}

export class QueryBuilder implements PromiseLike<Result> {
  private action: Action = "select"
  private columns: string | undefined
  private returning = false
  private values: Row[] = []
  private patch: Row = {}
  private conflict: string[] = ["id"]
  private conds: Condition[] = []
  private orders: { column: string; ascending: boolean }[] = []
  private from_?: number
  private to_?: number
  private limit_?: number
  private mode: "many" | "single" | "maybe" = "many"
  private countMode = false
  private headOnly = false
  private promise?: Promise<Result>

  constructor(private table: string) {}

  // ---- actions
  select(columns?: string, opts?: { count?: string; head?: boolean }) {
    if (this.action === "select") this.columns = columns
    else {
      this.returning = true
      this.columns = columns
    }
    if (opts?.count) this.countMode = true
    if (opts?.head) this.headOnly = true
    return this
  }
  insert(values: Row | Row[]) {
    this.action = "insert"
    this.values = Array.isArray(values) ? values : [values]
    return this
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.action = "upsert"
    this.values = Array.isArray(values) ? values : [values]
    if (opts?.onConflict) this.conflict = opts.onConflict.split(",").map((c) => c.trim())
    return this
  }
  update(values: Row) {
    this.action = "update"
    this.patch = values
    return this
  }
  delete() {
    this.action = "delete"
    return this
  }

  // ---- filters
  private add(column: string, op: Op, value: any, negate = false) {
    this.conds.push({ column, op, value, negate })
    return this
  }
  eq(c: string, v: any) { return this.add(c, "eq", v) }
  neq(c: string, v: any) { return this.add(c, "neq", v) }
  gt(c: string, v: any) { return this.add(c, "gt", v) }
  gte(c: string, v: any) { return this.add(c, "gte", v) }
  lt(c: string, v: any) { return this.add(c, "lt", v) }
  lte(c: string, v: any) { return this.add(c, "lte", v) }
  like(c: string, v: any) { return this.add(c, "like", v) }
  ilike(c: string, v: any) { return this.add(c, "ilike", v) }
  is(c: string, v: any) { return this.add(c, "is", v) }
  in(c: string, v: any[]) { return this.add(c, "in", v) }
  not(c: string, op: string, v: any) { return this.add(c, op as Op, v, true) }
  filter(c: string, op: string, v: any) {
    if (op.startsWith("not.")) return this.add(c, op.slice(4) as Op, v, true)
    return this.add(c, op as Op, v)
  }
  match(obj: Row) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v)
    return this
  }
  or(expr: string, opts?: { foreignTable?: string; referencedTable?: string }) {
    this.conds.push({ or: parseOr(expr, opts?.referencedTable ?? opts?.foreignTable) })
    return this
  }

  // ---- modifiers
  order(column: string, opts?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: opts?.ascending !== false })
    return this
  }
  range(from: number, to: number) {
    this.from_ = from
    this.to_ = to
    return this
  }
  limit(n: number) {
    this.limit_ = n
    return this
  }
  single() {
    this.mode = "single"
    return this
  }
  maybeSingle() {
    this.mode = "maybe"
    return this
  }
  abortSignal() { return this }
  throwOnError() { return this }
  returns() { return this }

  // ---- execution
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: any) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    this.promise ??= new Promise<Result>((resolve) => {
      // Let the calling code finish building the chain, as the real
      // client sends nothing until awaited.
      setTimeout(() => {
        try {
          resolve(this.run())
        } catch (err: any) {
          resolve(fail(err?.message ?? String(err)))
        }
      }, 0)
    })
    return this.promise.then(onfulfilled, onrejected)
  }
  catch(onrejected: (reason: any) => any) {
    return this.then(undefined, onrejected)
  }

  private matching(rows: Row[]) {
    const base = localConditions(this.conds, "")
    return rows.filter((r) => passes(r, base))
  }

  private shape(rows: Row[]): Result {
    const nodes = parseSelect(this.columns)
    let shaped: { src: Row; out: Row }[] = []
    for (const src of rows) {
      const out = project(this.table, src, nodes, this.conds, "")
      if (out) shaped.push({ src, out })
    }
    for (const o of [...this.orders].reverse()) {
      shaped = [...shaped].sort((a, b) => {
        const c = compare(a.src[o.column], b.src[o.column])
        // Postgres puts nulls last ascending, first descending.
        if (a.src[o.column] == null || b.src[o.column] == null) return o.ascending ? -c : c
        return o.ascending ? c : -c
      })
    }
    const total = shaped.length
    if (this.from_ !== undefined) shaped = shaped.slice(this.from_, (this.to_ ?? this.from_) + 1)
    if (this.limit_ !== undefined) shaped = shaped.slice(0, this.limit_)
    const data = shaped.map((s) => s.out)

    if (this.mode === "single") {
      if (data.length !== 1) {
        return {
          ...fail("JSON object requested, multiple (or no) rows returned", "PGRST116"),
          status: 406,
        }
      }
      return ok(data[0])
    }
    if (this.mode === "maybe") {
      if (data.length > 1) return fail("JSON object requested, multiple rows returned", "PGRST116")
      return ok(data[0] ?? null)
    }
    if (this.headOnly) return ok(null, 200, total)
    return ok(data, 200, this.countMode ? total : null)
  }

  private run(): Result {
    const t = this.table
    if (this.action === "select") return this.shape(this.matching(tableRows(t)))

    let touched: Row[] = []
    if (t === "inventory") touched = this.writeInventory()
    else if (this.action === "insert") {
      touched = this.values.map((v) => insertRow(t, v))
    } else if (this.action === "upsert") {
      for (const v of this.values) {
        const existing = rawTable(t).find((r) => this.conflict.every((c) => looseEq(r[c], v[c])))
        if (existing) {
          Object.assign(existing, v)
          touched.push(existing)
        } else touched.push(insertRow(t, v))
      }
    } else if (this.action === "update") {
      touched = this.matching(rawTable(t))
      for (const r of touched) Object.assign(r, this.patch)
    } else if (this.action === "delete") {
      touched = this.matching(rawTable(t))
      // Returned as they were before going.
      const copies = touched.map((r) => ({ ...r }))
      removeRows(t, touched)
      touched = copies
    }
    if (t === "sales") for (const r of touched) r.credit_amount = saleCreditAmount(r)
    persist()

    if (!this.returning) {
      return { ...ok(null, this.action === "insert" ? 201 : 204), count: null }
    }
    // Returned rows go through the same shaping as a select, minus filters.
    const saved = this.conds
    this.conds = this.conds.filter((c) => !("or" in c) && c.column.includes("."))
    const res = this.shape(touched)
    this.conds = saved
    return res
  }

  /** Writes to the derived inventory land on the stock rows behind it. */
  private writeInventory(): Row[] {
    if (this.action === "update" || this.action === "delete") {
      const hits = this.matching(inventoryRows())
      for (const inv of hits) {
        const cv = rawTable("color_variants").find((r) => r.id === inv.__cv)
        if (!cv) continue
        if (this.action === "delete") cv.deleted_at = new Date().toISOString()
        else {
          if ("quantity" in this.patch) cv.quantity = Number(this.patch.quantity)
          if ("defective" in this.patch) cv.defective = !!this.patch.defective
          cv.updated_at = new Date().toISOString()
        }
      }
      return hits
    }
    // An insert (a returned item with no stock line left) becomes a
    // purchase with one stock line, as the real sync trigger would see it.
    return this.values.map((v) => {
      const existing = variantForBarcode(v.organization_id, v.barcode)
      if (existing) {
        existing.quantity = Number(existing.quantity ?? 0) + Number(v.quantity ?? 0)
        return existing
      }
      const p = insertRow("purchases", {
        organization_id: v.organization_id,
        product_name: v.product_name,
        model_number: v.model_number ?? null,
        category: v.category ?? null,
        brand: v.brand ?? null,
        supplier: v.supplier ?? null,
        cost_price: v.cost_price ?? v.unit_price ?? 0,
        sale_price: v.sale_price ?? v.unit_price ?? 0,
      })
      return insertRow("color_variants", {
        organization_id: v.organization_id,
        purchase_id: p.id,
        barcode: v.barcode,
        imei: v.imei ?? v.barcode,
        color: v.color ?? null,
        variant: v.variant ?? null,
        quantity: Number(v.quantity ?? 1),
      })
    })
  }
}

/** A finished value that behaves like a query: awaitable, single, maybeSingle. */
export class ValueBuilder implements PromiseLike<Result> {
  private mode: "many" | "single" | "maybe" = "many"
  constructor(private produce: () => Result) {}
  single() { this.mode = "single"; return this }
  maybeSingle() { this.mode = "maybe"; return this }
  abortSignal() { return this }
  throwOnError() { return this }
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: any) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return new Promise<Result>((resolve) => {
      setTimeout(() => {
        let res: Result
        try {
          res = this.produce()
        } catch (err: any) {
          res = fail(err?.message ?? String(err))
        }
        if (!res.error && this.mode !== "many" && Array.isArray(res.data)) {
          if (this.mode === "single" && res.data.length !== 1) {
            res = fail("JSON object requested, multiple (or no) rows returned", "PGRST116")
          } else res = { ...res, data: res.data[0] ?? null }
        }
        resolve(res)
      }, 0)
    }).then(onfulfilled, onrejected)
  }
}

export { ok, fail, withDefaults }
