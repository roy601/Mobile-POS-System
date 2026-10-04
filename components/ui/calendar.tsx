"use client"

import type * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

/**
 * Date picker used across every screen.
 *
 * NOTE ON THE CLASS NAMES BELOW
 *
 * This component was written for react-day-picker v8, but the project
 * runs v9, which renamed almost every styling key: caption →
 * month_caption, head_row → weekdays, head_cell → weekday, row → week,
 * cell → day, day → day_button, day_selected → selected, and so on.
 * Unrecognised keys are ignored rather than reported, so the calendar
 * silently lost most of its styling — which is why date pickers did not
 * look the same from page to page.
 *
 * The keys here are the v9 ones. If a calendar ever looks unstyled
 * again after upgrading react-day-picker, check this list first.
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4 relative",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center h-7",
        caption_label: "text-sm font-medium",

        nav: "flex items-center gap-1 absolute top-3 inset-x-3 justify-between z-10",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),

        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",

        // v9's "day" is the table cell; "day_button" is the clickable
        // control inside it. Getting these two the wrong way round is
        // what makes every date look like a plain unstyled link.
        day: "h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),

        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
        today: "bg-accent text-accent-foreground rounded-md",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        range_start: "rounded-l-md",
        range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground rounded-none",
        range_end: "rounded-r-md",
        hidden: "invisible",

        ...classNames,
      }}
      components={{
        // v9 replaced the separate IconLeft/IconRight components with a
        // single Chevron that is told which way to point.
        Chevron: ({ orientation, ...iconProps }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" {...iconProps} />
          ) : (
            <ChevronRight className="h-4 w-4" {...iconProps} />
          ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
