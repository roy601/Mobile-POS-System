import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { RoleProvider } from "@/components/role-provider"
import { SubscriptionProvider } from "@/components/subscription-provider"
import { SubscriptionBanner } from "@/components/subscription-banner"
import { NumberInputGuard } from "@/components/number-input-guard"
import { DemoBanner } from "@/components/demo-banner"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Mobile POS - Point of Sale System",
  description: "Complete mobile point of sale system for retail businesses",
  generator: 'v0.dev',
  // iOS reads these rather than the manifest for a home-screen app, so
  // without them "Add to Home Screen" on an iPad opens a browser tab
  // with an address bar instead of the app on its own.
  appleWebApp: {
    capable: true,
    title: "Mobile POS",
    statusBarStyle: "default",
  },
}

/**
 * `viewport-fit=cover` fills an iPad's screen edge to edge; without
 * `maximumScale` a tap on a small field zooms the whole page in on iOS
 * and leaves the shop pinching to get back out.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#166534",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <RoleProvider>
            <SubscriptionProvider>
              {/* A scroll over a focused money box used to take 0.01
                  off it. Mounted here because every screen that takes
                  a figure is downstream of this point. */}
              <NumberInputGuard />
              <DemoBanner />
              {/* Sits above every screen: a shop must not discover its
                  subscription lapsed by having a sale refused. */}
              <SubscriptionBanner />
              {children}
              <Toaster />
              <SonnerToaster />
            </SubscriptionProvider>
          </RoleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
