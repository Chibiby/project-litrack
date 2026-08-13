# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LITRACK — multi-tenant school management app for DepEd schools tracking learners in the ARAL reading program. Three roles: `SUPER_ADMIN`, `SCHOOL_HEAD`, `TEACHER`. `School` is the tenant root; nearly every table carries `schoolId`.

**Stack (authoritative source is `package.json`):** Next.js 15.5 App Router · React 19 · TypeScript strict · Prisma 5 → Supabase Postgres · Supabase Auth (`@supabase/ssr`) · Zod · Tailwind + shadcn/ui · Recharts · papaparse + exceljs · Resend · Vitest + Playwright.

> `README.md`, `DOCUMENTATION.md`, and `docs/backlog.md` still claim Next 14.2.28 / React 18.3.1. That is stale — the repo is on Next 15 / React 19. Trust `package.json`.

## Commands

```powershell
npm run dev          # next dev --turbopack → http://localhost:3000
npm run build        # prisma generate && next build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run test         # vitest run
npm run test:e2e     # playwright (opt-in; see below)
npm run db:seed      # tsx prisma/seed.ts — prints seeded Super Admin login
```

Single test file / single case:

```powershell
npx vitest run tests/unit/rate-limit.test.ts
npx vitest run tests/unit/validators/learner.schema.test.ts -t "rejects empty name"
```

CI (`.github/workflows/ci.yml`) gates on: `prisma generate` → `typecheck` → `lint` → `test` → `build`, all with placeholder env values (no live DB — every app page is `force-dynamic`, so the build never touches Postgres). Run those four locally before declaring work done.

E2E does **not** auto-start a server (`playwright.config.ts` has no `webServer`). Start `npm run dev` yourself, or set `PLAYWRIGHT_BASE_URL`. Never point it at production.

`.npmrc` sets `legacy-peer-deps=true`; `package.json` pins `@types/react`/`@types/react-dom` via `overrides`. Keep both when touching deps.

## The hard rule: migrations

**Never apply migrations or destructive SQL to any remote/shared database.** Forbidden without explicit, task-specific approval from the project owner: `prisma migrate deploy`, `prisma migrate dev`, `prisma migrate reset`, `prisma db push`, and any `DROP`/`TRUNCATE`/unbounded `DELETE`/`UPDATE` via psql or the Supabase SQL Editor.

Your job is to *author* migrations; a human applies them. Safe offline commands: `prisma validate`, `prisma format`, `prisma generate`, and `prisma migrate diff --script` with file inputs (never `--from-url`/`--to-url`).

Conventions: committed SQL under `prisma/migrations/`, named `YYYYMMDDNNNNNN_short_description`, baseline `0_init`. Additive first — nullable column → backfill migration → tighten (see `20260808190002_backfill_null_section_a`). `Enrollment`'s partial unique index (one `ACTIVE` row per learner) exists only in SQL because Prisma's schema language can't express it — preserve it when editing Enrollment migrations. Details in `docs/migrations.md`, apply checklist in `docs/migrate-checklist.md`.

## Architecture

### Request path

`src/middleware.ts` → `updateSession` (Supabase cookie refresh) → `enforceRolePrefix` from `src/lib/auth/roles.ts` (defense-in-depth check of `/admin`, `/school-head`, `/teacher` prefixes against the JWT `app_metadata.role`). Middleware is **not** authoritative — it deliberately passes through legacy accounts with no JWT role. `requireUser` in the server component / action is the real gate.

`src/lib/auth/roles.ts` is the Edge-safe half (pure, no Prisma, no `server-only`); `src/lib/auth/session.ts` is the Node half and re-exports the path helpers. Don't import session.ts from middleware.

### Auth and session

- `getCurrentUser()` — Supabase auth user → Prisma `User` by `authId`, wrapped in React `cache()`. Signs out soft-deleted (`deletedAt`) and inactive users; redirects `PENDING` teachers to `/pending-approval` and `REJECTED` ones to `/login` (unless `allowPending`). Retries once on Prisma `P2024` pool timeouts.
- `requireUser(roles?, allowSuperAdmin = true, options?)` — redirects to `/login` or `/admin/login`, forces `/account/set-password` when `mustChangePassword`. **Super Admin passes every role check by default** (impersonation), so role-scoped queries must branch on `user.role === "SUPER_ADMIN"` explicitly rather than assuming the role matched.
- `requireSchoolUser(roles?)` — same, plus a guaranteed non-null `schoolId` (`SchoolUser` type).
- Supabase requires an email, so School Heads and email-less teachers get synthetic addresses under `SYNTHETIC_EMAIL_DOMAIN`. Those accounts cannot use email password recovery — ops regenerate credentials instead (`docs/runbook.md`).

### Tenancy

Every school-scoped query includes `schoolId: user.schoolId` in the `where`, or validates ownership with `assertSameSchool` (`src/lib/auth/tenant.ts`), which throws a generic `"Not found"` so existence in another tenant never leaks. Cross-tenant leakage is the worst bug shippable here.

Super Admin viewing School Head pages passes `?schoolId=`; `resolveSchoolContext` (`src/lib/school-context.ts`) resolves it and writes an `ADMIN_SCHOOL_VIEW` audit row deduped per admin+school over an 8-hour window.

`prisma/rls-policies.sql` is defense-in-depth for direct PostgREST access — app writes all go through Prisma with the service-role connection, so RLS is not what protects tenancy in app code.

### Server actions — the house pattern

