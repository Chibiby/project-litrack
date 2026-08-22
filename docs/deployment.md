# Deployment — Vercel + Supabase

## Overview

LITRACK is a Next.js 14 App Router app. Production hosting target: **Vercel**. Database and Auth: **Supabase**.

## Preconditions

1. GitHub repo connected to Vercel.
2. Supabase project provisioned (Auth + Postgres).
3. Env vars configured in Vercel (same **names** as `.env.example` — never commit values).
4. Prisma migrations reviewed; deploy to production DB only with explicit approval.

## Vercel setup

1. Import the repository; framework preset: Next.js.
2. Build command uses `package.json` → `prisma generate && next build`.
3. Add environment variables (Production / Preview as appropriate):
   - `DATABASE_URL`, `DIRECT_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` (production site URL)
   - `SYNTHETIC_EMAIL_DOMAIN`
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (required for real invite/recovery email)
   - `NEXT_OTEL_VERBOSE` — optional, debugging only. Read by Next.js itself, not app code;
     set to `1` to emit verbose OpenTelemetry spans (including internal framework spans).
     Leave unset in Production; it is very noisy.
   - Seed vars are **not** required on Vercel unless you run seed from CI (prefer local/one-off)
4. Deploy. Confirm build logs show Prisma generate + Next build success.

### Function region — `sin1`

`vercel.json` pins Vercel Functions to `sin1` (Singapore). The Supabase project lives in
`ap-southeast-1`, also Singapore, and functions default to a US region — `iad1` (Washington D.C.)
unless changed — so without this pin every database round trip crosses the Pacific. The design spec
puts that at roughly 200 ms per round trip (from a community AWS latency matrix, not an AWS-official
figure), on a path that pays at least two sequential round trips per authenticated render. The
measured baseline is what will confirm the real figure.

Four things to know before changing it:

- **This file is the only thing pinning the region.** Delete or rename it, add a `vercel.ts`
  (a project may have only one config file), add a per-function `regions` block, pass `--regions`
  to `vercel deploy`, or point the project's Root Directory somewhere other than the repo root, and
  functions move back across the Pacific — the app keeps working and simply gets slow again, with no
  error to notice. If page latency regresses sharply after a config change, check this first.
- **Compute in `sin1` costs 1.25× `iad1`,** not 1.5×: Active CPU $0.160/hr vs $0.128/hr and
  Provisioned Memory $0.0133 vs $0.0106 per GB-hr
  ([fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)). CDN line items are
  ~1.30× (Edge Requests $2.60 vs $2.00 per million; ISR / Runtime Cache writes $5.20 vs $4.00) and
  Fast Data Transfer ~1.07× ($0.16 vs $0.15 per GB). Those are Pro on-demand rates; Hobby bills flat
  included allowances with no regional rates, so on Hobby the region carries no direct billing
  consequence.
- **Part of that premium pays for itself, though the net is unmeasured.** Vercel bills Active CPU
  only while your code actually runs and pauses it during I/O, but bills Provisioned Memory for the
  whole instance lifetime *including* I/O waits. This app is I/O-bound on Postgres, so today it pays
  memory for every cross-Pacific wait. Co-locating shortens those waits and so shortens the billed
  instance lifetime: CPU cost rises ~25% while memory-hours fall. Confirm the direction against a
  real invoice rather than trusting this paragraph.
- **Keep it to exactly one region.** Hobby permits a single region, and requesting more than the plan
  allows fails the deployment before the build starts. Do not "improve" this into a multi-region array.

The pin does **not** cover everything. Routing Middleware deploys to all regions regardless of region
settings, and static assets come from the CDN edge — so `src/middleware.ts` runs wherever the request
lands. That costs nothing today because `src/lib/supabase/middleware.ts` verifies JWT claims locally,
but on a project still using legacy HS* symmetric signing keys that call falls back to a network
`getUser()` and reaches Singapore from an unpinned region.

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

- App: redeploy previous Vercel deployment.
- DB: Prisma has no automatic down migrations — restore from Supabase backup / PITR or ship a forward-fix migration. See `docs/runbook.md`.
