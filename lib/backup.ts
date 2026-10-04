import ExcelJS from "exceljs"
import JSZip from "jszip"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * One-click backup: every page's data, one spreadsheet each, in one zip.
 *
 * WHY REAL .xlsx AND NOT CSV
 *
 * Excel reads a 15-digit IMEI in a CSV as a number and shows
 * 3.53523E+14. Every barcode in the backup would be unreadable, which
 * is the one column a shop is most likely to look something up by. In
 * xlsx the cell type is written explicitly, so a barcode stays a
 * barcode.
 *
 * WHY SOME SHEETS ARE NAMED FOR PAGES THAT HAVE NO TABLE
 *
 * Day Cashbook, Ledger and Bank Info are computed at read time from
 * sales, expenses, income and payments — there is no stored row to
 * export. So those pages are backed by the records that produce them,
 * named for the page they feed, and a README sheet says which is which.
 * Exporting a snapshot of the rendered figures instead would give the
 * shop numbers it could never recompute or check.
 */

export type BackupProgress = (done: number, total: number, label: string) => void

type Dataset = {
  /** File name inside the zip, without extension. */
  file: string
  /** What the shop calls it. */
  label: string
  table: string
  select: string
  orderBy?: string
  ascending?: boolean
}

const DATASETS: Dataset[] = [
  { file: "01-sales", label: "Sales", table: "sales", select: "*", orderBy: "sale_date" },
  {
    file: "02-sales-items",
    label: "Sales — line items",
    table: "sold_products",
    select: "*",
    orderBy: "id",
  },
  {
    file: "03-bank-info",
    label: "Bank Info (payment lines)",
    table: "sale_payments",
    select: "*",
    orderBy: "id",
  },
  { file: "04-inventory", label: "Inventory", table: "inventory", select: "*", orderBy: "product_name", ascending: true },
  { file: "05-purchases", label: "Purchases", table: "purchases", select: "*", orderBy: "created_at" },
  {
    file: "06-purchase-units",
    label: "Purchases — units",
    table: "color_variants",
    select: "*",
    orderBy: "id",
  },
  { file: "07-customers", label: "Customers", table: "customers", select: "*", orderBy: "name", ascending: true },
  { file: "08-expenses", label: "Expenses", table: "expenses", select: "*", orderBy: "date" },
  { file: "09-income", label: "Income", table: "income_owner", select: "*", orderBy: "date" },
  { file: "10-returns", label: "Returns", table: "sales_returns", select: "*", orderBy: "return_date" },
  {
    file: "11-return-items",
    label: "Returns — items",
    table: "sales_return_items",
    select: "*",
    orderBy: "id",
  },
  {
    file: "12-purchase-returns",
    label: "Purchase returns",
    table: "purchase_returns",
    select: "*",
    orderBy: "return_date",
  },
  { file: "13-suppliers", label: "Suppliers", table: "suppliers", select: "*", orderBy: "name", ascending: true },
  {
    file: "14-cashbook-corrections",
    label: "Day Cashbook — owner corrections",
    table: "cashbook_adjustments",
    select: "*",
    orderBy: "entry_date",
  },
  {
    file: "15-cashbook-opening",
    label: "Day Cashbook — opening balances",
    table: "cashbook_opening_balances",
    select: "*",
    orderBy: "effective_date",
  },
]

/** Columns that must stay text, or Excel turns them into 3.5E+14. */
const TEXT_COLUMNS = new Set(["barcode", "imei", "phone_number", "customer_phone", "reference"])

