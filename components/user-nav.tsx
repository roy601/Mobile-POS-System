"use client"

import Link from "next/link"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Check, Database, LogOut, Settings, Store } from "lucide-react"
import { useRole } from "@/components/role-provider"

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function UserNav() {
  const { user, shops, currentShopId, setCurrentShopId, accountType, logout } = useRole()

  const currentShop = shops.find((s) => s.id === currentShopId)
  const displayName = user?.name ?? "User"
  const displayEmail = user?.email ?? ""
  const canSwitchShops = accountType === "owner" && shops.length > 1

  return (
    /* One frosted capsule, matching the nav bar. The shop chip keeps no
       border or fill of its own: inside the glass that would read as a
       box within a box. */
    <div className="nav-capsule flex items-center gap-1 rounded-full p-2">
      {/* Which shop you are working in. A cashier glancing at the
          screen should never have to guess. */}
      {currentShop && (
        <div className="hidden h-[38px] items-center gap-1.5 pl-2.5 pr-1 sm:flex">
          <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[170px] truncate text-[14.5px] font-medium">
            {currentShop.name}
          </span>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="relative h-9 w-9 shrink-0 rounded-full p-0 hover:bg-primary/10"
            aria-label="Account menu"
          >
            {/* Deliberately no AvatarImage: the old placeholder.svg
                always loaded successfully, so the fallback never ran
                and the avatar rendered as an empty grey circle. */}
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className="w-72 rounded-xl p-1.5 shadow-lg"
          align="end"
          sideOffset={10}
          forceMount
        >
          <DropdownMenuLabel className="rounded-lg bg-muted/50 p-3 font-normal">
            <div className="flex items-start gap-3">
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                  {initials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">{displayName}</p>
                <p className="truncate text-xs leading-snug text-muted-foreground">
                  {displayEmail}
                </p>
                {accountType && (
                  <Badge
                    variant={accountType === "owner" ? "default" : "secondary"}
                    className="mt-2 h-5 px-1.5 text-[11px] font-medium capitalize"
                  >
                    {accountType === "owner" ? "Shop owner" : "Manager"}
                  </Badge>
                )}
              </div>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator className="-mx-1.5 my-1.5" />

          {/* Owners with several shops switch here; everyone else just
              sees which shop they are in. */}
          <div className="px-1 py-0.5">
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {canSwitchShops ? "Switch shop" : "Shop"}
            </p>

            {canSwitchShops ? (
              <div className="max-h-52 space-y-0.5 overflow-y-auto">
                {shops.map((shop) => {
                  const active = shop.id === currentShopId
                  return (
                    <button
                      key={shop.id}
                      type="button"
                      onClick={() => setCurrentShopId(shop.id)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors hover:bg-accent ${
                        active ? "font-medium" : "text-muted-foreground"
                      }`}
                    >
                      <Store className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{shop.name}</span>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-9 items-center gap-2.5 px-2 text-sm">
                <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {currentShop?.name ?? "No shop selected"}
                </span>
              </div>
            )}
          </div>

          <DropdownMenuSeparator className="-mx-1.5 my-1.5" />

          <DropdownMenuGroup>
            <DropdownMenuItem asChild className="h-9 rounded-lg px-2">
              <Link href="/data-sync" className="cursor-pointer">
                <Database className="mr-2.5 h-4 w-4" />
                System
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="h-9 rounded-lg px-2">
              <Link href="/settings" className="cursor-pointer">
                <Settings className="mr-2.5 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="-mx-1.5 my-1.5" />

          <DropdownMenuItem
            onClick={() => logout()}
            className="h-9 cursor-pointer rounded-lg px-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <LogOut className="mr-2.5 h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
