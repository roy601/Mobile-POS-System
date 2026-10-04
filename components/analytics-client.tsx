"use client"

import { DayCashbook } from "@/components/day-cashbook"

export function AnalyticsClient() {
  // The Cash Book below carries its own title, buttons and the dates it
  // covers. A second card around it repeated all of that in a heading
  // and a description, a band of height every visit.
  return (
    <div className="flex-1 p-4">
      <DayCashbook />
    </div>
  )
}
