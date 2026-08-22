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
`ap-southeast-1`, also Singapore, and functions default to a US region, so without this pin every
database round trip crosses the Pacific — roughly 200 ms each, on a path that pays at least two
sequential round trips per authenticated render. Co-locating the two is the single largest latency
win available to this app, and it is worth far more than any query-level optimisation.

Two things to know before changing it:

- **`sin1` bills at 1.5× the US rates.** That is the deliberate trade: a small compute premium for
  a large, uniform latency reduction on every authenticated page.
- **This file is the only thing pinning the region.** Deleting `vercel.json`, or overriding the
  region in the Vercel dashboard, silently moves functions back across the Pacific — the app keeps
  working and simply gets slow again, with no error to notice. If page latency regresses sharply
  after a config change, check this first.

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
