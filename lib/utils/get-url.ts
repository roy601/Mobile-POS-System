// Resolves the base URL to use for Supabase email redirect links.
// window.location.origin is preferred (and checked first) because this
// app also runs inside Electron against a dynamically-chosen local
// port, not a fixed domain, so a static env var can't be trusted alone.
export function getURL() {
  let url =
    (typeof window !== "undefined" ? window.location.origin : undefined) ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"

  url = url.startsWith("http") ? url : `https://${url}`
  return url.endsWith("/") ? url : `${url}/`
}
