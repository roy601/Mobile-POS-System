"use client"

import { useState } from "react"
import { RotateCcw } from "lucide-react"
import { resetDemo } from "@/demo/db"

/**
 * A thin strip above every screen saying this is sample data, with a
 * way to put the sample back after a visitor has played with it.
 */
export function DemoBanner() {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-950 print:hidden dark:bg-amber-950 dark:text-amber-100">
      <span>
        <strong>Demo</strong> — sample shop with made-up data. Changes stay in this browser only.
      </span>
      {confirming ? (
        <span className="inline-flex items-center gap-2">
          Start over?
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => {
              resetDemo()
              window.location.href = "/main"
            }}
          >
            Yes, reset
          </button>
          <button type="button" className="underline underline-offset-2" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
          onClick={() => setConfirming(true)}
        >
          <RotateCcw className="h-3 w-3" />
          Reset demo
        </button>
      )}
    </div>
  )
}
