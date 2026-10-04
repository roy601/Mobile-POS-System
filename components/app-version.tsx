"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Info } from "lucide-react"

import { Button } from "@/components/ui/button"

type AppInfo = {
  version: string
  logPath: string
  platform: string
}

declare global {
  interface Window {
    electronApp?: {
      isElectron?: boolean
      getInfo?: () => Promise<AppInfo>
    }
  }
}

/**
 * Which version this till is running, and where its log lives.
 *
 * The first two questions on any support call are "what version are you
 * on?" and "can you send me the log?" — neither of which a shop could
 * answer before, because nothing displayed either. The version also
 * lets you confirm an update actually landed rather than taking the
 * updater's word for it.
 *
 * Shows nothing outside the desktop app: in a browser there is no
 * installed version to report, and an empty or guessed one would be
 * worse than none.
 */
export function AppVersion() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const bridge = typeof window !== "undefined" ? window.electronApp : undefined
    if (!bridge?.getInfo) return

    bridge
      .getInfo()
      .then((data) => {
        if (!cancelled) setInfo(data)
      })
      .catch(() => {
        // An About panel is never worth an error message.
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!info) return null

  const copyLogPath = async () => {
    try {
      await navigator.clipboard.writeText(info.logPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked — the path is on screen to read out anyway.
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Mobile POS</span>
            <span className="rounded bg-background px-2 py-0.5 font-mono text-xs">
              v{info.version}
            </span>
            <span className="text-xs text-muted-foreground">
              Updates install automatically when you close the app.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Log file for support:</span>
            <code className="break-all rounded bg-background px-2 py-0.5 text-xs">
              {info.logPath}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={copyLogPath}
            >
              {copied ? (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-3 w-3" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
