# PROJECT LITRACK

Multi-tenant school management web app for DepEd schools to identify and track learners struggling with reading (ARAL program).

**Stack:** Next.js 14.2.28 (App Router), React 18.3.1, TypeScript (strict), Supabase (Auth + Postgres), Prisma 5, Tailwind CSS, shadcn/ui, React Hook Form + Zod, Resend (email), Recharts, papaparse + exceljs, Vitest + Playwright.

---

## Prerequisites

| Tool | Where to get it | Why |
|---|---|---|
| **Node.js 20 LTS** | https://nodejs.org/ | Runtime + `npm` |
| **Git** | https://git-scm.com/download/win | Version control |
| **Supabase project** | https://supabase.com/ | Postgres + Auth |
| **Resend account** (optional in dev) | https://resend.com/ | Invite / recovery emails |

```powershell
node --version   # v20.x recommended
npm --version
```

---

## Setup (first-time)

```powershell
npm install
copy .env.example .env.local
# Edit .env.local with Supabase + Resend values (names only listed below)

npm run prisma:generate

# Apply migrations ONLY with explicit approval against the target DB:
npm run prisma:deploy
# Prefer DIRECT_URL (port 5432) for migrate deploy — see docs/migrations.md

# Optional: apply prisma/rls-policies.sql in Supabase SQL Editor

npm run db:seed
```

Seed prints the Super Admin login using `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`.

**Important:** Agents must never run `migrate deploy` / `migrate dev` / `db push` against remote databases. Humans apply migrations with approval.

---

## Running the app

```powershell
npm run dev        # → http://localhost:3000
npm run build
npm run start
npm run typecheck
npm run lint
npm run test       # Vitest unit tests
npm run test:e2e   # Playwright (skips if no server / no PLAYWRIGHT_BASE_URL)
```

---

## Roles & auth flows

| Role | Entry | Notes |
|------|--------|--------|
| **Super Admin** | `/admin/login` | Email + password (seeded) |
| **School Head** | `/login` → school → School Head | One-time **activation credential** (not School ID as password). First login forces private password (`mustChangePassword`). Super Admin can regenerate credentials (audited). |
| **Teacher** | `/login` → school → Teachers, or invite link `/teacher-setup/[token]` | School Head invites teacher (name + optional email + grade assignment) → `TeacherInvite` with one-time credential. Teacher activates, sets password, completes profiling. Invite supports resend/revoke. |

Password recovery: `/forgot-password` (email-based where a real email exists). Synthetic emails (School Head / some teachers) cannot use standard email recovery — Super Admin / School Head ops regenerate credentials instead. See `docs/runbook.md`.

Workflow gates: School Head profiling before grade creation; Teacher profiling before adding learners; Teachers button disabled until SH profiled + grades + teachers exist.

---

## Import / export

- **CSV import (teachers):** `/teacher/grade/[id]/import` — template download, Papa Parse, Zod row validation, preview with row errors, **valid-rows commit** (invalid skipped + reported). Audit: `IMPORT_LEARNERS` (counts only, no full PII dump).
- **Excel + printable reports:** `/teacher/reports`, `/school-head/reports` — exceljs workbook (learners + ARAL summary); print-friendly HTML (`@media print` → browser Save as PDF). Tenant-isolated. Audit: `EXPORT_*`.

---

## Environment variables (names only)

Copy `.env.example` → `.env.local`:

- `DATABASE_URL` — pooled Postgres (prefer port 6543)
- `DIRECT_URL` — direct/session Postgres for migrations (port 5432)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — optional in dev
- `NEXT_PUBLIC_APP_URL`
- `SYNTHETIC_EMAIL_DOMAIN`
- `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` — seed only

Never commit secrets.

---

## Project structure (high level)

```
prisma/                  schema, migrations (committed SQL), seed, RLS SQL
src/app/                 App Router pages (admin, school-head, teacher, auth)
src/lib/actions/         Server actions
src/lib/validators/      Zod schemas
src/lib/dashboard/       Aggregates + chart helpers
src/lib/learners/        Import CSV helpers, pagination, normalize
src/components/          UI, forms, learners, reports, dashboard
tests/unit/              Vitest
e2e/                     Playwright smoke
docs/                    Backlog, migrations, deployment, runbook, privacy
```

---

## Documentation

| Doc | Contents |
|-----|----------|
| [DOCUMENTATION.md](./DOCUMENTATION.md) | Architecture, RBAC, tenancy, audit, features |
| [SETUP-WINDOWS.md](./SETUP-WINDOWS.md) | Windows setup path |
| [docs/migrations.md](./docs/migrations.md) | Migration policy |
| [docs/deployment.md](./docs/deployment.md) | Vercel + Supabase |
| [docs/runbook.md](./docs/runbook.md) | Ops: credentials, invites, backup pointers |
| [docs/privacy.md](./docs/privacy.md) | PH Data Privacy Act guidance (not legal certification) |
| [docs/backlog.md](./docs/backlog.md) | Architecture decisions + wave status |
| [docs/requirements-traceability.md](./docs/requirements-traceability.md) | DOCX → implementation matrix |

---

## Testing

- Unit: `npm run test` (validators, auth helpers, rate-limit, import CSV, tenant assert, chart helpers, …)
- E2E smoke: login pages + forgot-password; skips when no local server unless `PLAYWRIGHT_BASE_URL` is set
- Quality gates: `typecheck`, `lint`, `test`, `build`

---

## Known limitations

- Committed Prisma migrations may not yet be applied to remote Supabase — apply only with approval.
- Synthetic email accounts: limited email recovery; use credential regeneration.
- Cross-school learner transfer deferred.
- In-memory rate limiter is per-instance (serverless caveat); Upstash adapter noted for production hardening.
