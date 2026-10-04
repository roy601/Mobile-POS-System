import { defineCloudflareConfig } from "@opennextjs/cloudflare"

/**
 * How this app is built for Cloudflare Workers.
 *
 * WHY IT NEEDS ALMOST NOTHING
 *
 * Nearly the whole system is a client-side app talking straight to
 * Supabase. The only things that run on a server are one auth route
 * (/auth/confirm) and the middleware that verifies the session — no
 * server actions, no Node libraries, nothing to cache or revalidate.
 *
 * So no incremental cache and no tag cache are configured: there is no
 * server-rendered content to hold on to, and adding a KV binding for
 * nothing would be a bill and a moving part for no benefit.
 *
 * The middleware is the one piece that MUST keep working. It checks
 * every request against Supabase and redirects anyone without a valid
 * session to /login, which is what stops the shop's figures being one
 * guessed URL away from anybody.
 */
export default defineCloudflareConfig()
