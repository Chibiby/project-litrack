# Deployment — Cloudflare Workers + Supabase

## Overview

LITRACK is a Next.js 16 App Router app (React 19). Production hosting target: **Cloudflare
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
   performs the ordinary `prisma generate && next build --turbopack` inside it. Without `WORKERS_CI`,
   the same command is a plain Next build — that is what CI and local verification run. Both use
   Turbopack; to fall back to webpack, change that flag to `--webpack` (the `webpack()` hook in
   `next.config.mjs` is kept for exactly that).
2. Deploy command: `npx wrangler deploy`. Configuration lives in `wrangler.jsonc`.
3. Bindings (`wrangler.jsonc`):
   - `ASSETS` — static assets from `.open-next/assets`.
   - `HYPERDRIVE` — pooled Postgres in front of Supabase. `src/lib/prisma.ts` reads its
     `connectionString` **per request**; resolving it once at module scope silently falls back to
     `DATABASE_URL` for the isolate's whole life, because `getCloudflareContext()` throws outside a
     request. **This binding's origin is the production database.** `.env.local` has held a
     different Supabase project, so `npx wrangler hyperdrive list` — not a local env file — is what
     says which database production reads. See `docs/migrate-checklist.md` § (b); getting this
     wrong took End of Terms down on 2026-09-17.
   - `HYPERDRIVE_FRESH` — a second Hyperdrive config (`litrack-supabase-fresh`) on the same
     database with **query caching disabled**, origin Supabase's direct host, origin connection
     limit 5. `HYPERDRIVE` caches reads for about a minute, so a page that re-reads what it just
     wrote showed the old value; `prismaFresh` in `src/lib/prisma.ts` connects through this
     binding instead. Only the School Head teachers workspace (`/school-head/teachers/**`, its
     roster helpers, and the actions it calls) uses it today. Without the binding, `prismaFresh`
     falls back to `HYPERDRIVE`.
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
   - `NOTIFICATION_READ_RETENTION_DAYS` (default 90), `NOTIFICATION_RETENTION_DAYS` (default 180),
     `AUDIT_LOG_RETENTION_DAYS` (default 730, never below 90) — optional. The daily cron deletes
     read notifications, then any notification, then audit rows older than these (by creation
     time). Unset means the default; `0` or anything unparseable switches that rule **off**. See
     "Retention" below.
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
an unset secret means no backups, silently, forever. The daily run also runs retention (below)
**before** the snapshot, so a failed backup never stops it.

#### How a backup is written (format v2)

`backUpDatabase` (`src/lib/db/snapshot.ts`) streams. Each table in `WRITE_ORDER` is read 2,000 rows
at a time by keyset pagination on its primary key (`KEYSET_KEYS` in
`src/lib/db/snapshot-format.ts` for the composite ones), written as NDJSON, gzipped through
`CompressionStream`, and uploaded to Vercel Blob with the manual multipart API
(`saveBackupStream` in `src/lib/db/backup-store.ts`), one 8 MiB part at a time. The stream is
pull-driven, so a slow upload pauses the database reads. Peak memory is one page of rows plus
one upload part (well under 30 MB), whatever the database size. The SDK's own
`put(..., { multipart: true })` is deliberately not used: it reads ahead up to 128 MB.

Reads go through `prismaFresh`, not the cached Hyperdrive binding, so a backup is never a
minute-old cache. A backup smaller than one part is sent as a single `put`. The file only appears
when the upload completes, so a run that dies midway leaves the previous file in its slot. The
parts it had already uploaded are **orphaned**, though. `@vercel/blob` 2.8 has no abort call, so
they stay in the store, unlisted and unreadable, and they count toward its storage until Vercel
expires incomplete uploads. A run of repeated failures is worth a look at the store's usage.

A restore's safety snapshot is written **without pruning**. The `safety` slot keeps one file,
and the file being restored may be that one. The slot is pruned only after the restore commits.
A failed restore leaves both files, and the next safety snapshot prunes them.

The file is `litrack/backups/<kind>/<stamp>.ndjson.gz`: a header line
(`{"format":"litrack-snapshot","version":2,…}`), then per table `["table",M]`, one `["row",{…}]`
per row, and `["end",M,count]`, then the `_TeacherGrades` join table, then a `["footer",…]`
with every count. Restore refuses a file with no footer, a count mismatch, tables out of insert
order, or a missing table.

