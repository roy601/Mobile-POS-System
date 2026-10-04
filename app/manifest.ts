import type { MetadataRoute } from "next"

/**
 * Lets the owner keep this on an iPad home screen.
 *
 * The shop's till is the installed desktop app; this is the same system
 * reached from a browser so the owner can look at the figures and make
 * owner-only changes without a laptop. "Add to Home Screen" on iPad
 * then opens it as its own window — no address bar, no browser tabs —
 * which matters on a device that will be handed around.
 *
 * `display: standalone` is what iOS reads for that. Everything else
 * here is what the home-screen icon and splash use.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mobile POS",
    short_name: "Mobile POS",
    description: "Shop accounts, stock and sales",
    start_url: "/main",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#166534",
    icons: [
      {
        src: "/icon.png",
        sizes: "256x256",
        type: "image/png",
        purpose: "any",
      },
    ],
  }
}
