import type { SupabaseClient } from '@supabase/supabase-js'
import { createDemoClient } from '@/demo/client'

/**
 * DEMO BUILD: the server side only ever asks who is signed in, and in
 * the demo that is always the demo owner.
 */
export async function createClient() {
  return createDemoClient() as SupabaseClient<any>
}