Restore (Super Admin only, typed `RESTORE`, safety snapshot first, all unchanged) reads the file
twice. The first pass validates it end to end, holding one line at a time, before anything is
deleted. The second pass streams it inside the single restore transaction (timeout 240 s),
inserting 1,000 rows per `createMany`. Any problem in the second pass throws and rolls back.
**v1 files** (`*.json.gz`, one JSON document) are still listed, downloaded and restored. The
format is detected from content, not the file name. A v1 file is parsed whole, which is the old
format's memory cost, and nothing writes v1 any more. Downloads stream the blob straight through.

`AuditLog` stays out of snapshots (`inSnapshot: false`). Streaming would now fit it. It stays out
because a restore that rewrote the audit trail would erase the record of the restore itself.

#### Retention

`runDailyRetention` (`src/lib/retention/purge.ts`) runs on the daily cron, after the `ErrorEvent`
purge. It applies three rules in this order: read notifications past
`NOTIFICATION_READ_RETENTION_DAYS`, any notification past `NOTIFICATION_RETENTION_DAYS`, and
audit rows past `AUDIT_LOG_RETENTION_DAYS`. Each rule deletes in statements of at most 5,000 rows
(`DELETE … WHERE id IN (SELECT id … LIMIT 5000)`), with at most 20 statements per rule per run.
A larger backlog drains over the following nights and shows `"capped": true`. Each rule reports
`ran` / `disabled` / `failed` and its deleted count in the cron's JSON response, and in a
`[cron/backup] retention` line in Workers Logs. Counts only, never row content. A failing rule
does not stop the others or the backup.

Purged audit rows are **not recoverable from these backups** (AuditLog is not in them); only
Supabase PITR predates a purge. That is why `AUDIT_LOG_RETENTION_DAYS` has a 90-day floor.

Verify after a deploy: `npx wrangler tail --format pretty` and wait for a scheduled run, or trigger
one against the deployed Worker with `curl -H "Authorization: Bearer $CRON_SECRET"
"$NEXT_PUBLIC_APP_URL/api/cron/backup?kind=daily"`.

### Data Cache and placement

`open-next.config.ts` backs Next's Data Cache with Workers KV (`NEXT_INC_CACHE_KV`, namespace
`litrack-next-cache`) and a D1 tag cache (`NEXT_TAG_CACHE_D1`, database `litrack-tag-cache`, table
`revalidations`). So `cachedQuery` (`src/lib/cache/unstable.ts`) caches across requests and the
`src/lib/cache/revalidate.ts` helpers invalidate. KV is eventually consistent, but every read checks
its tags against D1, so a revalidated entry is a miss at once. KV is used instead of R2 because R2
is not enabled on the account.

`wrangler.jsonc` pins the Worker with targeted placement to `aws:ap-southeast-1`, next to the
Supabase project. This replaces the Vercel `sin1` pin described in the appendix.

### Known gaps

Carried over from the Vercel cutover and not yet closed:

- **Rate limiting is per-isolate.** Without `UPSTASH_REDIS_REST_URL` / `_TOKEN`,
  `src/lib/rate-limit.ts` uses an in-memory window. Workers spread requests across many isolates, so
  the login throttle bounds far less than it appears to. See `docs/runbook.md`.
- **Backups still live in Vercel Blob** (`src/lib/db/backup-store.ts`), which keeps the Vercel
  account load-bearing after the move. R2 is the obvious replacement.
- **Streaming backups are unproven in production.** Backups used to fail with error 1102
  (`exceededMemory`) because `createSnapshot` built all ~111 MB in one isolate. They now stream
  (see "How a backup is written"), but no run has completed on Workers yet. On the first
  scheduled run, check Workers Logs for `[cron] run ok`, and check `/admin/database` for a
  `.ndjson.gz` file. Things that could still bite:
  - the multipart Blob API has not been exercised from a Worker, and `@vercel/blob` imports
    `undici`;
  - each page query is a new Hyperdrive connection (`maxUses: 1`), roughly 100 per run, and
    those count against the Worker's subrequest limit;
  - a restore streams the file inside a 240 s transaction.

  Supabase PITR remains the real disaster recovery.
- **Heavy report paths are unverified on Workers.** `pdfkit` is bundled into the Worker rather than
  left external (see the comment in `next.config.mjs`), and `exceljs` exports are large jobs in
  an isolate that is capped at 128 MB. `maxDuration` means nothing here; Workers enforce CPU and
  memory limits instead, and the old backup showed that memory is the one that bites first.
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
