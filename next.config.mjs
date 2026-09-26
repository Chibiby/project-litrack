import { builtinModules } from "node:module";

const isCloudflareWorkersBuild = process.env.WORKERS_CI === "1";
const cloudflareNodeExternals = Object.fromEntries(
  builtinModules
    .filter((name) => !name.startsWith("node:"))
    .map((name) => [name, `commonjs node:${name}`]),
);

/** @type {import('next').NextConfig} */
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
   * Cloudflare only: `wrangler.jsonc` defines no `IMAGES` binding, so
   * OpenNext's `/_next/image` handler (`@opennextjs/cloudflare/dist/cli/
   * templates/images.js`) falls into its `env.IMAGES === undefined` branch —
   * it still fetches the original file through `env.ASSETS.fetch` (a Worker
   * invocation) and returns it byte-for-byte, with none of the Cache-Control
   * handling that direct static-asset requests get. Every `next/image` request
   * was therefore a full Worker invocation serving the uncompressed original,
   * uncacheable by the browser. `unoptimized: true` makes next/image render a
   * plain `<img src>` with no `srcSet`/`sizes` (see `generateImgAttrs` in
   * `next/dist/shared/lib/get-img-props.js`), so the request goes straight to
   * Workers Static Assets and bypasses the Worker entirely. Local dev and
   * Vercel keep the real optimizer.
   */
  images: isCloudflareWorkersBuild ? { unoptimized: true } : undefined,
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
    ? // `pg-cloudflare` is pg's workerd socket shim. Once Prisma resolves to its
      // Workers client (see scripts/relink-standalone-externals.mjs), OpenNext's
      // esbuild pass reaches `require("pg-cloudflare")` and cannot bundle it;
      // leaving it external lets wrangler resolve it with the workerd condition.
      ["@prisma/client", ".prisma/client", "@prisma/adapter-pg", "pg", "pg-cloudflare"]
    : ["pdfkit"],
  /**
   * ROLLBACK PATH ONLY since Next 16. Both builds run Turbopack
   * (`next build --turbopack` in scripts/build-platform.mjs), which ignores
   * this hook. Turbopack needs neither half: it compiled the edge bundle without
   * following `pg` into its fs/path loaders, and it leaves Node built-ins
   * external on the server by itself (verified: standard build, OpenNext build,
   * and the Worker serving /login under `wrangler dev`). `turbopack.resolveAlias`
   * could not have ported the edge alias anyway — it supports only the `browser`
   * condition. Keep this hook until Turbopack has run in production; switching
   * that flag to `--webpack` restores the Next 15 build exactly.
   */
  webpack(config, { isServer, nextRuntime }) {
    /**
     * `src/instrumentation.ts` is compiled for the EDGE runtime as well as node,
     * and `onRequestError` reaches `src/lib/prisma.ts` through
     * `lib/errors/request-error` → `lib/errors/report`. That import is already
     * guarded at runtime (`NEXT_RUNTIME !== "nodejs"` returns first) and is
     * `await import(...)`, but a guard is a check, not module-graph pruning:
     * webpack still RESOLVES the branch, follows `pg` into its optional
     * certificate/passfile loaders (`pg/lib/connection-parameters.js`,
     * `pgpass`), and fails the whole build on `fs`/`path`/`stream`, which the
     * edge target has no shim for.
     *
     * `serverExternalPackages` does not help — it governs the node server
     * bundle, not the edge compile. Cutting the edge module graph at `pg` is
     * what works, and it is safe because nothing that legitimately runs on edge
     * touches Prisma: middleware goes through `src/lib/auth/roles.ts`, the
     * deliberately Edge-safe half (see CLAUDE.md § Request path). If something
     * on edge ever does import Prisma, it SHOULD fail — this alias turns a
     * confusing `fs` resolution error into an immediate missing-module one at
     * the real call site.
     *
     * The Cloudflare production build never hit this: it lists `pg` in
     * `serverExternalPackages` and externalizes node builtins below, so the
     * breakage only ever showed in `npm run build`, the CI gate — which has been
     * billing-locked since 2026-08-14 and so went unnoticed.
     */
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...config.resolve.alias,
        pg: false,
        pgpass: false,
        "@prisma/adapter-pg": false,
      };
    }
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
