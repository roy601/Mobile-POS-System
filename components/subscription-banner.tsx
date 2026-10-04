"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Clock, WifiOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSubscription } from "@/components/subscription-provider"
import { useRole } from "@/components/role-provider"

type Tone = "critical" | "warning"

const TONE: Record<Tone, { wrap: string; chip: string; title: string; body: string }> = {
  critical: {
    wrap: "border-destructive/30 bg-destructive/10",
    chip: "bg-destructive/15 text-destructive",
    title: "text-destructive",
    body: "text-destructive/80",
  },
  warning: {
    wrap: "border-amber-400/40 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    title: "text-amber-900 dark:text-amber-200",
    body: "text-amber-900/75 dark:text-amber-200/70",
  },
}

function Banner({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: Tone
  icon: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  const t = TONE[tone]
  return (
    <div className={cn("mx-4 mt-3 rounded-xl border px-4 py-3.5", t.wrap)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            t.chip
          )}
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", t.title)}>{title}</p>
          {/* Held to a readable measure: on a 1920px till the old banner
              ran the whole sentence across one very long line. */}
          <p className={cn("max-w-[92ch] text-sm", t.body)}>{children}</p>
        </div>

        {action}
      </div>
    </div>
  )
}

/**
 * Tells a shop where it stands on its subscription.
 *
 * Silent while everything is fine. It only speaks up when the shop is
 * about to lose the ability to record sales, or already has — the two
 * moments where saying nothing costs them money.
 */
export function SubscriptionBanner() {
  const { canWrite, daysRemaining, expiringSoon, plan, usingCache, loading } = useSubscription()
  const { accountType, currentShopId } = useRole()

  if (loading) return null

  // No shop means nobody is signed in yet, or onboarding has not finished.
  // Without this the provider's null subscription reads as "inactive" and
  // the login and signup screens greet people with a lapsed-account
  // warning before they even have an account.
  if (!currentShopId) return null

  const details = (
    <Button asChild size="sm" variant="outline" className="shrink-0 bg-background/60">
      <Link href="/data-sync">
        Subscription details
        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
      </Link>
    </Button>
  )

  // Expired: writes are refused by the database. Say what still works,
  // so nobody thinks their records are gone.
  if (!canWrite) {
    return (
      <Banner
        tone="critical"
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Subscription inactive — read-only mode"
        action={accountType === "owner" ? details : undefined}
      >
        Your records are safe and you can still view, search and print them. New sales, purchases
        and payments cannot be recorded until the subscription is renewed
        {accountType === "owner" ? " — contact support to renew." : "."}
      </Banner>
    )
  }

  if (expiringSoon) {
    const d = daysRemaining ?? 0
    return (
      <Banner
        tone="warning"
        icon={<Clock className="h-4 w-4" />}
        title={`${plan === "trial" ? "Trial" : "Subscription"} ends ${
          d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`
        }`}
        action={accountType === "owner" ? details : undefined}
      >
        After that the app becomes read-only — you keep your data but cannot record new sales.
      </Banner>
    )
  }

  // Running on a cached licence: worth flagging quietly, since it means
  // the shop cannot currently reach the server. Deliberately plainer than
  // the two above — it is information, not a warning.
  if (usingCache) {
    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        Offline — using your last confirmed subscription status.
      </div>
    )
  }

  return null
}
