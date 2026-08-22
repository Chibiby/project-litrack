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
