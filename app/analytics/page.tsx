import type { Metadata } from "next"
import { AnalyticsClient } from "@/components/analytics-client"
import { MainNav } from "@/components/main-nav"
import { UserNav } from "@/components/user-nav"

export const metadata: Metadata = {
  title: "Analytics Dashboard",
  description: "Business analytics and insights",
}

export default function AnalyticsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-40">
        <div className="flex h-16 items-center gap-3 px-4">
          {/* The nav takes whatever is left and shrinks into it. The
              old three-column grid gave it its natural width and let it
              overflow, so on a narrower monitor the last destinations
              were simply cut off the end. */}
          <MainNav className="min-w-0 flex-1" />
          {/* Every other page has this. The Day Cashbook imported
              UserNav and then never rendered it, so this was the one
              screen with no shop name and no way to switch shop or
              sign out — on the page an owner opens most. */}
          <div className="flex shrink-0 items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>
      <AnalyticsClient />
    </div>
  )
}
