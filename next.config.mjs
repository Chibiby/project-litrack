import { builtinModules } from "node:module";

/** @type {import('next').NextConfig} */
const isCloudflareWorkersBuild = process.env.WORKERS_CI === "1";
const cloudflareNodeExternals = Object.fromEntries(
  builtinModules
    .filter((name) => !name.startsWith("node:"))
    .map((name) => [name, `commonjs node:${name}`]),
);

const nextConfig = {
  // Keep standalone tracing anchored to this checkout. This matters in local
  // git worktrees (where a parent checkout has another lockfile) and is a
  // no-op in Cloudflare's single-repository build environment.
  outputFileTracingRoot: process.cwd(),
  /**
   * Expose only a non-sensitive deployment target marker. Next inlines values
   * declared in `env`, which lets server instrumentation dead-code-eliminate
   * Vercel-only imports from the Cloudflare/OpenNext production bundle.
   */
  env: {
    LITRACK_DEPLOY_TARGET: isCloudflareWorkersBuild
      ? "cloudflare"
      : process.env.VERCEL === "1"
        ? "vercel"
        : "local",
  },
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
   * On Vercel/plain Node, leave pdfkit external so it can resolve its package
   * data files relative to __dirname. Cloudflare Workers has no normal Node
   * module/filesystem loader; leaving the package external there can make
   * OpenNext's server bootstrap fail while resolving Node built-ins. Bundle it
   * into the Worker instead. PDF generation itself may still need a Workers-
   * compatible implementation if a report exercises filesystem-only pdfkit
   * paths, but it must not prevent /login from starting.
   */
  serverExternalPackages: isCloudflareWorkersBuild
    ? ["@prisma/client", ".prisma/client", "@prisma/adapter-pg", "pg"]
    : ["pdfkit"],
  webpack(config, { isServer }) {
    if (isCloudflareWorkersBuild && isServer) {
      // `pg` keeps optional certificate/passfile support behind Node built-ins.
      // Leave those imports for OpenNext's final workerd bundle, where
      // `nodejs_compat` provides them, instead of asking Next's webpack pass to
      // resolve browser shims that do not exist.
      config.externals.push(cloudflareNodeExternals);
    }
    return config;
  },
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
