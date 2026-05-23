# PROJECT LITRACK

Multi-tenant school management web app for DepEd schools to identify and track learners struggling with reading (ARAL program).

**Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Supabase (Auth + Postgres), Prisma ORM, Tailwind CSS, shadcn/ui, React Hook Form + Zod, Resend (email), Vitest + Playwright.

---

## Prerequisites

You will need to install these on your Windows machine before running the app:

| Tool | Where to get it | Why |
|---|---|---|
| **Node.js 20 LTS** | https://nodejs.org/ | Runtime + `npm` |
| **Git** | https://git-scm.com/download/win | Version control (optional but recommended) |
| **Supabase project** | https://supabase.com/ | Postgres database + Auth |
| **Resend account** (free tier) | https://resend.com/ | Sending teacher invite emails |

After installing Node, open a new PowerShell window and verify:
```powershell
node --version
npm --version
```

---

## Setup (first-time)

```powershell
# 1. Install dependencies
npm install

# 2. Copy env template and fill in values
copy .env.example .env.local
# Edit .env.local with your real Supabase + Resend keys

# 3. Generate Prisma client
npm run prisma:generate

# 4. Run migrations against your Supabase database
npm run prisma:migrate -- --name init

# 5. Apply Row-Level Security policies
# Open Supabase Dashboard → SQL Editor → paste the contents of
# `prisma/rls-policies.sql` and run it.

# 6. Bootstrap the Super Admin user
npm run db:seed
```

The seed prints the Super Admin login URL and credentials (`SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` from your `.env.local`).

---

## Running the app

```powershell
npm run dev
# → http://localhost:3000
```

Other useful scripts:
```powershell
npm run build        # production build (runs prisma generate first)
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint
npm run prisma:studio # browse the database
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright E2E
```

---

## Login flow (matches the original spec)

1. **Super Admin** logs in at `/admin/login` with email + password (created by `db:seed`).
2. Super Admin creates schools at `/admin/schools/new` — each school gets a unique **School ID** (used as the School Head password).
3. **School Head** opens `/login`, picks the school name from the dropdown, clicks **School Head**, types the **School ID** as password.
4. School Head completes profiling (Sections I–IV from the survey doc) → Create Grade Levels (Kinder, 1–12, Floating) → invites teachers (full name + email).
5. The teacher receives an email invite, clicks the link, sets their own password, and is signed in.
6. **Teacher** completes profiling → opens their assigned grade → adds learners (Section A).
7. Teacher clicks **Mark ARAL** on any learner → learner is moved into the per-grade ARAL Dashboard.
8. In ARAL Dashboard → **Update Data** opens the violet-highlighted Sections B–E. Per-learner Attendance (daily P/A/L/E) and Monthly Reading Level pages are also available.

---

## Project structure

```
prisma/
  schema.prisma          # all models + enums (locked-in spec)
  seed.ts                # bootstrap Super Admin
  rls-policies.sql       # Supabase RLS policies (run after migrate)

src/
  app/
    page.tsx                              → redirect to /login
    login/page.tsx                        → School-name dropdown + role buttons
    teacher-setup/[token]/page.tsx        → Teacher invite acceptance
    admin/(login|page|schools/...)        → Super Admin
    school-head/(profiling|grade-levels|teachers|page)
    teacher/(profiling|page|grade/[id]|aral/[gradeId]/...)
    api/schools/list/route.ts             → public school list
  lib/
    prisma.ts                             # Prisma singleton
    utils.ts                              # cn(), getMonday(), monthYearKey()
    supabase/(client|server|admin|middleware).ts
    auth/(session|guards|invites|synthetic-email).ts
    email/resend.ts                       # invite email
    validators/*.schema.ts                # Zod
    actions/*.ts                          # server actions
    constants/enum-labels.ts              # human-readable labels
  components/
    ui/                                   # shadcn/ui primitives
    forms/                                # all forms (login, profiling, learner, ARAL, etc.)
    app-shell.tsx                         # shared header + container
    aral-toggle-button.tsx
  middleware.ts                           # session refresh + route protection
```

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in these required values:

