import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt"

/**
 * The look every printed sheet shares.
 *
 * The shop reads these in a stack at the end of a day, so they have to
 * be recognisable at a glance and identical in the places the eye
 * lands: the red letterhead, the rule under it, the green group
 * headings, and the double rule under the closing total that says
 * "this is the bottom".
 *
 * Kept in one file because six reports with six slightly different
 * versions of the same header is how a set of documents stops looking
 * like a set.
 */

export const money = (n: unknown) =>
  (Number(n) || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/** Whole taka, for the sheets that print no paisa. */
export const money0 = (n: unknown) =>
  Math.round(Number(n) || 0).toLocaleString("en-BD")

export const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

export const dash = (v: unknown) => {
  const s = String(v ?? "").trim()
  return s === "" ? "&nbsp;" : esc(s)
}

export const dayUK = (iso: string | null | undefined) => {
  if (!iso) return "&nbsp;"
  const [y, m, d] = String(iso).slice(0, 10).split("-")
  return d && m && y ? `${d}/${m}/${y}` : esc(iso)
}

export type ReportHeader = { name: string; addressLine: string }

export const REPORT_CSS = `
  /* White is stated, not assumed. These open in whatever browser the
     shop PC has, and a dark-mode window would otherwise paint #111
     text onto a #111 page. */
  body { font-family: Arial, sans-serif; margin: 16px; font-size: 12px;
         color: #111; background: #fff; color-scheme: light; }

  .header { text-align: center; margin-bottom: 4px; }
  .company { font-size: 20px; font-weight: bold; color: #c0272d; letter-spacing: .5px; }
  .address { font-size: 10.5px; margin-top: 2px; }
  .period { font-size: 11px; color: #7a1a1a; font-weight: bold; margin-top: 4px; }
  .title { font-size: 15px; font-weight: bold; margin: 10px 0 4px; color: #7a1a1a;
           text-align: center; text-decoration: underline; letter-spacing: .5px; }
  .rule { border-top: 2px solid #7a1a1a; margin: 6px 0 8px; }
  .filters { text-align: center; font-size: 10.5px; color: #666; margin-bottom: 8px; }

  table { border-collapse: collapse; }
  .grid { width: 100%; border: 1.5px solid #000; margin-bottom: 4px; }
  .grid th, .grid td { border: 1px solid #000; padding: 4px 6px; font-size: 11px; }
  .grid th { background: #fff; font-weight: bold; text-align: center; }
  .c { text-align: center; }
  .r { text-align: right; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .serial { font-family: "Courier New", monospace; }

  .group-name { text-align: center; font-weight: bold; color: #7a1a1a; margin: 14px 0 4px; font-size: 13px; }
  .party-name { font-weight: bold; color: #8a1a8a; margin: 12px 0 2px; font-size: 12.5px; }
  .group-total td { font-weight: bold; border-top: 1.5px solid #000; }

  .totals { width: 62%; margin-left: auto; margin-top: 10px; }
  .totals td { padding: 3px 6px; font-size: 12px; }
  .totals td.label { text-align: right; font-weight: bold; }
  .totals td.val { text-align: right; font-variant-numeric: tabular-nums; width: 150px; }
  .totals tr.grand td { border-top: 1.5px solid #7a1a1a; font-weight: bold; }
  .totals tr.close td { border-top: 2px solid #7a1a1a; border-bottom: 2px solid #7a1a1a;
                        font-size: 14px; font-weight: bold; }

  .empty { text-align: center; padding: 30px; color: #666; }
  .foot { margin-top: 22px; text-align: center; font-size: 10px; color: #666; }

  /* A closing figure ruled UNDERNEATH rather than above — the shape the
     shop's own sheets use for "Group Total" sitting below its table. */
  .totals tr.under td { border-bottom: 1.5px solid #000; font-weight: bold; }

  /* ---- Profit & Loss ----------------------------------------------
     Two independent stacks side by side. Each side is a text column
     and a money column, so a block's own sub-figures sit inside the
     text column and only its total reaches DR or CR. */
  .pl { width: 100%; border: 1.5px solid #000; table-layout: fixed; }
  /* The text columns are an open page — only the column rules show.
     Ruling every line would turn a ledger into a spreadsheet, and the
     sheet this copies does not do that. */
  .pl td { border-left: 1px solid #000; border-right: 1px solid #000;
           padding: 2px 6px; font-size: 10px; vertical-align: top; height: 15px; }
  .pl th { border: 1px solid #000; padding: 3px 6px;
           text-align: center; font-weight: bold; font-size: 11.5px; }
  .pl td.v { text-align: right; font-variant-numeric: tabular-nums; font-size: 10.5px; }
  /* A figure in a money column IS boxed, so the eye can pick the
     block totals out of the empty cells between them. */
  .pl td.box { border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .pl-line { display: flex; justify-content: space-between; gap: 12px; }
  .pl-line > span + span { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pl-head { font-weight: bold; color: #7a1a1a; text-decoration: underline;
             font-size: 10.5px; }
  .pl-period { font-weight: bold; color: #7a1a1a; text-decoration: underline;
               font-size: 9.5px; }
  .pl-sub { justify-content: flex-end; }
  .pl-sub > span { border-top: 1px solid #555; padding-top: 2px; }
  .pl-net td { font-weight: bold; color: #0a7a2a; text-align: center; }

  /* ---- Balance sheet and its histories ----------------------------- */
  .bs-title { text-align: center; font-size: 17px; font-weight: bold;
              color: #7a1a8a; margin: 2px 0 0; }
  .bs-rule { border-top: 3px solid #1a3a8a; margin: 8px 0 10px; }
  .bs-period { text-align: center; font-size: 11px; font-weight: bold; color: #6a6a1a; }
  .kv { margin: 0 auto; border-collapse: collapse; }
  .kv td { padding: 3px 6px; font-size: 12px; border-bottom: 1px solid #000; }
  .kv td.k { text-align: right; font-weight: bold; }
  .kv td.v { text-align: left; font-variant-numeric: tabular-nums; }
  .sec-title { text-align: center; font-size: 15px; font-weight: bold; color: #7a3a3a;
               text-decoration: underline; margin: 26px 0 10px; letter-spacing: .3px; }
  .end { text-align: center; font-weight: bold; margin: 14px 0 6px; letter-spacing: 1px; }
  .grp td { color: #8a1a8a; font-weight: bold; }
  .headrow td { color: #7a1a1a; font-weight: bold; }
  .spacer td { height: 10px; border-left: 1px solid #000; border-right: 1px solid #000;
               border-top: none; border-bottom: none; }

  @media print { body { margin: 10px; } }
`

export function letterhead(
  header: ReportHeader,
  title: string,
  period: string,
  filters?: string,
) {
  return `
    <div class="header">
      <div class="company">${header.name}</div>
      <div class="address">${header.addressLine}</div>
      <div class="period">Period : ${esc(period)}</div>
    </div>
    <div class="title">${esc(title)}</div>
    <div class="rule"></div>
    ${filters ? `<div class="filters">${esc(filters)}</div>` : ""}`
}

/**
 * Show a finished document, and do NOT print it.
 *
 * EVERY report outside the till goes through here or openReport below.
 *
 * The shop asked to see a report before it reaches paper: they were
 * getting a print dialog the instant they clicked, with no idea
 * whether they had the right dates or the right shop until it came out
 * of the printer. Eight screens each opened their own window and
 * called print() on it, so "preview first" could not be fixed in one
 * place — until now.
 *
 * The window already carries the toolbar every report shares: Print,
 * which goes through the main process so a failure is reported rather
 * than silently doing nothing, and Download PDF. Nothing here prints
 * on its own, and nothing should be added that does.
 *
 * Returns false when the browser blocked the pop-up, so the caller can
 * say so rather than the click appearing to do nothing.
 */
export function openDocument(html: string): boolean {
  const win = window.open("", "_blank", "width=1100,height=780")
  if (!win) return false
  win.document.write(html)
  win.document.close()
  // Deliberately no win.print(). See above.
  return true
}

/**
 * The same, for a report that wants the shared chrome wrapped around
 * its body rather than supplying a whole document.
 */
export function openReport(title: string, body: string): boolean {
  return openDocument(
    `<!DOCTYPE html><html><head><title>${esc(title)}</title>
    <style>${REPORT_CSS}${DOCUMENT_TOOLBAR_CSS}</style></head>
    <body>${documentToolbar(title)}${body}</body></html>`,
  )
}
