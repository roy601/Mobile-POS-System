"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  Archive,
  Check,
  Cloud,
  CloudOff,
  Database,
  Download,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MainNav } from "@/components/main-nav"
import { UserNav } from "@/components/user-nav"
import { useRole } from "@/components/role-provider"
import { useSubscription } from "@/components/subscription-provider"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/utils/supabase/component"
import { downloadBackup } from "@/lib/backup"

const supabase = createClient()

type Reach = {
  state: "checking" | "ok" | "down"
  ms: number | null
  at: Date | null
  detail?: string
}

type UpdateInfo = {
  version?: string
  checking?: boolean
  available?: string | null
  downloaded?: string | null
  error?: string | null
  lastChecked?: string | null
}

export default function SystemPage() {
  const { toast } = useToast()
  const { shops, currentShopId } = useRole()
  const {
    canWrite,
    plan,
    status: subStatus,
    endDate,
    daysRemaining,
    expiringSoon,
    usingCache,
  } = useSubscription()
  const shop = shops.find((s) => s.id === currentShopId)

  const [reach, setReach] = useState<Reach>({ state: "checking", ms: null, at: null })
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)

  /**
   * Ask the database, not the network adapter.
   *
   * navigator.onLine only reports whether this machine has a network
   * connection — it is true with a dead router, broken DNS, or Supabase
   * itself down. On a till that cannot record a sale without the
   * database, a green light in any of those cases is worse than no
   * light at all, so this makes a real round trip and times it.
   */
  const checkReach = useCallback(async () => {
    if (!currentShopId) return
    setReach((r) => ({ ...r, state: "checking" }))

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setReach({ state: "down", ms: null, at: new Date(), detail: "This computer has no network connection." })
      return
    }

    const started = performance.now()
    try {
      const { error } = await supabase
        .from("organizations")
        .select("id")
        .eq("id", currentShopId)
        .limit(1)
      const ms = Math.round(performance.now() - started)
      if (error) {
        setReach({ state: "down", ms, at: new Date(), detail: error.message })
        return
      }
      setReach({ state: "ok", ms, at: new Date() })
    } catch (e: any) {
      setReach({
        state: "down",
        ms: null,
        at: new Date(),
        detail: e?.message ?? "The database could not be reached.",
      })
    }
  }, [currentShopId])

  useEffect(() => {
    checkReach()
    const t = setInterval(checkReach, 30_000)
    const back = () => checkReach()
    window.addEventListener("online", back)
    window.addEventListener("offline", back)
    return () => {
      clearInterval(t)
      window.removeEventListener("online", back)
      window.removeEventListener("offline", back)
    }
  }, [checkReach])

  const loadUpdate = useCallback(async () => {
    const api = (window as any).electronApp
    if (!api?.getUpdateState) return
    try {
      setUpdate(await api.getUpdateState())
    } catch {
      // The About panel already handles a browser with no bridge.
    }
  }, [])

  useEffect(() => {
    loadUpdate()
    const t = setInterval(loadUpdate, 15_000)
    return () => clearInterval(t)
  }, [loadUpdate])

  const runCheck = async () => {
    const api = (window as any).electronApp
    if (!api?.checkForUpdates) return
    setChecking(true)
    try {
      const r = await api.checkForUpdates()
      await loadUpdate()
      if (!r?.ok) {
        toast({ title: "Could not check", description: r?.message, variant: "destructive" })
      } else {
        toast({ title: "Checked for updates" })
      }
    } finally {
      setChecking(false)
    }
  }

  const install = async () => {
    const api = (window as any).electronApp
    const r = await api?.installUpdate?.()
    if (r && !r.ok) {
      toast({ title: "Not ready", description: r.message, variant: "destructive" })
    }
  }

  const runBackup = async () => {
    if (!currentShopId) return
    setBackingUp(true)
    setProgress({ done: 0, total: 1, label: "Starting" })
    try {
      const res = await downloadBackup({
        supabase,
        organizationId: currentShopId,
        shopName: shop?.name ?? "shop",
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      })
      toast({
        title: "Backup saved",
        description: `${res.sheets} spreadsheets, ${res.rows.toLocaleString()} records — ${res.fileName}`,
      })
    } catch (e: any) {
      toast({
        title: "Backup failed",
        description: e?.message ?? "Nothing was saved. Try again.",
        variant: "destructive",
      })
    } finally {
      setBackingUp(false)
      setProgress(null)
    }
  }

  const isElectron = typeof window !== "undefined" && !!(window as any).electronApp
  // Two different reasons a sale would be refused, both worth saying
  // before the customer is standing there.
  const writesBlocked = reach.state === "down" || !canWrite

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-40">
        <div className="flex h-16 items-center gap-3 px-4">
          {/* The nav takes whatever is left and shrinks into it. The
              old three-column grid gave it its natural width and let it
              overflow, so on a narrower monitor the last destinations
              were simply cut off the end. */}
          <MainNav className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-5 p-8 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Database className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-3xl font-bold tracking-tight">System</h2>
              <p className="text-muted-foreground">
                Connection, updates and a backup of {shop?.name ?? "this shop"}&apos;s records
              </p>
            </div>
          </div>
          <Badge
            variant={
              reach.state === "ok" ? "default" : reach.state === "down" ? "destructive" : "secondary"
            }
            className="shrink-0 gap-1.5"
          >
            {reach.state === "ok" ? (
              <Cloud className="h-3.5 w-3.5" />
            ) : reach.state === "down" ? (
              <CloudOff className="h-3.5 w-3.5" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {reach.state === "ok"
              ? "Connected"
              : reach.state === "down"
                ? "Not connected"
                : "Checking"}
          </Badge>
        </div>

        {/* The one thing that must never be quiet. Tone is carried by the
            whole strip rather than a small badge, because this is the
            answer to "can I serve the next customer". */}
        <div
          className={`flex flex-col gap-4 rounded-xl border p-5 md:flex-row md:items-center ${
            writesBlocked
              ? "border-destructive/30 bg-destructive/5"
              : expiringSoon
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-primary/20 bg-primary/5"
          }`}
        >
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              writesBlocked
                ? "bg-destructive/15 text-destructive"
                : expiringSoon
                  ? "bg-amber-500/15 text-amber-700"
                  : "bg-primary/15 text-primary"
            }`}
          >
            {writesBlocked ? (
              <AlertTriangle className="h-5 w-5" />
            ) : reach.state === "checking" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Check className="h-5 w-5" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">
              {reach.state === "down"
                ? "Stop trading — sales will not be recorded"
                : !canWrite
                  ? "This shop is read-only — sales will be refused"
                  : expiringSoon
                    ? `Subscription ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`
                    : "Recording normally"}
            </p>
            <p className="text-sm text-muted-foreground">
              {reach.state === "down"
                ? `A sale made now will not be saved and no receipt should be given. Reconnect before serving the next customer.${
                    reach.detail ? ` (${reach.detail})` : ""
                  }`
                : !canWrite
                  ? "The subscription is not active, so the database will refuse new sales. Existing records can still be read and exported."
                  : expiringSoon
                    ? "Renew before it lapses, or the database will start refusing new sales."
                    : "Every sale, payment and purchase is written straight to the database as you make it."}
            </p>
          </div>

          {/* Two numbers rather than prose: both are read at a glance. */}
          <div className="flex shrink-0 gap-6 md:gap-8">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Response
              </p>
              <p className="font-mono text-lg font-semibold tabular-nums">
                {reach.state === "ok" ? `${reach.ms} ms` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                New sales
              </p>
              <p
                className={`text-lg font-semibold ${
                  writesBlocked ? "text-destructive" : "text-primary"
                }`}
              >
                {writesBlocked ? "Refused" : "Accepted"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* ── Connection ─────────────────────────────────────── */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Wifi className="h-4 w-4" />
                </span>
                Connection
              </CardTitle>
              <CardDescription>
                Checked against the database itself, not just the network.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border bg-field p-3 text-sm">
                <span className="text-muted-foreground">Database</span>
                <span
                  className={
                    reach.state === "ok"
                      ? "font-medium text-green-700"
                      : reach.state === "down"
                        ? "font-medium text-red-600"
                        : "text-muted-foreground"
                  }
                >
                  {reach.state === "ok"
                    ? `Reachable · ${reach.ms} ms`
                    : reach.state === "down"
                      ? "Unreachable"
                      : "Checking…"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {reach.at ? `Last checked ${reach.at.toLocaleTimeString()}` : "—"} · rechecks every
                30 seconds
              </p>
              <Button variant="outline" className="w-full" onClick={checkReach}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${reach.state === "checking" ? "animate-spin" : ""}`}
                />
                Check now
              </Button>
            </CardContent>
          </Card>

          {/* ── Updates ────────────────────────────────────────── */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Package className="h-4 w-4" />
                </span>
                Version &amp; updates
              </CardTitle>
              <CardDescription>Updates install when you close the app.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border bg-field p-3 text-sm">
                <span className="text-muted-foreground">Installed</span>
                <span className="font-mono font-medium">
                  {update?.version ? `v${update.version}` : isElectron ? "…" : "browser"}
                </span>
              </div>

              {!isElectron ? (
                <p className="text-xs text-muted-foreground">
                  Updates apply to the installed application. This looks like a browser.
                </p>
              ) : update?.downloaded ? (
                <>
                  <p className="text-sm font-medium text-green-700">
                    v{update.downloaded} is ready to install.
                  </p>
                  <Button className="w-full" onClick={install}>
                    Restart and install
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {update?.available
                      ? `v${update.available} is downloading…`
                      : update?.error
                        ? `Last check failed: ${update.error}`
                        : "Up to date."}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={runCheck}
                    disabled={checking}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
                    {checking ? "Checking…" : "Check for updates"}
                  </Button>
                </>
              )}

              {isElectron && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => (window as any).electronApp?.openLogs?.()}
                >
                  <FileText className="mr-2 h-3.5 w-3.5" />
                  Open log folder
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Subscription ───────────────────────────────────────
              Already loaded by the provider on every page; the System
              page was reading only canWrite and showing none of it. */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                Subscription
              </CardTitle>
              <CardDescription>What the database will let this shop write.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 rounded-lg border bg-field p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-medium capitalize">{plan ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={`font-medium capitalize ${
                      canWrite ? "text-green-700" : "text-red-600"
                    }`}
                  >
                    {subStatus ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {daysRemaining !== null && daysRemaining < 0 ? "Expired" : "Ends"}
                  </span>
                  <span className="font-medium">
                    {endDate ? new Date(endDate).toLocaleDateString() : "—"}
                  </span>
                </div>
              </div>

              <p
                className={`text-xs ${
                  expiringSoon ? "font-medium text-amber-700" : "text-muted-foreground"
                }`}
              >
                {daysRemaining === null
                  ? "No end date recorded."
                  : daysRemaining < 0
                    ? `Lapsed ${Math.abs(daysRemaining)} day${
                        Math.abs(daysRemaining) === 1 ? "" : "s"
                      } ago.`
                    : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining.`}
              </p>

              {/* Worth saying plainly: the shop may look fine while running
                  on a licence that has not been re-checked with the server. */}
              {usingCache && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700">
                  Running on a saved copy of the licence — the server could not be reached to
                  confirm it.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Backup ─────────────────────────────────────────── */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Archive className="h-4 w-4" />
                </span>
                Download a backup
              </CardTitle>
              <CardDescription>
                Every page&apos;s data, one spreadsheet each, in a single zip.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Sales, line items, inventory, purchases, customers, expenses, income, returns,
                suppliers, payment lines and cashbook corrections — as Excel files you can open and
                keep. Barcodes stay readable.
              </p>

              {progress && (
                <div className="rounded-lg border bg-field p-3 text-sm">
                  <p className="font-medium">{progress.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {progress.done} of {progress.total}
                  </p>
                </div>
              )}

              <Button className="w-full" onClick={runBackup} disabled={backingUp || !currentShopId}>
                {backingUp ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Preparing…
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Download backup
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Reading records does not need the subscription, so a backup can still be taken after
                it lapses.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
