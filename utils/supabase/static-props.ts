import type { SupabaseClient } from '@supabase/supabase-js'
import { createDemoClient } from '@/demo/client'

/** DEMO BUILD: see utils/supabase/component.ts. */
export function createClient() {
  return createDemoClient() as SupabaseClient<any>
}