- `DATABASE_URL` — pooled Supabase Postgres connection string (port 6543)
- `DIRECT_URL` — direct Supabase Postgres connection string (port 5432)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **server only**, never expose to client
- `RESEND_API_KEY` — optional in dev (invite link is logged to the console if missing)
- `RESEND_FROM_EMAIL`
- `NEXT_PUBLIC_APP_URL` — used to build invite links (`http://localhost:3000` in dev)
- `SYNTHETIC_EMAIL_DOMAIN` — domain used for School Head synthetic emails (e.g. `litrack.local`)
- `SEED_SUPER_ADMIN_EMAIL` + `SEED_SUPER_ADMIN_PASSWORD` — used only by `db:seed`

---

## Authentication design (important!)

Supabase Auth requires email + password. The login spec ("School Name + School ID") is bridged by a **synthetic email** strategy:

- **School Head** auth user is created when the Super Admin creates the school.
  - Synthetic email: `sh@<schoolIdCode>.<SYNTHETIC_EMAIL_DOMAIN>`
  - Supabase password: the school's `schoolIdCode`
- **Teacher** auth user is created when the teacher accepts the invite.
  - Real email (collected during invite); teacher chooses their own password.
- **Super Admin** uses a real email + password (separate `/admin/login`).

All app authorization (role checks, school isolation) happens in server actions via `requireUser(role)`. The Prisma client uses the service role connection and bypasses RLS — RLS is a defense-in-depth layer for any direct PostgREST calls.

---

## Deployment (Vercel + Supabase cloud)

1. Push the repo to GitHub.
2. Import into Vercel; framework auto-detected as Next.js.
3. Add **all** env vars from `.env.local` to the Vercel project.
4. Vercel build runs `prisma generate && next build` automatically (see `package.json`).
5. After first deploy, run migrations against the production database:
   ```powershell
   $env:DATABASE_URL="<production-direct-url>"
   $env:DIRECT_URL="<production-direct-url>"
   npx prisma migrate deploy
   ```
6. Apply `prisma/rls-policies.sql` in the production Supabase SQL editor.
7. Run `npm run db:seed` once against production to create the Super Admin.

---

## What's included in this scaffold

- ✅ Complete Prisma schema with all enums (matches the source survey doc exactly)
- ✅ Multi-role auth (Super Admin / School Head / Teacher) with the special School-Name+ID login
- ✅ Teacher invite flow (token-hashed, 7-day TTL, email via Resend)
- ✅ All four profiling forms (School Head, Teacher, Learner Section A, ARAL violet B–E)
- ✅ Grade levels (Kinder, 1–12, Floating, cross-grade)
- ✅ ARAL toggle + per-grade ARAL Dashboard
- ✅ Daily attendance (P/A/L/E) with weekly aggregation key
- ✅ Monthly reading-level records (Phil-IRI taxonomy, English + Filipino)
- ✅ Audit log model
- ✅ Soft deletes on all major tables
- ✅ Tailwind + shadcn/ui base components
- ✅ Sonner toasts, server actions, Zod validation

## Not yet implemented (deferred for v1.1)

- CSV bulk learner import (Papa Parse + server-side validator)
- PDF / Excel report exports (react-pdf + exceljs)
- Vitest unit tests for server actions
- Playwright E2E for the full happy path
- Sentry error monitoring
- i18n scaffold (Filipino translations)

These were planned in the master prompt and have placeholders in `package.json` (`papaparse`, `exceljs`) but the UI/route work is left for a follow-up commit.

---

## Quick smoke test

After setup:

1. Go to `/admin/login`, log in as Super Admin.
2. Create a school (e.g. name "Demo Elementary", School ID "demo123").
3. Log out, go to `/login`, pick "Demo Elementary", click **School Head**, password = `demo123`.
4. Complete the SH profile → click **Create Grade Level** → create "Kinder".
5. Click **Teachers** → invite a teacher (use your real email if Resend is configured, or check the dev server console for the invite URL).
6. Visit the invite URL, set a password.
7. Log in as the teacher → complete teacher profile → open Kinder → add a learner → click **Mark ARAL**.
8. Open the **ARAL Dashboard** → click **Update Data** on the learner → fill the violet-highlighted Sections B–E.
9. Try **Attendance** and **Reading Level** for the learner.

If any step fails, check the server console for errors and confirm your Supabase env vars and migrations.
