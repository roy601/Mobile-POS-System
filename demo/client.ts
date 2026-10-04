/**
 * What the app gets instead of a Supabase client.
 *
 * Same surface the app uses — from(), rpc(), auth, functions — but
 * answered from demo/db.ts in the browser. There is no server, no
 * account and no network call anywhere behind it.
 */
import { QueryBuilder, ValueBuilder, ok } from "./query"
import { runRpc } from "./rpc"
import { DEMO_EMAIL, DEMO_NAME, DEMO_USER_ID } from "./seed"

const DEMO_USER = {
  id: DEMO_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: DEMO_EMAIL,
  phone: "",
  app_metadata: { provider: "email" },
  user_metadata: { fullName: DEMO_NAME },
  created_at: "2026-01-01T00:00:00.000Z",
}

const DEMO_SESSION = {
  access_token: "demo",
  refresh_token: "demo",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: DEMO_USER,
}

type AuthListener = (event: string, session: typeof DEMO_SESSION | null) => void
const listeners = new Set<AuthListener>()

const notInDemo = (what: string) => ({
  data: { user: null, session: null },
  error: { name: "DemoError", message: `${what} is switched off in this demo. You are already signed in as the demo owner.`, status: 400 },
})

const auth = {
  // The demo is always signed in: there is nobody else to be.
  async getUser() {
    return { data: { user: DEMO_USER }, error: null }
  },
  async getSession() {
    return { data: { session: DEMO_SESSION }, error: null }
  },
  onAuthStateChange(cb: AuthListener) {
    listeners.add(cb)
    return { data: { subscription: { id: "demo", callback: cb, unsubscribe: () => listeners.delete(cb) } } }
  },
  async signInWithPassword() {
    for (const cb of listeners) cb("SIGNED_IN", DEMO_SESSION)
    return { data: { user: DEMO_USER, session: DEMO_SESSION }, error: null }
  },
  async signOut() {
    // Leaving the demo just goes back to the sign-in screen; signing in
    // again with anything at all comes straight back.
    return { error: null }
  },
  async signUp() {
    return notInDemo("Creating an account")
  },
  async resetPasswordForEmail() {
    return notInDemo("Password reset")
  },
  async updateUser() {
    return notInDemo("Changing the password")
  },
  async verifyOtp() {
    return notInDemo("Email confirmation")
  },
  async refreshSession() {
    return { data: { user: DEMO_USER, session: DEMO_SESSION }, error: null }
  },
}

const functions = {
  async invoke(_name: string) {
    return {
      data: null,
      error: { name: "DemoError", message: "Managing staff accounts is switched off in this demo." },
    }
  },
}

function channel() {
  const ch: any = {
    on: () => ch,
    subscribe: () => ch,
    unsubscribe: async () => "ok",
  }
  return ch
}

let client: any = null

export function createDemoClient() {
  client ??= {
    from: (table: string) => new QueryBuilder(table),
    rpc: (name: string, args?: Record<string, any>) => new ValueBuilder(() => runRpc(name, args)),
    auth,
    functions,
    channel,
    removeChannel: async () => "ok",
    removeAllChannels: async () => [],
    storage: {
      from: () => ({
        upload: async () => ok(null),
        download: async () => ok(null),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  }
  return client
}
