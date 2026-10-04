import type { SupabaseClient } from '@supabase/supabase-js'
import { createDemoClient } from '@/demo/client'

declare global {
  interface Window {
    electronSecureStore?: {
      isAvailable: () => Promise<boolean>
      getItem: (key: string) => Promise<string | null>
      setItem: (key: string, value: string) => Promise<boolean>
      removeItem: (key: string) => Promise<boolean>
    }
  }
}

/**
 * DEMO BUILD: there is no Supabase here. Every screen gets the
 * in-browser demo database (see demo/), typed as the real client so
 * the rest of the app compiles unchanged.
 */
export function createClient() {
  return createDemoClient() as SupabaseClient<any>
}
