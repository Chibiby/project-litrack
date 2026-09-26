# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LITRACK — multi-tenant school management app for DepEd schools tracking learners in the ARAL reading program. Three roles: `SUPER_ADMIN`, `SCHOOL_HEAD`, `TEACHER`. `School` is the tenant root; nearly every table carries `schoolId`.

**Stack (authoritative source is `package.json`):** Next.js 16.3 App Router · React 19 · TypeScript strict · Prisma 6 → Supabase Postgres · Supabase Auth (`@supabase/ssr`) · Zod · Tailwind + shadcn/ui · Recharts · papaparse + exceljs · Resend · Vitest + Playwright.

## Commands

```powershell
npm run dev          # next dev --turbopack → http://localhost:3000
npm run build        # scripts/build-platform.mjs — OpenNext when WORKERS_CI=1, else prisma generate && next build --turbopack
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src (eslint.config.mjs; next lint was removed in Next 16)
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

Claude may apply **additive, non-destructive** migrations to the project's
database with `prisma migrate deploy`. This was previously human-only; the
project owner lifted that restriction on 2026-09-22, because pushing to main is
a production deploy and application code that writes a newly added enum value
fails against a database that has not received the migration, so holding the
apply step back stalled every deploy behind a manual task.

Additive means: adding a table, a nullable column, an index, or an enum value;
a backfill that only fills nulls. Before applying, always run `prisma migrate
status` and read the pending list — `prisma migrate deploy` applies **every**
pending migration, not just the one you authored, and the database may be
behind by more than you think. Confirm which database `DATABASE_URL` and
`DIRECT_URL` actually point at first; this repository has more than one
Supabase project in its env files.

**Still forbidden without explicit, task-specific approval from the project
owner:** `prisma migrate reset`, `prisma db push`, and any `DROP`, `TRUNCATE`,
or unbounded `DELETE`/`UPDATE` via psql or the Supabase SQL Editor. Dropping a
column or a table, narrowing a type, and adding a `NOT NULL` to a populated
column are destructive too — they can fail mid-deploy or lose data, so ask.
Say plainly which category a migration falls into rather than assuming the
permission stretches.

Always-safe offline commands: `prisma validate`, `prisma format`,
`prisma generate`, and `prisma migrate diff --script` with file inputs (never
`--from-url`/`--to-url`).

Conventions: committed SQL under `prisma/migrations/`, named `YYYYMMDDNNNNNN_short_description`, baseline `0_init`. Additive first — nullable column → backfill migration → tighten (see `20260808190002_backfill_null_section_a`). `Enrollment`'s partial unique index (one `ACTIVE` row per learner) exists only in SQL because Prisma's schema language can't express it — preserve it when editing Enrollment migrations. Details in `docs/migrations.md`, apply checklist in `docs/migrate-checklist.md`.

## The other hard rule: releases

**Every push to main that changes `src/` or `prisma/` ships a release entry.** Push to main is a production deploy, and a deploy that reaches users unannounced is the failure this rule prevents. In the same push:

1. Add an entry to the top of `RELEASES` in `src/lib/releases.ts` — `version`, `date` (local `YYYY-MM-DD`), one-line `title`, `announce: true`, and `fixes` written in the user's language, not the codebase's ("The ethnicity you pick no longer snaps back", not "fix select controlled value").
2. Set the same version string in `package.json` and `package-lock.json` (both the top-level `version` and `packages."".version`). A test fails if `package.json` and `APP_VERSION` drift.

Which number moves: the push holds only fixes → last number (1.6.0 → 1.6.1). The push holds any feature → middle number (1.6.0 → 1.7.0). First number → only when the project owner says so.

`announce: true` is the default; it shows the "LITRACK System updated to vX.Y.Z" modal once per user, listing every version they have not acknowledged. Set `announce: false` only for a release nobody needs to be interrupted by — it still appears at `/releases` and in the bell's Updates list. One entry per push, not per commit: group the push's commits into one release.

A `PreToolUse` hook (`.claude/settings.json` → `.claude/hooks/require-release-entry.mjs`) blocks the push when the entry is missing. It fails open, so it is a reminder, not the rule.

Concurrent sessions: if `releases.ts` or `package.json` conflicts on merge, renumber your entry above whatever main now holds. Never reuse a version number.

## Architecture

### Request path

`src/middleware.ts` (deliberately not renamed to Next 16's `proxy.ts`: proxy forces the Node runtime) → `updateSession` (Supabase cookie refresh) → `enforceRolePrefix` from `src/lib/auth/roles.ts` (defense-in-depth check of `/admin`, `/school-head`, `/teacher` prefixes against the JWT `app_metadata.role`). Middleware is **not** authoritative — it deliberately passes through legacy accounts with no JWT role. `requireUser` in the server component / action is the real gate.

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

Actions live in `src/lib/actions/*.ts`, all `"use server"`, wrapped once by `action()` so a single handler converts throws into results:

```ts
export const doThing = action("doThing", async (formData: FormData) => {
  const user = await requireSchoolUser("TEACHER");           // 1. auth guard first
  const input = parseInput(someSchema, formToObj(formData)); // 2. throws VALIDATION_FAILED
  assertSameSchool(user.schoolId, row.schoolId, "Learner");  // 3. throws NOT_FOUND
  // 4. mutate (prisma.$transaction when multi-step)
  // 5. writeAudit({ action: AUDIT_ACTIONS.X, ... })
  // 6. revalidatePath / revalidate* helper
  return { ok: true };
}, { verb: "save the thing" });
```

Failures are thrown, never returned: `throw new AppError("CODE", { detail })`. The wrapper classifies anything else (Prisma, Supabase, bugs), records non-user errors to `ErrorEvent` + platform logs (Workers Logs in production) (+ an alert email for `system`), and returns `{ ok: false, code, error, ref?, fieldErrors? }` — `error` keeps its historical field name and is always the safe user message, so existing `toast.error(res.error)` call sites keep working. `logoutAction` is deliberately left unwrapped, because it's a `<form action={logoutAction}>` target and that requires `Promise<void>`. About 30 legacy action modules still use the old hand-rolled `{ ok: false, error }` shape and their own try/catch; they migrate to `action()` in later slices. Codes and messages live in `src/lib/errors/codes.ts`; see `docs/errors.md`.

Other invariants: soft delete via `deletedAt` (filter `deletedAt: null` on reads unless archived rows are wanted); `Learner`'s denormalized current grade/section pointers must stay transactionally consistent with the active `Enrollment` row; client-facing errors must be safe.

### Audit

`writeAudit()` (`src/lib/audit.ts`) inserts an `AuditLog` row and **never throws** — failures are logged only. Actions come from the `AUDIT_ACTIONS` constant map; add new ones there rather than passing raw strings. Never put passwords, tokens, invite secrets, or activation credentials in `metadata` — log resource IDs and counts (the CSV import logs counts, not row PII). Viewers: `/admin/audit`, `/school-head/audit`.

### Caching

Every role page is `force-dynamic` (auth), so the Full Route Cache is unavailable. Two layers stand in:

- `cachedQuery` (`src/lib/cache/unstable.ts`) wraps `unstable_cache` with key parts, tags, and a short TTL (default 60s) — used by `src/lib/dashboard/aggregates.ts`.
- Tag strings are centralized in `src/lib/cache/tags.ts`; invalidation goes through the named helpers in `src/lib/cache/revalidate.ts` (`revalidateLearnerScoped`, `revalidateTeacherCaches`, …) rather than raw `revalidateTag` calls, because each mutation type busts a deliberately different set (e.g. only learner create/archive/import busts the admin dashboard; only ARAL-presence changes bust the teacher sidebar shell).

On Cloudflare both layers are backed by `open-next.config.ts`: cache entries in Workers KV (`NEXT_INC_CACHE_KV`), tag revalidations in D1 (`NEXT_TAG_CACHE_D1`). See docs/deployment.md § Data Cache and placement.

`next.config.mjs` sets `experimental.staleTimes` (dynamic 180s / static 600s) so prefetched role routes swap without a `loading.tsx` flash. Related client-side warming lives in `src/lib/nav/warm-hrefs.ts`, `src/lib/auth/warm-routes.ts`, and `src/components/nav-prefetcher.tsx`.

### Prisma client

Production runs on Cloudflare Workers via OpenNext, so `src/lib/prisma.ts` has two shapes, chosen by the `LITRACK_DEPLOY_TARGET` constant `next.config.mjs` inlines. On Cloudflare: one client per request through React `cache()`, behind a lazy proxy, with the pg adapter set to `maxUses: 1` — workerd rejects an I/O object carried over from a previous request. Everywhere else: a global singleton **cached in production too** (a warm Node lambda reuses the process; re-instantiating would open a new pooler pool per request). The connection URL is resolved **at call time**, never at module scope: `getCloudflareContext()` throws outside a request, and reading the `HYPERDRIVE` binding once during isolate startup silently pins that isolate to the unpooled `DATABASE_URL` forever. `resolvePooledDatabaseUrl` (`src/lib/db-url.ts`) rewrites a port-6543 `DATABASE_URL` to add `pgbouncer=true` and floor `connection_limit` at 3 — PgBouncer transaction mode breaks Prisma's named prepared statements (`42P05`) and `connection_limit=1` causes `P2024` under overlapping RSC navigation. Migrations use `DIRECT_URL` (port 5432) instead. Set `PRISMA_LOG_QUERIES=1` to see SQL in dev. On Windows, the Cloudflare build runs `scripts/relink-standalone-externals.mjs` after `next build`; without it Turbopack's absolute external links make the Worker load Prisma's Node client and every query fails.

### Validation

Zod schemas in `src/lib/validators/*.schema.ts`, shared primitives in `common.ts`, phone rules in `phone.ts`. Conditional survey rules (frustration subtypes, transfer "Specify", training Yes/No arrays) use `superRefine`. Client forms use the same schemas through `useAppForm` (`src/components/forms/app-form.tsx`: RHF + zodResolver, validate on blur then revalidate on change, optional unsaved-changes guard and error summary) — server actions always re-validate regardless.

### Env

`src/lib/env.ts` (`getServerEnv`) parses and caches server env with Zod and throws with variable **names only**. `src/lib/supabase/env.ts` is deliberately soft-fail so middleware still functions when public env is missing.

### Domain notes

- **School year / enrollment:** one active `SchoolYear` per school. `Enrollment` is the longitudinal record (learner × year × grade/section/teacher × status). Creating learners with no active year skips enrollment creation by design.
- **ARAL:** violet is reserved as the ARAL accent (`tailwind.config.ts`); blue primary, amber secondary elsewhere. ARAL routes live under `/teacher/aral/[gradeId]` with weekly grid entry (`src/lib/actions/aral-grid.ts`). The **ARAL Profile** (stored Sections C–D–E, `AralProfile`) is reached only from **ARAL Profiling** (`/teacher/aral/profiling`, tutor scope) and the teacher dashboard Pending Profiles card; it asks no absenteeism questions (Weekly Attendance records absences), and no workflow may gate on it — see `docs/aral-profile.md`.
- **Advisory:** a teacher advises 0–3 sections. `advisoryMode` is `DEFAULT` (one) · `FLOATING` (none — no roster, no end-of-term sheet, ARAL still open) · `MULTI_GRADE`. That last value is the stored spelling of what every user-facing string calls **multi-advisory**; keep the enum, never the word. Those sections need not share a grade, so nothing may derive "the teacher's grade" from the first placement — go through `getAdvisoryPlacements` and `resolveAdvisoryGradeScope` (`src/lib/teachers/advisory.ts`), which ask rather than guess when a grade holds more than one.
- **Dates:** attendance and weekly grids key off local `YYYY-MM-DD` via `src/lib/date-keys.ts` — use `formatLocalDateKey`/`parseLocalDateKey`, never `toISOString()`, which shifts the day in UTC+8.
- **Enum labels:** every Prisma enum's UI label lives in `src/lib/constants/enum-labels.ts`. Adding an enum value means updating that file too.
- **Rate limiting:** `src/lib/rate-limit.ts` uses Upstash Redis when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set and silently degrades to a per-instance in-memory window otherwise. Any Redis failure must fall back, never throw.

## Subagents

`.claude/agents/` defines four role agents with file ownership boundaries: `database-engineer` is the **single serialized owner of `prisma/**`** (route all schema changes through it), `backend-developer` owns `src/lib/{actions,validators,auth,cache,supabase}/**` + `src/app/api/**` + `src/middleware.ts`, `frontend-developer` owns `src/components/**` and JSX, `qa-test-engineer` owns `tests/**` and `e2e/**` and is read-only on source. Respect those boundaries when parallelizing work.

## Docs map

`docs/migrations.md` (policy) · `docs/migrate-checklist.md` (human apply steps) · `docs/runbook.md` (credential regen, invites) · `docs/deployment.md` (Cloudflare Workers + Supabase) · `docs/privacy.md` (PH Data Privacy Act) · `docs/backlog.md` (architecture decisions + wave status) · `docs/requirements-traceability.md` (source DOCX → implementation matrix) · `docs/errors.md` (error codes, severities, admin log) · `docs/aral-profile.md` (what is dormant, what must keep working without it).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
