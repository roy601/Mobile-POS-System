/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone is what the DESKTOP build needs: electron/main.js starts
  // .next/standalone/server.js on a local port and points the window at
  // it. Cloudflare must not have it — the Workers adapter does its own
  // bundling and trips over a standalone server it did not make.
  //
  // So the till keeps standalone, and only the Cloudflare build turns it
  // off. Same repo, same code, two targets.
  ...(process.env.CLOUDFLARE_BUILD ? {} : { output: 'standalone' }),

  // Do not ship source maps to customers — they reconstruct the
  // original TypeScript from the installed application.
  productionBrowserSourceMaps: false,

  // Type errors now fail the build.
  //
  // This was on while ten pre-existing errors were outstanding, and it
  // was not merely untidy: it hid a live bug where selecting a customer
  // from the search dialog silently dropped their phone number from the
  // sale and the receipt. Leaving it on means the next mistake of that
  // kind ships to a shop unnoticed, so it stays off.
  typescript: {
    ignoreBuildErrors: false,
  },

  images: {
    unoptimized: true,
  },

  poweredByHeader: false,
}

export default nextConfig
