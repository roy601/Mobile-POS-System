"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/utils/supabase/component"
import { Loader2 } from "lucide-react"
import type { User as SupabaseUser } from "@supabase/supabase-js"

type AccountType = "owner" | "manager" | null

export interface Shop {
  id: string
  name: string
  address?: string | null
  phone?: string | null
  // Printed-receipt branding, per shop.
  phone_secondary?: string | null
  receipt_watermark?: string | null
  receipt_footer_bn?: string | null
  receipt_footer_en?: string | null
}

interface AppUser {
  id: string
  name: string
  email: string
  role: "owner" | "manager"
  avatar?: string
}

interface RoleContextType {
  user: AppUser | null
  loading: boolean
  accountType: AccountType
  shops: Shop[]
  currentShopId: string | null
  setCurrentShopId: (id: string) => void
  needsOnboarding: boolean
  login: (email: string, password: string) => Promise<{ error: string | null }>
  logout: () => Promise<void>
  isAdmin: () => boolean
  isManager: () => boolean
  isCashier: () => boolean
  hasPermission: (permission: string) => boolean
  refreshShops: () => Promise<void>
}

// Fixed permission set for every manager account, scoped to their one
// assigned shop by the RoleProvider/RLS layer — not per-manager granular.
export const MANAGER_PERMISSIONS = [
  "store_settings",
  "pos_access",
  "inventory_view",
  "inventory_edit",
  "customer_management",
  "sales_returns",
  "purchase_returns",
  "analytics_view",
  "system_config_limited",
]

const CURRENT_SHOP_STORAGE_KEY = "mpos_current_shop_id"

const RoleContext = createContext<RoleContextType | undefined>(undefined)

export function RoleProvider({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()

  const [user, setUser] = useState<AppUser | null>(null)
  const [accountType, setAccountType] = useState<AccountType>(null)
  const [shops, setShops] = useState<Shop[]>([])
  const [currentShopId, setCurrentShopIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  function setCurrentShopId(id: string) {
    setCurrentShopIdState(id)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURRENT_SHOP_STORAGE_KEY, id)
    }
  }

  async function loadIdentity(supaUser: SupabaseUser | null) {
    if (!supaUser) {
      setUser(null)
      setAccountType(null)
      setShops([])
      setCurrentShopIdState(null)
      setLoading(false)
      return
    }

    const fallbackName =
      (supaUser.user_metadata?.fullName as string | undefined) ||
      (supaUser.user_metadata?.name as string | undefined) ||
      supaUser.email ||
      "User"

    // Ensure a public.users profile row exists (id mirrors auth.users.id).
    // Only created if missing — never overwrites an existing row's role.
    const { data: existingProfile } = await supabase
      .from("users")
      .select("id, full_name, role")
      .eq("id", supaUser.id)
      .maybeSingle()

    if (!existingProfile) {
      await supabase.from("users").insert([
        {
          id: supaUser.id,
          full_name: fallbackName,
          email: supaUser.email ?? "",
          phone: (supaUser.user_metadata?.phone as string | undefined) || null,
          role: "owner",
        },
      ])
    }

    const { data: memberships } = await supabase
      .from("user_organizations")
      .select(
        "role, organizations(id, name, address, phone, phone_secondary, receipt_watermark, receipt_footer_bn, receipt_footer_en)"
      )
      .eq("user_id", supaUser.id)

    const resolvedShops: Shop[] = (memberships ?? [])
      .map((m) => m.organizations as unknown as Shop)
      .filter(Boolean)

    let type: AccountType
    if (memberships?.some((m) => m.role === "owner")) {
      type = "owner"
    } else if (memberships?.some((m) => m.role === "manager")) {
      type = "manager"
    } else {
      // No memberships yet: a brand-new owner account that still needs
      // to create their first organization.
      type = "owner"
    }

    setUser({
      id: supaUser.id,
      name: existingProfile?.full_name ?? fallbackName,
      email: supaUser.email ?? "",
      role: type,
    })
    setAccountType(type)
    setShops(resolvedShops)

    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(CURRENT_SHOP_STORAGE_KEY) : null
    const validStored = stored && resolvedShops.some((s) => s.id === stored) ? stored : null
    setCurrentShopIdState(validStored ?? resolvedShops[0]?.id ?? null)

    setLoading(false)
  }

  async function refreshShops() {
    const {
      data: { user: supaUser },
    } = await supabase.auth.getUser()
    await loadIdentity(supaUser)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: supaUser } }) => {
      loadIdentity(supaUser)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      loadIdentity(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const needsOnboarding = !loading && accountType === "owner" && shops.length === 0

  useEffect(() => {
    if (needsOnboarding && pathname !== "/onboarding") {
      router.push("/onboarding")
    }
  }, [needsOnboarding, pathname, router])

  async function login(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function logout() {
    await supabase.auth.signOut()
    // Hard redirect: guarantees every in-memory context/query cache is
    // dropped, not just the auth state.
    window.location.href = "/login"
  }

  function isAdmin() {
    return accountType === "owner"
  }

  function isManager() {
    return accountType === "manager"
  }

  function isCashier() {
    return false
  }

  function hasPermission(permission: string) {
    if (accountType === "owner") return true
    if (accountType === "manager") return MANAGER_PERMISSIONS.includes(permission)
    return false
  }

  const value: RoleContextType = {
    user,
    loading,
    accountType,
    shops,
    currentShopId,
    setCurrentShopId,
    needsOnboarding,
    login,
    logout,
    isAdmin,
    isManager,
    isCashier,
    hasPermission,
    refreshShops,
  }

  // Hold the app back until we know who the user is and which shop is
  // active. Without this, every data component mounts with a null
  // currentShopId and immediately fires queries filtered on
  // `organization_id=eq.null`, which Postgres rejects as an invalid
  // uuid — a burst of console errors on every page load, and a visible
  // flash of empty tables before the real data arrives.
  if (loading) {
    return (
      <RoleContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </RoleContext.Provider>
    )
  }

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole(): RoleContextType {
  const context = useContext(RoleContext)

  if (context === undefined) {
    // Fail closed (no access) rather than the old fail-open ("always
    // admin") fallback — an accidentally-unwrapped consumer should lose
    // access, not silently gain full permissions.
    return {
      user: null,
      loading: false,
      accountType: null,
      shops: [],
      currentShopId: null,
      setCurrentShopId: () => {},
      needsOnboarding: false,
      login: async () => ({ error: "RoleProvider is not mounted" }),
      logout: async () => {},
      isAdmin: () => false,
      isManager: () => false,
      isCashier: () => false,
      hasPermission: () => false,
      refreshShops: async () => {},
    }
  }

  return context
}
