"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Printer } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type PrinterInfo = { name: string; isDefault: boolean }

type PrinterList = {
  ok: boolean
  chosen: string
  /** "A4", "HALF", or "" when each document decides for itself. */
  pageSize?: string
  printers: PrinterInfo[]
  message?: string
}

declare global {
  interface Window {
    electronPrinters?: {
      list?: () => Promise<PrinterList>
      choose?: (name: string) => Promise<{ ok: boolean }>
      setPageSize?: (size: string) => Promise<{ ok: boolean }>
    }
  }
}

/** What the app uses when the shop has not chosen. */
const WINDOWS_DEFAULT = "__default__"

/** Let each document measure itself rather than pinning one size. */
const MEASURE = "__auto__"

/**
 * Which printer this till prints on.
 *
 * WHY THIS EXISTS
 *
 * Printing goes straight to the printer now — no dialog to click
 * through, which is what a counter with a customer waiting needs. The
 * cost of that is nobody sees where the job went, so if Windows' own
 * default is wrong the shop finds out from the paper. A till with a
 * receipt printer and an A4 printer has exactly one right answer for
 * each, and only the shop knows which.
 *
 * Left unset, the app works it out: real printers before PDF writers,
 * and OneNote, Fax and AnyDesk last, because each of those has been
 * somebody's default and quietly eaten a print job.
 *
 * Shows nothing in a browser — there is no printer to choose there,
 * and the browser's own print dialog already asks.
 */
export function PrinterSettings() {
  const [state, setState] = useState<PrinterList | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => {
    const bridge = typeof window !== "undefined" ? window.electronPrinters : undefined
    if (!bridge?.list) return
    bridge
      .list()
      .then(setState)
      .catch(() => {
        // A printer list is never worth an error message; the app
        // still picks one on its own.
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!state) return null

  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const choose = async (value: string) => {
    const name = value === WINDOWS_DEFAULT ? "" : value
    setState((prev) => (prev ? { ...prev, chosen: name } : prev))
    try {
      await window.electronPrinters?.choose?.(name)
      flash()
    } catch {
      // Re-read rather than claim it saved.
      load()
    }
  }

  const choosePaper = async (value: string) => {
    const size = value === MEASURE ? "" : value
    setState((prev) => (prev ? { ...prev, pageSize: size } : prev))
    try {
      await window.electronPrinters?.setPageSize?.(size)
      flash()
    } catch {
      load()
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <Printer className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Printer</span>
            <span className="text-xs text-muted-foreground">
              Printing goes straight to this printer, with no dialog.
            </span>
            {saved && (
              <span className="flex items-center text-xs text-emerald-600">
                <Check className="mr-1 h-3 w-3" />
                Saved
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={state.chosen || WINDOWS_DEFAULT} onValueChange={choose}>
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder="Choose automatically" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WINDOWS_DEFAULT}>
                  Choose automatically
                </SelectItem>
                {state.printers.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                    {p.isDefault ? "  (Windows default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-sm font-medium">Paper</span>
            <Select value={state.pageSize || MEASURE} onValueChange={choosePaper}>
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder="Match the document" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MEASURE}>
                  Match the document (invoices on a half sheet, reports on a full one)
                </SelectItem>
                <SelectItem value="A4">Always a full sheet (A4)</SelectItem>
                <SelectItem value="HALF">Always a half sheet (A4 cut in half)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            {state.pageSize === "HALF"
              ? "Everything prints on a half sheet — an A4 cut across the middle. A long report will run onto a second one."
              : state.pageSize === "A4"
                ? "Everything prints on a full sheet, including short invoices."
                : "Invoices print on a half sheet — an A4 cut across the middle — and every report on a full one."}
          </p>

          <p className="text-xs text-muted-foreground">
            {state.printers.length === 0
              ? "No printer is installed on this computer."
              : state.chosen
                ? "Every invoice and report prints here. If it is switched off, the app says so rather than printing somewhere else."
                : "The app picks a working printer on its own, preferring a real one over Print to PDF. Choose one above if it picks wrong."}
          </p>
        </div>
      </div>
    </div>
  )
}
