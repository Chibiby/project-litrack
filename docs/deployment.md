# Deployment — Cloudflare Workers + Supabase

## Overview

LITRACK is a Next.js 15 App Router app (React 19). Production hosting target: **Cloudflare
Workers**, built with [OpenNext](https://opennext.js.org/cloudflare). Database and Auth:
**Supabase**.

The app was originally deployed to Vercel. `vercel.json` and the Vercel-only observability path in
`src/instrumentation.node.ts` are still in the repository so a Vercel deploy remains possible, but
Cloudflare is the target that is maintained. `next.config.mjs` inlines `LITRACK_DEPLOY_TARGET`
(`cloudflare` when `WORKERS_CI=1`, else `vercel` or `local`), which is what lets the Worker bundle
drop the Vercel-only code paths at build time.

## Preconditions

1. GitHub repo connected to Cloudflare Workers Builds, with `WORKERS_CI=1` in the build environment.
2. Supabase project provisioned (Auth + Postgres).
3. Secrets configured on the Worker (same **names** as `.env.example` — never commit values).
4. Prisma migrations reviewed; deploy to production DB only with explicit approval.

## Cloudflare setup

1. Build command: `npm run build`. With `WORKERS_CI=1` set, `scripts/build-platform.mjs` runs
   `opennextjs-cloudflare build`, which re-enters the same script with `OPENNEXT_INNER_BUILD=1` and
   performs the ordinary `prisma generate && next build` inside it. Without `WORKERS_CI`, the same
   command is a plain Next build — that is what CI and local verification run.
2. Deploy command: `npx wrangler deploy`. Configuration lives in `wrangler.jsonc`.
3. Bindings (`wrangler.jsonc`):
   - `ASSETS` — static assets from `.open-next/assets`.
   - `HYPERDRIVE` — pooled Postgres in front of Supabase. `src/lib/prisma.ts` reads its
     `connectionString` **per request**; resolving it once at module scope silently falls back to
     `DATABASE_URL` for the isolate's whole life, because `getCloudflareContext()` throws outside a
     request.
   - `triggers.crons` — scheduled backups, see below.
   - `keep_vars: true` — a deploy does not wipe variables set from the dashboard.
4. Secrets and variables (`npx wrangler secret put <NAME>`, or the dashboard):
   - `DATABASE_URL`, `DIRECT_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` (production site URL; also the origin the cron handler calls)
   - `SYNTHETIC_EMAIL_DOMAIN`
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (required for real invite/recovery email, and for
     server-side error alert email)
   - `CRON_SECRET` — required, or scheduled backups do not run. See below.
   - `BLOB_READ_WRITE_TOKEN` — backup storage. Still a Vercel Blob store; see "Known gaps".
   - `ERROR_ALERT_EMAIL` — comma-separated recipients for emails about server-side ("system"
     severity) failures. Alerts stay off until this and the two `RESEND_*` vars above are all
     set. At most one email per error code every 15 minutes. See `docs/errors.md`.
   - `ERROR_EVENT_RETENTION_DAYS` — optional, default 30. Days to keep rows in the `ErrorEvent`
     table before the daily backup cron (`/api/cron/backup`) purges them.
   - Seed vars are **not** required on the Worker — run seed locally as a one-off.
5. Deploy. Confirm build logs show OpenNext build + Prisma generate success, then
   `npx wrangler deployments list` and `npx wrangler tail` for the live Worker.

### Scheduled backups

Cron Triggers invoke a Worker's `scheduled()` handler; they cannot fetch a URL the way Vercel's
`crons` did. So `wrangler.jsonc` sets `main` to `worker.js`, which wraps the generated
`.open-next/worker.js`, and maps each cron expression onto the route that does the work:

| Expression (UTC) | Manila | Route |
| --- | --- | --- |
| `0 16 * * *` | 00:00 daily | `/api/cron/backup?kind=daily` |
| `30 16 * * 6` | 00:30 Sunday | `/api/cron/backup?kind=weekly` |

The two lists must stay in step — an expression in `wrangler.jsonc` with no entry in `worker.js`
fires and does nothing. The route authorizes itself against `CRON_SECRET` and **fails closed**, so
an unset secret means no backups, silently, forever. The daily run also purges expired `ErrorEvent`
rows.

Verify after a deploy: `npx wrangler tail --format pretty` and wait for a scheduled run, or trigger
one against the deployed Worker with `curl -H "Authorization: Bearer $CRON_SECRET"
"$NEXT_PUBLIC_APP_URL/api/cron/backup?kind=daily"`.

### Known gaps

Carried over from the Vercel cutover and not yet closed:

- **No incremental cache.** `open-next.config.ts` is a bare `defineCloudflareConfig()` with no
  `incrementalCache` or `tagCache`, and there is no KV/R2 binding. `cachedQuery`
  (`src/lib/cache/unstable.ts`) therefore no longer caches across requests and the
  `src/lib/cache/revalidate.ts` helpers are no-ops. Dashboard aggregates hit Postgres every load.
- **Rate limiting is per-isolate.** Without `UPSTASH_REDIS_REST_URL` / `_TOKEN`,
  `src/lib/rate-limit.ts` uses an in-memory window. Workers spread requests across many isolates, so
  the login throttle bounds far less than it appears to. See `docs/runbook.md`.
- **Backups still live in Vercel Blob** (`src/lib/db/backup-store.ts`), which keeps the Vercel
  account load-bearing after the move. R2 is the obvious replacement.
- **Heavy report paths are unverified on Workers.** `pdfkit` is bundled into the Worker rather than
  left external (see the comment in `next.config.mjs`), and `exceljs` exports plus the full-database
  snapshot are large CPU jobs. `maxDuration` means nothing here; Workers enforce CPU limits instead.
- **No `routes` in `wrangler.jsonc`.** If a custom domain serves the app, it is attached from the
  dashboard, and nothing in the repository records that.

### Appendix — the Vercel `sin1` pin

`vercel.json` still pins Vercel Functions to `sin1` (Singapore) because the Supabase project lives in
`ap-southeast-1` and functions otherwise default to `iad1` (Washington D.C.), putting the Pacific in
every database round trip. It is the only thing pinning the region, and only one region may be
listed. This matters only if the app is deployed to Vercel again; on Cloudflare, placement is
Cloudflare's and Hyperdrive is what shortens the database path.

## Database migrations (production)

Run from a trusted machine with production `DIRECT_URL` (port 5432), **after approval**:

```powershell
# Set DIRECT_URL / DATABASE_URL to production (session/direct), then:
npx prisma migrate deploy
```

Notes:

- Prefer direct connection for migrate; avoid transaction pooler (6543) for `migrate deploy`.
- If the remote DB predated `0_init`, baseline carefully (see `docs/migrations.md`).
- Optionally apply `prisma/rls-policies.sql` in the Supabase SQL Editor.

## Seed Super Admin (once)

With production env loaded locally (or a secure one-off job):

```powershell
npm run db:seed
```

Rotate the seed password immediately after first login.

## Post-deploy checks

- `/admin/login` and `/login` load
- Super Admin can list schools
- School Head activation login + forced password change
- Teacher invite accept path
- No secrets in client bundles (service role key server-only)

## Preview / staging

Use a Supabase preview branch or a separate project for non-production. Never point Preview deploys at production DB without a deliberate policy.

## Rollback pointers

- App: `npx wrangler rollback` (or redeploy a previous version from the Workers dashboard).
- DB: Prisma has no automatic down migrations — restore from Supabase backup / PITR or ship a forward-fix migration. See `docs/runbook.md`.
