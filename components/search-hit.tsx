/**
 * Marking what a barcode or IMEI search found.
 *
 * A search finds the ROW — a grouped product, a sale, a purchase — but
 * the shop typed a number belonging to one handset inside it. Without
 * a mark they were left reading every barcode in the list to find the
 * one they had typed. Inventory, Sales and Purchases all use this, so
 * a found handset looks the same wherever it turns up.
 */

/**
 * Below this, a term is not someone looking for one handset. "3"
 * appears in nearly every barcode, and tinting the whole table would
 * mark nothing at all. The search itself still filters on any length;
 * this only decides what is highlighted.
 */
const MIN_CODE_TERM = 4

/** The search as matching sees it: trimmed and lower-cased. */
export const searchKeyOf = (raw: string) => raw.trim().toLowerCase()

/** Whether a barcode or IMEI holds the searched-for number. */
export function codeMatches(code: string | null | undefined, key: string): boolean {
  return key.length >= MIN_CODE_TERM && !!code && code.toLowerCase().includes(key)
}

/** Row tint for something the search found. */
export const HIT_ROW_CLASS =
  "bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"

/** Stronger tint, with a bar on the left, for the handset itself. */
export const HIT_UNIT_CLASS =
  "bg-amber-100 shadow-[inset_3px_0_0_theme(colors.amber.500)] hover:bg-amber-100 dark:bg-amber-900/40 dark:hover:bg-amber-900/40"

/** `text` with the part matching `key` marked, so the eye lands on it. */
export function Highlight({ text, term: key }: { text: string; term: string }) {
  const at = key.length >= MIN_CODE_TERM ? text.toLowerCase().indexOf(key) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-amber-300 px-0.5 text-foreground dark:bg-amber-500/60">
        {text.slice(at, at + key.length)}
      </mark>
      {text.slice(at + key.length)}
    </>
  )
}
