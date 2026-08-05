# PROJECT LITRACK

Multi-tenant school management web app for DepEd schools to identify and track learners struggling with reading (ARAL program).

**Stack:** Next.js 14.2.28 (App Router), React 18.3, TypeScript (strict), Supabase (Auth + Postgres), Prisma 5.22 ORM, Tailwind CSS, shadcn/ui, React Hook Form + Zod, Resend (email), Vitest + Playwright.

**Runtime:** Node.js `>=20` (see `package.json` `engines`).

---

## Prerequisites

| Tool | Where to get it | Why |
|---|---|---|
| **Node.js 20 LTS** | https://nodejs.org/ | Runtime + `npm` |
| **Git** | https://git-scm.com/download/win | Version control (optional but recommended) |
| **Supabase project** | https://supabase.com/ | Postgres database + Auth |
| **Resend account** (free tier) | https://resend.com/ | Sending teacher invite emails (optional in local dev) |

After installing Node, open a new PowerShell window and verify:
```powershell
node --version   # v20+
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

# 4. Apply migrations (fresh database)
npx prisma migrate deploy
# For local iterative work you can use: npm run prisma:migrate

# 5. Apply Row-Level Security policies
# Open Supabase Dashboard → SQL Editor → paste `prisma/rls-policies.sql` and run it.
# Read the header comments in that file for apply order and the `litrack_app` role model.

# 6. Bootstrap the Super Admin user
npm run db:seed
```

The seed prints the Super Admin login URL and credentials (`SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` from your `.env.local`).

### Existing production DB that was created with `db push` (no migration history)

Prod was previously synced with `prisma db push` only. A baseline migration lives at:

`prisma/migrations/0000000000000_init/`

**Do not re-run the baseline SQL against an already-populated database.** Instead, mark it as already applied:

```powershell
npx prisma migrate resolve --applied 0000000000000_init
```

Then future migrations can use `npx prisma migrate deploy` normally.

If production was pushed **before** `TeacherInvite.gradeLevelId` existed, add the column to match the baseline schema (run once in the SQL editor):

```sql
ALTER TABLE "TeacherInvite" ADD COLUMN IF NOT EXISTS "gradeLevelId" TEXT;
DO $$ BEGIN
  ALTER TABLE "TeacherInvite"
    ADD CONSTRAINT "TeacherInvite_gradeLevelId_fkey"
    FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

---

## Running the app

```powershell
npm run dev
# → http://localhost:3000
```

Other useful scripts:
```powershell
npm run build         # production build (runs prisma generate first)
npm run start         # serve the production build
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint via next lint
npm run prisma:studio # browse the database
npm run test          # Vitest unit tests (`vitest run`)
npm run test:e2e      # Playwright smoke tests (starts `npm run dev` unless PLAYWRIGHT_SKIP_WEBSERVER=1)
```

Playwright uses `PLAYWRIGHT_BASE_URL` (default `http://127.0.0.1:3000`). The login smoke spec skips gracefully if the server is unreachable.

---

## Login flow

1. **Super Admin** logs in at `/admin/login` with email + password (created by `db:seed`).
2. Super Admin creates schools at `/admin/schools/new` — each school gets a unique **School ID** (used as the School Head password).
3. **School Head** opens `/login`, picks the school name, clicks **School Head**, types the **School ID** as password.
4. School Head completes profiling → creates Grade Levels → creates teachers (username + temporary password shown in the UI).
5. **Teacher** opens `/login`, picks the school, enters the username + password from the School Head.
6. Teacher completes profiling → opens their assigned grade → adds learners (Section A).
7. Teacher clicks **Mark ARAL** on any learner → learner moves into the per-grade ARAL Dashboard.
8. ARAL Dashboard → **Update Data** (Sections B–E), Attendance, and Monthly Reading Level.

Optional email invite path: `inviteTeacher` still sends a `/teacher-setup/[token]` link. On accept, the teacher chooses a **username** + password; Auth uses the same `<username>@school.local` identity as direct create.

---

## Project structure

```
prisma/
  schema.prisma
  seed.ts
  rls-policies.sql
  migrations/0000000000000_init/   # baseline (see note above for prod)

src/
  app/
    login/page.tsx
    teacher-setup/[token]/page.tsx
    admin/…
    school-head/…
    teacher/…
  lib/
    prisma.ts, utils.ts, date-local.ts, url.ts, nav-active.ts
    supabase/, auth/, email/, validators/, actions/
  components/
e2e/
  login.spec.ts
```

---

## Environment variables

Copy `.env.example` to `.env.local` (`.env.example` is tracked; secrets files are gitignored).

- `DATABASE_URL` — pooled Supabase Postgres connection string (port 6543)
- `DIRECT_URL` — direct Supabase Postgres connection string (port 5432)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **server only**, never expose to client
- `RESEND_API_KEY` — optional in dev (invite link logged only when not production)
- `RESEND_FROM_EMAIL`
- `NEXT_PUBLIC_APP_URL` — required in production for invite links (falls back to `https://$VERCEL_URL` on Vercel)
- `SYNTHETIC_EMAIL_DOMAIN` — domain used for School Head synthetic emails (e.g. `litrack.local`)
- `SEED_SUPER_ADMIN_EMAIL` + `SEED_SUPER_ADMIN_PASSWORD` — used only by `db:seed`

---

## Authentication design (important!)

Supabase Auth requires email + password. Login is bridged with **synthetic emails**:

- **School Head** — created with the school: `sh@<schoolIdCode>.<SYNTHETIC_EMAIL_DOMAIN>`, password = `schoolIdCode`.
- **Teacher** — `<username>@school.local` (from School Head create or invite accept). Login uses school + username + password.
- **Super Admin** — real email + password at `/admin/login`. Authorization requires a `public."User"` row (PostgREST or Prisma). Privilege decisions use `app_metadata.role` or the DB row — never client-writable `user_metadata`.

App authorization (roles, school isolation, inactive/deleted checks) happens in server actions via `requireUser`. Prisma connects as `litrack_app` (see `prisma/rls-policies.sql`); RLS is defense-in-depth for PostgREST.

---

## Deployment (Vercel + Supabase cloud)

1. Push the repo to GitHub.
2. Import into Vercel; framework auto-detected as Next.js.
3. Add **all** env vars from `.env.local` to the Vercel project (including `NEXT_PUBLIC_APP_URL`).
4. Vercel build runs `prisma generate && next build`.
5. Migrations:
   - **Fresh DB:** `npx prisma migrate deploy`
   - **Existing db-push prod:** `npx prisma migrate resolve --applied 0000000000000_init` (then deploy future migrations)
6. Apply `prisma/rls-policies.sql` in the production Supabase SQL editor.
7. Run `npm run db:seed` once against production to create the Super Admin.

---

## Testing

- Unit: `npm run test` (Vitest — utils, auth helpers, synthetic emails, Zod schemas, nav active logic).
- E2E smoke: `npm run test:e2e` (Playwright — `/login` renders; skips if server unavailable).

---

## Quick smoke test

1. `/admin/login` as Super Admin.
2. Create a school (e.g. "Demo Elementary", School ID `demo123`).
3. `/login` → School Head → password `demo123`.
4. Complete SH profile → create Kinder → create a teacher (copy username/temp password).
5. Log in as teacher with that username → profile → add learner → Mark ARAL → Attendance / Reading Level.

If any step fails, check the server console and Supabase env vars / migrations.
