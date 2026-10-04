import { cn } from "@/lib/utils"

export type StatTone = "default" | "money" | "warn" | "critical"

export type Stat = {
  label: string
  value: string | number
  /** Colour only where it earns it: money, or something that needs acting on. */
  tone?: StatTone
  /** Optional second line, e.g. "from 16 transactions". */
  hint?: string
}

/**
 * A page's summary figures, on one line.
 *
 * These used to be a row of cards the same size and weight as the
 * controls beneath them — which put the loudest thing on the screen on
 * a number the shop reads once a day, above a table it reads fifty
 * times. Visual weight should follow how often something is used.
 *
 * One shared component rather than six copies: the summaries had
 * already drifted apart page by page, and next time these want to be
 * bigger or smaller it should be one file, not a hunt.
 */
export function StatStrip({
  stats,
  className,
}: {
  stats: Stat[]
  className?: string
}) {
  const shown = stats.filter(Boolean)
  if (shown.length === 0) return null

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-2.5",
        className
      )}
    >
      {shown.map((s, i) => {
        // A zero is not a problem. "0 out of stock" in red would train
        // the eye to ignore the colour that matters when it is not zero.
        const inert = Number(s.value) === 0 || s.value === "0" || s.value === "৳0.00"
        const tone: StatTone = inert && s.tone !== "money" ? "default" : s.tone ?? "default"

        return (
          <div key={`${s.label}-${i}`} className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                tone === "money" && "text-green-700",
                tone === "warn" && "text-amber-600",
                tone === "critical" && "text-red-600"
              )}
            >
              {s.value}
            </span>
            {s.hint && (
              <span className="text-[11px] text-muted-foreground/80">{s.hint}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
