/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
    /**
     * Client Router Cache for force-dynamic role apps:
     * - `static` applies when Link/router.prefetch({true}) warmed a route
     *   (NavPrefetcher + sidebar prefetch={true}). Longer window = layout
     *   chrome stays put and pages swap without re-running loading UI.
     * - `dynamic` covers non-prefetched soft navigations.
     */
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
  // CSP deferred: Next.js App Router relies on inline scripts/styles that make a
  // strict CSP non-trivial without nonces/hashes. Tracked in docs/backlog.md.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
