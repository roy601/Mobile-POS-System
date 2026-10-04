"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useRole } from "./role-provider"
import { Loader2 } from "lucide-react"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user } = useRole()
  const pathname = usePathname()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Allow access to login page without authentication
    if (pathname === "/login") {
      setIsLoading(false)
      return
    }

    // Check if user is authenticated
    if (!user) {
      router.push("/login")
      return
    }

    setIsLoading(false)
  }, [user, pathname, router])

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // If on login page, show children (login form)
  if (pathname === "/login") {
    return <>{children}</>
  }

  // If not authenticated and not on login page, don't render anything
  // (router.push will handle the redirect)
  if (!user) {
    return null
  }

  // If authenticated, show the protected content
  return <>{children}</>
}