Actions live in `src/lib/actions/*.ts`, all `"use server"`, and return a discriminated result rather than throwing:

```ts
type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export async function doThing(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");          // 1. auth guard first
  const parsed = someSchema.safeParse(formToObj(formData)); // 2. Zod safeParse
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  // 3. ownership check scoped to user.schoolId
  // 4. mutate (prisma.$transaction when multi-step)
  // 5. writeAudit({ action: AUDIT_ACTIONS.X, ... })
  // 6. revalidatePath / revalidate* helper
}
```

Other invariants: soft delete via `deletedAt` (filter `deletedAt: null` on reads unless archived rows are wanted); `Learner`'s denormalized current grade/section pointers must stay transactionally consistent with the active `Enrollment` row; client-facing errors must be safe.

### Audit

`writeAudit()` (`src/lib/audit.ts`) inserts an `AuditLog` row and **never throws** — failures are logged only. Actions come from the `AUDIT_ACTIONS` constant map; add new ones there rather than passing raw strings. Never put passwords, tokens, invite secrets, or activation credentials in `metadata` — log resource IDs and counts (the CSV import logs counts, not row PII). Viewers: `/admin/audit`, `/school-head/audit`.

### Caching

Every role page is `force-dynamic` (auth), so the Full Route Cache is unavailable. Two layers stand in:

- `cachedQuery` (`src/lib/cache/unstable.ts`) wraps `unstable_cache` with key parts, tags, and a short TTL (default 60s) — used by `src/lib/dashboard/aggregates.ts`.
- Tag strings are centralized in `src/lib/cache/tags.ts`; invalidation goes through the named helpers in `src/lib/cache/revalidate.ts` (`revalidateLearnerScoped`, `revalidateTeacherCaches`, …) rather than raw `revalidateTag` calls, because each mutation type busts a deliberately different set (e.g. only learner create/archive/import busts the admin dashboard; only ARAL-presence changes bust the teacher sidebar shell).

`next.config.mjs` sets `experimental.staleTimes` (dynamic 180s / static 600s) so prefetched role routes swap without a `loading.tsx` flash. Related client-side warming lives in `src/lib/nav/warm-hrefs.ts`, `src/lib/auth/warm-routes.ts`, and `src/components/nav-prefetcher.tsx`.

### Prisma client

`src/lib/prisma.ts` is a global singleton **cached in production too** (Vercel reuses warm lambdas; re-instantiating would open a new pooler pool per request). `resolvePooledDatabaseUrl` (`src/lib/db-url.ts`) rewrites a port-6543 `DATABASE_URL` to add `pgbouncer=true` and floor `connection_limit` at 3 — PgBouncer transaction mode breaks Prisma's named prepared statements (`42P05`) and `connection_limit=1` causes `P2024` under overlapping RSC navigation. Migrations use `DIRECT_URL` (port 5432) instead. Set `PRISMA_LOG_QUERIES=1` to see SQL in dev.

### Validation

Zod schemas in `src/lib/validators/*.schema.ts`, shared primitives in `common.ts`, phone rules in `phone.ts`. Conditional survey rules (frustration subtypes, transfer "Specify", training Yes/No arrays) use `superRefine`. Client forms use the same schemas through `useAppForm` (`src/components/forms/app-form.tsx`: RHF + zodResolver, validate on blur then revalidate on change, optional unsaved-changes guard and error summary) — server actions always re-validate regardless.

### Env

`src/lib/env.ts` (`getServerEnv`) parses and caches server env with Zod and throws with variable **names only**. `src/lib/supabase/env.ts` is deliberately soft-fail so middleware still functions when public env is missing.

### Domain notes

- **School year / enrollment:** one active `SchoolYear` per school. `Enrollment` is the longitudinal record (learner × year × grade/section/teacher × status). Creating learners with no active year skips enrollment creation by design.
- **ARAL:** violet is reserved as the ARAL accent (`tailwind.config.ts`); blue primary, amber secondary elsewhere. ARAL routes live under `/teacher/aral/[gradeId]` with weekly grid entry (`src/lib/actions/aral-grid.ts`).
- **Dates:** attendance and weekly grids key off local `YYYY-MM-DD` via `src/lib/date-keys.ts` — use `formatLocalDateKey`/`parseLocalDateKey`, never `toISOString()`, which shifts the day in UTC+8.
- **Enum labels:** every Prisma enum's UI label lives in `src/lib/constants/enum-labels.ts`. Adding an enum value means updating that file too.
- **Rate limiting:** `src/lib/rate-limit.ts` uses Upstash Redis when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set and silently degrades to a per-instance in-memory window otherwise. Any Redis failure must fall back, never throw.

## Subagents

`.claude/agents/` defines four role agents with file ownership boundaries: `database-engineer` is the **single serialized owner of `prisma/**`** (route all schema changes through it), `backend-developer` owns `src/lib/{actions,validators,auth,cache,supabase}/**` + `src/app/api/**` + `src/middleware.ts`, `frontend-developer` owns `src/components/**` and JSX, `qa-test-engineer` owns `tests/**` and `e2e/**` and is read-only on source. Respect those boundaries when parallelizing work.

## Docs map

`docs/migrations.md` (policy) · `docs/migrate-checklist.md` (human apply steps) · `docs/runbook.md` (credential regen, invites) · `docs/deployment.md` (Vercel + Supabase) · `docs/privacy.md` (PH Data Privacy Act) · `docs/backlog.md` (architecture decisions + wave status) · `docs/requirements-traceability.md` (source DOCX → implementation matrix).