function sheetNameFor(label: string) {
  // Excel refuses > 31 chars and these characters outright.
  return label.replace(/[\\/*?[\]:]/g, "-").slice(0, 31)
}

async function fetchAll(
  supabase: SupabaseClient<any, any, any>,
  orgId: string,
  d: Dataset
): Promise<any[]> {
  const pageSize = 1000
  let from = 0
  const all: any[] = []

  // Paged, because Supabase caps a single response and a shop with two
  // years of sales would silently get only the first slice — a backup
  // that looks complete and is not.
  for (;;) {
    let q = supabase
      .from(d.table)
      .select(d.select)
      .eq("organization_id", orgId)
      .range(from, from + pageSize - 1)

    if (d.orderBy) q = q.order(d.orderBy, { ascending: d.ascending ?? false })

    const { data, error } = await q
    if (error) {
      // A table this database has not got yet must not abort the whole
      // backup; the sheet says so instead.
      throw new Error(error.message)
    }
    const rows = (data ?? []) as any[]
    all.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }

  return all
}

function buildSheet(wb: ExcelJS.Workbook, label: string, rows: any[]) {
  const ws = wb.addWorksheet(sheetNameFor(label))

  if (rows.length === 0) {
    ws.addRow(["No records"])
    return
  }

  const headers = Object.keys(rows[0])
  ws.addRow(headers)
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: "frozen", ySplit: 1 }]

  for (const r of rows) {
    ws.addRow(
      headers.map((h) => {
        const v = r[h]
        if (v === null || v === undefined) return ""
        // Objects come from joined relations; flatten rather than
        // printing "[object Object]" into someone's records.
        if (typeof v === "object") return JSON.stringify(v)
        if (TEXT_COLUMNS.has(h)) return String(v)
        return v
      })
    )
  }

  // Barcodes and phone numbers stay text so long digit strings survive.
  headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1)
    if (TEXT_COLUMNS.has(h)) col.numFmt = "@"
    let width = h.length + 2
    for (let n = 2; n <= Math.min(ws.rowCount, 200); n++) {
      const cell = ws.getRow(n).getCell(i + 1).value
      if (cell != null) width = Math.max(width, String(cell).length + 2)
    }
    col.width = Math.min(width, 46)
  })
}

/**
 * Build the zip and hand it to the browser.
 *
 * Returns the file name so the caller can say what was saved.
 */
export async function downloadBackup(opts: {
  supabase: SupabaseClient<any, any, any>
  organizationId: string
  shopName: string
  onProgress?: BackupProgress
}): Promise<{ fileName: string; sheets: number; rows: number }> {
  const { supabase, organizationId, shopName, onProgress } = opts

  const zip = new JSZip()
  const stamp = new Date().toISOString().slice(0, 10)
  const safeShop = (shopName || "shop").replace(/[^\w\-]+/g, "-").slice(0, 40)

  const summary: Array<[string, string, number | string]> = []
  let totalRows = 0
  let done = 0

  for (const d of DATASETS) {
    onProgress?.(done, DATASETS.length, d.label)

    let rows: any[] = []
    let note: number | string = 0
    try {
      rows = await fetchAll(supabase, organizationId, d)
      note = rows.length
      totalRows += rows.length
    } catch (e: any) {
      // Recorded in the summary rather than thrown: a missing table is
      // a gap in the backup, not a reason to leave the shop with no
      // backup at all.
      note = `not available (${e?.message ?? "error"})`
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = "Mobile POS"
    wb.created = new Date()
    buildSheet(wb, d.label, rows)
    const buf = await wb.xlsx.writeBuffer()
    zip.file(`${d.file}.xlsx`, buf)

    summary.push([d.label, `${d.file}.xlsx`, note])
    done += 1
  }

  // A contents sheet, so whoever opens the zip in two years knows what
  // they are looking at and which pages are derived.
  const readme = new ExcelJS.Workbook()
  const ws = readme.addWorksheet("Contents")
  ws.addRow([`${shopName} — data backup`])
  ws.addRow([`Taken ${new Date().toLocaleString()}`])
  ws.addRow([])
  ws.addRow(["Page / data", "File", "Records"])
  ws.getRow(4).font = { bold: true }
  summary.forEach((r) => ws.addRow(r))
  ws.addRow([])
  ws.addRow(["Day Cashbook, Ledger and Bank Info are calculated from the records above."])
  ws.addRow(["They have no table of their own, so the sheets that feed them are included instead."])
  ws.getColumn(1).width = 42
  ws.getColumn(2).width = 28
  ws.getColumn(3).width = 34
  ws.getRow(1).font = { bold: true, size: 14 }
  zip.file("00-contents.xlsx", await readme.xlsx.writeBuffer())

  onProgress?.(DATASETS.length, DATASETS.length, "Packaging")

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
  const fileName = `mobile-pos-backup-${safeShop}-${stamp}.zip`

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on a delay: revoking immediately can cancel the download in
  // Chromium before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)

  return { fileName, sheets: DATASETS.length, rows: totalRows }
}
