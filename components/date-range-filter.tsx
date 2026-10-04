"use client"

import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * The one date-range control used across every report and list.
 *
 * Each page had grown its own version — some with Today/Clear buttons,
 * some with only Today, some with bare inputs and no way to reset. Same
 * job, five different controls, so staff had to relearn it per screen.
 *
 * `onApply` fires after Today / Clear / Enter, so pages that search on
 * demand can re-run their query without the user hunting for a button.
 */
export function DateRangeFilter({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  onApply,
  actions,
  idPrefix = "range",
  className = "",
  showSummary = true,
}: {
  startDate: string
  endDate: string
  onStartChange: (value: string) => void
  onEndChange: (value: string) => void
  onApply?: () => void
  /**
   * Buttons that belong on the same line as the dates — Print, Export.
   * Pushed to the right and aligned with the inputs, so a page does not
   * need a row of its own underneath to hold one or two buttons. Wraps
   * below on a narrow screen, like everything else in this row.
   */
  actions?: ReactNode
  idPrefix?: string
  className?: string
  showSummary?: boolean
}) {
  const today = new Date().toISOString().split("T")[0]

  const setToday = () => {
    onStartChange(today)
    onEndChange(today)
    onApply?.()
  }

  const clearDates = () => {
    onStartChange("")
    onEndChange("")
    onApply?.()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    onApply?.()
  }

  const summary =
    startDate && endDate
      ? `${startDate} to ${endDate}`
      : startDate
        ? `from ${startDate}`
        : endDate
          ? `up to ${endDate}`
          : "all dates"

  // ONE LINE. The labels sit beside the boxes instead of above them, and
  // what is showing follows the buttons rather than taking a line of its
  // own -- the old two-and-a-half rows pushed every list down the screen.
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Label htmlFor={`${idPrefix}-start`} className="text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id={`${idPrefix}-start`}
          type="date"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-9 w-40"
        />

        <Label htmlFor={`${idPrefix}-end`} className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id={`${idPrefix}-end`}
          type="date"
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-9 w-40"
        />

        <Button variant="outline" size="sm" onClick={setToday}>
          Today
        </Button>
        <Button variant="outline" size="sm" onClick={clearDates}>
          Clear
        </Button>

        {showSummary && (
          <span className="text-xs text-muted-foreground">
            Showing: <span className="font-medium text-foreground">{summary}</span>
          </span>
        )}

        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
