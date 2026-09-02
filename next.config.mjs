/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Defaults to `.next`. Override with `NEXT_BUILD_DIST_DIR=.next-verify` to run
   * a verification `next build` while `next dev` is running — otherwise the two
   * fight over `.next` (EPERM on Windows) and the build clobbers the dev cache.
   * Keep `.next-verify` out of git.
   *
   * Side effect: Next rewrites `tsconfig.json` and `next-env.d.ts` to reference
   * whatever dist dir it built into, so `git checkout -- tsconfig.json
   * next-env.d.ts` after a scratch build to drop the churn.
   */
  distDir: process.env.NEXT_BUILD_DIST_DIR || ".next",
  /**
   * Left for Node to require at runtime instead of being bundled into the
   * server chunk.
   *
   * `pdfkit` reads its font metrics and its sRGB ICC profile from files inside
   * its own package, resolved relative to `__dirname`. Bundled, that path no
   * longer exists and every PDF fails at draw time with an ENOENT the user
   * sees as "Could not generate the report" — while Excel, which needs no data
   * files, keeps working. Externalising it also keeps `fontkit`'s own binary
   * data intact. Verified: the same code renders a valid PDF under plain Node.
   */
  serverExternalPackages: ["pdfkit"],
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
    /**
     * Client Router Cache for force-dynamic role apps:
     * - `static` applies when Link/router.prefetch kind `full` (or
     *   prefetch={true}) warmed a route. Longer window = previously visited
     *   pages swap without re-fetch / loading.tsx flash.
     * - `dynamic` covers non-prefetched soft navigations.
     */
    staleTimes: {
      dynamic: 180,
      static: 600,
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
