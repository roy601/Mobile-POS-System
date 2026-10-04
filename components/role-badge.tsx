"use client"

import { Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useRole } from "@/components/role-provider"

/**
 * Shown to managers on the screens they can only read, so a missing
 * button reads as "not my permission" rather than "the app is broken".
 * Renders nothing for owners.
 *
 * The "limited" screens — Expenses, Income, Inventory, Returns,
 * Customers — used to carry "You can add, but not edit or delete". The
 * shop asked for it to go, and it had stopped being true besides:
 * managers now correct supplier and product names (script 92). Those
 * screens pass mode="limited" and get nothing.
 */
export function ManagerAccessBadge({
  mode = "limited",
}: {
  /** "view" = read-only screen, badged. "limited" = shows nothing. */
  mode?: "view" | "limited"
}) {
  const { accountType } = useRole()

  if (accountType !== "manager" || mode !== "view") return null

  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <Eye className="h-3 w-3" />
      View only
    </Badge>
  )
}
