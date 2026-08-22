# Latency & Throughput Spec

**Date:** 2026-08-22
**Status:** Design approved; implementation not started.
**Scope:** Server-side latency, database round trips, bulk-write correctness, cache placement, and shell streaming across all three roles.

## Context

The request was to make every page, table, navigation, and data fetch "feel faster," targeting responses under 300–400 ms, without compromising build quality.

Four parallel read-only diagnostics were run (server waterfall, database/index audit, client bundle/hydration, Vercel platform + Next.js 16 research). Their combined finding is that **LITRACK's latency is dominated by network topology and round-trip count, not by query cost or client weight.** A secondary finding is that the same topology probably breaks bulk writes outright.

This spec is the *actual-latency* companion to
`docs/superpowers/specs/2026-08-14-ui-system-and-performance.md`, which covered
*perceived* performance (skeleton discipline, intent prefetch, the Tier A/Tier B
caching doctrine). That spec's doctrine is preserved here, not relitigated —
in particular its rule that **rendered HTML must never be cached on the
`force-dynamic` role pages**, because a Full Route Cache entry is shared across
users and would leak one school's data to another tenant.

## Goal and how success is measured

Target: **p75 under 400 ms** for authenticated navigations, measured in production, filtered to Philippines traffic.

The target is currently unreachable by arithmetic, not by inefficiency. See R0.

Success is measured by:

- Vercel Speed Insights p75 TTFB, filtered to Philippines, per route.
- OpenTelemetry p75 for `BaseServer.handleRequest`, split by `next.rsc` true/false.
- Custom spans around Prisma and the Supabase Auth call, giving per-round-trip cost directly.

No phase after Phase 0 is considered done without a before/after number from the above.

## Evidence base

Labelled throughout, because the distinction matters for how much weight each finding carries.

**Measured on 2026-08-22:**

| Fact | Value | How |
|---|---|---|
| Dev machine → Supabase pooler, TCP connect | **med ~63 ms** (n=6: min 57.3, max 115.7) | Node timing script, warm DNS |
| Dev machine → Supabase Auth, TLS handshake | med 66.4 ms (n=6: min 60.5, max 153.1) | same |

> **On the two pooler figures.** An earlier bash `/dev/tcp` probe reported
> 127 / 134 / 195 ms for the same connection. That run included DNS resolution
> and shell process spawn per sample; the 195 ms first sample is a cold DNS
> lookup. The ~63 ms median above is the better number for pure TCP RTT and is
> what this spec uses. **Neither figure changes any conclusion** — both are
> one to two orders of magnitude above the ~2–10 ms of a co-located call, which
> is the only comparison that drives R3.
| Supabase JWT signing algorithm | **ES256 asymmetric, keys live** | `GET /auth/v1/.well-known/jwks.json` → 200, `alg=ES256`, `kty=EC` |
| Supabase DB + Auth region | `ap-southeast-1` (Singapore) | `DATABASE_URL` host `aws-1-ap-southeast-1.pooler.supabase.com:6543` |
| Vercel region config | **absent** — no `vercel.json`, no `vercel.ts`, no `regions` key | repo root |
| `@supabase/supabase-js` resolved | 2.106.1 (manifest says `^2.46.1`) | `node_modules` |
| `@supabase/ssr` resolved | 0.5.2 (current upstream: 0.12.4) | `node_modules` |
| Prisma `relationJoins` preview | **not enabled** | `prisma/schema.prisma:4-6` |
| `$transaction` `timeout:` overrides | **none anywhere** | grep across `src/**` |
| `findMany` calls / with `take:` | 85 / 15 | static scan |
| `revalidatePath` calls | 111 (35 in `learner.ts` alone) | static scan |
| exceljs in client bundles | **absent** — server-only confirmed | scan of all 162 prod chunks |
| recharts / papaparse | correctly behind `next/dynamic` | `react-loadable-manifest.json` |
| `"use client"` files | 108; only 2 accidental, both <2 KB | per-file hook/handler scan |
| Parallel route slots | 0 | filesystem |

**Estimated, with arithmetic shown where used:**

- `iad1` → `ap-southeast-1` RTT ≈ **220 ms**. Cited from a community AWS inter-region matrix, consistent with published us-east-1↔ap-southeast-1 figures of 215–235 ms. Not an AWS-official number.
- `sin1` → `ap-southeast-1` ≈ **20 ms** per call including query execution (conservative; raw network is 2–10 ms). Inferred from same-AWS-region co-location, not separately measured.
- Manila → `sin1` ≈ 30–50 ms; Manila → `iad1` ≈ 200–240 ms. Estimates, uncited.
- All DOM node counts, hydration milliseconds, and reconcile costs. No browser, Lighthouse, or React Profiler was run.

**Not verified — and Phase 0 exists to close these:**

- **The actual Vercel function region.** The `iad1` assumption rests entirely on it being the documented default for new projects and there being no region config in the repo. The Vercel MCP server is unauthenticated in this session, so project settings could not be read.
- Whether Fluid Compute is enabled.
- Whether the bulk-write transactions are currently failing in production (R1).
- Actual production query counts per page. `PRISMA_LOG_QUERIES` is gated behind `NODE_ENV === "development"` (`src/lib/prisma.ts:36-43`), so it is a no-op in production.

## Requirements

### R0 — The target is arithmetically unreachable today

Every authenticated render pays a fixed, strictly sequential preamble before any page data is requested:

| Hop | Runtime | Network | @220 ms | @20 ms |
|---|---|---|---|---|
| middleware `getClaims()` | Edge | 0 (warm) | ~0 | ~0 |
| RSC `supabase.auth.getUser()` (`src/lib/auth/session.ts:64`) | Node | 1 HTTPS → SG | 220 | 20 |
| RSC `prisma.user.findUnique` (`src/lib/auth/session.ts:51`) | Node | 1 SQL → SG | 220 | 20 |
| **Fixed floor** | | **2 sequential** | **440 ms** | **40 ms** |

The second hop depends on the first (`loadUserByAuthId` consumes `authUser.id`), so they cannot be parallelized as written.

`requireUser` runs before and outside every cache, so **no amount of `cachedQuery` work can reduce this floor.** A 100% cache hit rate still leaves `/teacher` at two sequential cross-Pacific round trips.

Per-page wave counts (a "wave" = calls issued concurrently ≈ 1 RTT), with Data Cache warm:

| Page | Waves now | Waves optimal | @220 ms | @20 ms | @20 ms + parallelized |
|---|---|---|---|---|---|
| `/teacher/learners` | 7 | 4 | 1,540 ms | 140 ms | 80 ms |
| `/teacher/aral` | 8 | 4 | 1,760 ms | 160 ms | 80 ms |
| `/teacher/aral/[gradeId]` (redirect) | 11 | 4 | ~2,500 ms | ~250 ms | 80 ms |
| `/teacher` dashboard | 2 warm / 4 miss | 1 / 3 | 440 / 880 ms | 40 / 80 ms | 20 / 60 ms |
| `/school-head` (School Head) | 2 warm / 3 miss | 1 / 2 | 440 / 660 ms | 40 / 60 ms | 20 / 40 ms |
| `/school-head` (Super Admin) | 4–5 | 2 | 880–1,100 ms | 80–100 ms | 40 ms |
| `/admin` | 2 warm / 3 miss | 1 / 2 | 440 / 660 ms | 40 / 60 ms | 20 / 40 ms |
| `/…/terms-reports` | 8 | 5 | 1,760 ms | 160 ms | 100 ms |

**Leverage, `/teacher/learners`:** region alone recovers 1,400 of 1,460 available ms (**95.9%**). Waterfall work alone recovers 660 ms (**45.2%**). They are multiplicative. Every waterfall fix in R4 is worth roughly **11× less** once co-located — which is why sequencing matters more than breadth here.

### R1 — Bulk writes likely exceed the transaction timeout (correctness, not performance)

Four server actions loop single-row statements inside `prisma.$transaction`. No `$transaction` in the repo passes a `timeout:` option, so every one runs on Prisma's **5-second default**.

| Action | Statements | Cap | Dies at (@220 ms/statement) |
|---|---|---|---|
| `src/lib/actions/import-learners.ts:257-310` | ≤ 1,000 (500 rows × `learner.create` + `enrollment.create`) | 500 rows | **~11 rows** |
| `src/lib/actions/attendance.ts:236-281` | ≤ 1,400 cells; ~200 realistic (40 learners × 5 days) | `.max(1400)` in `attendance.schema.ts:44` | **~22 cells** |
| `src/lib/actions/reading-level.ts:160-161` | unbounded | **`.min(1)`, no `.max()`** — `reading-level.schema.ts:98,110` | — |
| `src/lib/actions/term-grades.ts:187-194` | ~320 (40 × 8 subjects) | **no `.max()`** — `term-grade.schema.ts:36` | — |

Array-form `$transaction(ops)` batches into one BEGIN/COMMIT but still executes statements **serially over one connection**, so batching does not help.

**Prediction:** if functions are in `iad1`, saving a full ARAL attendance week and importing a real CSV are already failing with `P2028` in production.

**This prediction is the cheapest possible validation of the entire model.** If the save succeeds with a full grid, the 220 ms RTT assumption is wrong and every estimate in this spec must be re-baselined before work begins.

### R2 — Verification and measurement must precede all changes (Phase 0, blocking)

Nothing downstream is justified until these land, because Phase 1 may be a no-op and the whole ranking would shift.

1. **Confirm the Vercel function region.** Dashboard → Settings → Functions → Function Regions. If it already reads `sin1`, R3 is void and every estimate drops ~11×.
2. **Run the R1 test.** Save a 40-learner × 5-day attendance grid on production; watch for `P2028`.
3. **Confirm Fluid Compute status.** Dashboard → Settings → Functions.
4. **Install Speed Insights.** `@vercel/speed-insights`, `<SpeedInsights />` in the root layout, enable in dashboard. Filter by environment — it tracks preview and production both.
5. **Install OpenTelemetry.** `@vercel/otel` + `src/instrumentation.ts` (in `src/`, not `src/app/`), `NEXT_OTEL_VERBOSE=1`. Add custom spans in `src/lib/prisma.ts` and `src/lib/auth/session.ts` around `loadUserByAuthId` and the `getUser()` call — that pair alone gives per-round-trip cost directly.
6. **Record a baseline** and let Speed Insights collect for several days before Phase 1. This is the schedule's long pole.

Note: Vercel Observability's per-route latency breakdown may require **Observability Plus** (paid). Confirm plan tier before depending on it. Speed Insights and OTel are sufficient without it.

`Server-Timing` is explicitly **out of scope** — Next.js does not emit it natively, and OTel supersedes it.

### R3 — Pin the function region to `sin1` (Phase 1)

`sin1` maps to AWS `ap-southeast-1` — **the same region as the database and Auth server**, and simultaneously closer to Manila users than `iad1`. The usual "functions near the user vs. near the data" tradeoff does not exist for this app; one region wins on both axes.

Ship via `vercel.json` at repo root:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"]
}
```

`vercel.ts` + `@vercel/config` is the newer, TypeScript-typed alternative and does **not** deprecate `vercel.json`. For a single static `regions` line it earns nothing — it adds a dependency and build-time execution for identical effect. Use `vercel.json`. Never both. A dashboard setting achieves the same thing; the file's advantage is that it is reviewable in git.

Single-region pinning is available on every plan. `sin1` compute is priced at **1.25×** `iad1` — Active CPU $0.160/hr vs $0.128/hr, Provisioned Memory $0.0133 vs $0.0106 per GB-hr, per <https://vercel.com/docs/functions/usage-and-pricing>. (This line read "1.5×" until 2026-08-22; that number was uncited and wrong. CDN line items are ~1.30×, Fast Data Transfer ~1.07×.) Note for budgeting — and note that Provisioned Memory bills through I/O waits while Active CPU does not, so shorter round trips shorten the billed instance lifetime and offset part of the rate premium.

**Ship this alone, change nothing else in the same deploy, and re-measure.** Given the expected magnitude, bundling it with other work would make attribution impossible and would likely mask whether anything else mattered.

### R4 — Eliminate redundant and sequential round trips (Phase 2)

Ordered by measured or estimated saving.

**R4.1 — `getUser()` → `getClaims()` in `session.ts`.**
`src/lib/auth/session.ts:64` calls `supabase.auth.getUser()`, which always issues `GET /auth/v1/user` to Singapore. Middleware (`src/lib/supabase/middleware.ts:56`) already computed `claims.sub` locally and for free — the exact value `getUser()` is called to obtain, since `authUser.id` is used for nothing but `where: { authId }`.

Verified safe: ES256 keys are live, so `getClaims()` takes the local WebCrypto verification path (`GoTrueClient.js:4818-4874`), falling back to a remote call only for HS* symmetric JWTs. `getClaims()` caches JWKS in a module global with a 10-minute TTL.

**Tradeoff, stated plainly:** `getUser()` is authoritative against Supabase's session table and catches a server-side revocation immediately. `getClaims()` catches it only when the access token expires (≤ 1 hour). LITRACK's own gates — `deletedAt`, `approvalStatus`, `isActive` (`session.ts:71-107`) — re-check authorization from Postgres on every request and are unaffected. The residual exposure is a user banned *directly in Supabase Auth* without the app's `User` row changing. Since deactivation flows go through the app, this is narrow but non-zero. Accepted.

Saving: 220 ms on 100% of authenticated requests @220 ms; 20 ms @20 ms.

**R4.2 — Enable Prisma `relationJoins`.**
`prisma/schema.prisma:4-6` has no `previewFeatures`. Without `relationJoins`, Prisma 5 issues **one extra SQL round trip per nested to-one relation `select`**, after the parent resolves.

| Site | Nested selects | Extra round trips |
|---|---|---|
| `src/app/teacher/(app)/learners/page.tsx:180-183` | `gradeLevel`, `section`, `aralProfile` | +3 (and `section` is redundant — line 145 already fetched those names) |
| `src/app/school-head/(app)/aral/page.tsx:67-69` | `gradeLevel`, `section`, `teacher` | +3 |
| `src/lib/teachers/aral-tutor.ts:51-58` | `teacherProfile`, `advisorySection`, `advisorySection.gradeLevel` | +3 across 2 waves |
| `src/app/teacher/(app)/aral/page.tsx:104-105` | `section`, `aralProfile` | +2 |
| `src/lib/actions/export-learners.ts:37-38,59-60` | `gradeLevel`, `section` | +2, over the *entire* school roster |
| `src/lib/teachers/advisory.ts:56` | `gradeLevel` | +1 |

The repo already documents this cost at `src/app/teacher/(app)/aral/[gradeId]/attendance/page.tsx:253-260` and works around it once with a `sectionNames` Map. `relationJoins` generalizes that fix.

This is a schema `generator` change and therefore routes through `database-engineer` per the ownership rule in CLAUDE.md, even though it authors no migration.

**R4.3 — Fix `/teacher/aral/[gradeId]`, a redirect that costs a full page load.**
`src/app/teacher/(app)/aral/[gradeId]/page.tsx:18-34` is 34 lines that `redirect()` to `/teacher/aral?grade=…`. But it lives inside `teacher/(app)/`, and Next renders the layout before invoking the page — so `layout.tsx:18-53` runs its full `requireUser` + shell queries, then the page throws a redirect and all of it is discarded. Plus a browser round trip for the 307, then the real page render.

Reached from `src/components/learners/aral-section-filter.tsx:53` and `src/lib/notifications.ts:172`. Fix by rewriting those two call sites to target the destination directly, or by relocating the redirect above the authenticated layout.

Estimated ~760 ms @220 ms.

**R4.4 — Delete the duplicate `learner.count`.**
`src/app/teacher/(app)/aral/page.tsx:277-286` and `:83-92` build the same `where` from the same inputs. `resolveSection` (`:52-58`) collapses an invalid `?section=` to `"all"`, so whenever `?section=` is valid the two calls are byte-identical. Request-scoped memoization or a single hoisted call. Saving: 1 wave.

**R4.5 — Parallelize independent-but-sequential awaits.**

| Site | Issue |
|---|---|
| `src/app/teacher/(app)/learners/page.tsx:145` → `:163` | `section.findMany` has no dependency on the count that follows it |
| `src/app/…/terms-reports/page.tsx:133` → `:187` | `schoolYear.findFirst` needs only `user.schoolId` for a teacher; only the Super Admin path needs `grade.schoolId` |
| `src/lib/school-context.ts:35-43` | `auditLog.findFirst` is awaited **blocking the whole page** on every Super Admin school-head view, not just the first in the 8-hour window; on a miss it also awaits `writeAudit` (`:46`), then `getSchoolName` (`:50`) sequentially — +2 to +3 waves on every Super Admin drill-down, for a best-effort audit row |
| `src/app/admin/audit/page.tsx:22` → `:31` | `auditLog.findMany` then a dependent `school.findMany` for names |

The `count` → `findMany` pair on paginated pages is **genuinely dependent** (the `skip` clamp consumes the count) and must stay serial. Documented at `terms-reports/page.tsx:359-363`.

**R4.6 — Take `writeAudit` off the response path.**
`src/lib/audit.ts:105` is an awaited `prisma.auditLog.create()` called from 16 action files — one extra serialized round trip on every mutation, blocking the user's response, for a write that by design never throws and nobody awaits the result of. Use Vercel's `waitUntil` from `@vercel/functions`, or fold it into the mutation's existing `$transaction` where one is already open.

Also: `src/lib/actions/learner.ts:535-536` and `src/lib/actions/school-head.ts:302-303,312-313` call `await writeAudit(...)` **inside loops**.

**R4.7 — Narrow `revalidatePath` fan-out.**
111 calls, 35 in `src/lib/actions/learner.ts` alone. Editing one learner invalidates 35 route cache entries, forcing the user's next several navigations to be cold — each then paying full query cost. Replace broad path invalidation with the targeted tag helpers already built in `src/lib/cache/revalidate.ts`.

### R5 — Fix the bulk-write transactions (Phase 3)

Directly addresses R1. This phase is correctness work, not optimization.

1. Replace per-row loops with set-based statements: `createMany` for `import-learners.ts`; batched `upsert` via raw `INSERT … ON CONFLICT` or chunked `createMany` + `updateMany` for the three grid savers.
2. Add explicit `timeout:` (and `maxWait:`) to every `$transaction` that can carry more than a handful of statements. The 5-second default is wrong for bulk paths regardless of region.
3. Add `.max()` caps to the two unbounded Zod schemas: `reading-level.schema.ts:98,110` and `term-grade.schema.ts:36`. An unbounded array reaching a per-row loop is a denial-of-service shape as well as a timeout.
4. Chunk anything that can still exceed the cap, with progress reporting where the UI supports it.

Ordering note: much of R5's *urgency* disappears once R3 lands (at 5 ms/statement, ~1,000 statements fit in 5 s). Its *correctness* argument does not — the caps and explicit timeouts are right in any region.

### R6 — Indexes (Phase 4)

**Additive only.** Index drops are explicitly deferred by decision (see Decisions). Authored by `database-engineer`, applied by a human.

Ranked:

| # | Index | Fixes |
|---|---|---|
| 1 | `AuditLog (timestamp DESC)` | `/admin/audit` (`src/app/admin/audit/page.tsx:22`) is uncached, unindexed, unbounded — a full seq scan + top-N sort of the entire AuditLog table on every view. AuditLog grows on every mutation across every tenant, so it outpaces every learner table. Also fixes `src/lib/dashboard/aggregates.ts:96-103`. |
| 2 | `Learner (gradeLevelId, isAralLearner, fullName) WHERE deletedAt IS NULL` | The composite `Learner_schoolId_gradeLevelId_…` leads with `schoolId`, but ~20 sites filter `gradeLevelId` without it, so the index is unusable (Postgres 15/17; b-tree skip scan is PG 18). Teachers survive via a BitmapOr on `teacherId`/`aralTeacherId`; **Super Admin impersonation has no such predicate and triggers seven sequential scans of `Learner` per dashboard render.** `fullName` trailing eliminates the sort behind every paged grid. |
| 3 | `Attendance (recordedById)`, `ReadingLevelRecord (recordedById)` | These FKs are `RESTRICT` and unindexed. Postgres enforces that with a per-deleted-row `SELECT … FOR KEY SHARE`, so deleting one teacher seq-scans all of Attendance. `scripts/delete-schools.ts:281-320` will stop completing once Attendance passes ~10M rows. |
| 4 | `Learner (sectionId)`, `Enrollment (sectionId)` | `src/lib/actions/section.ts:167-175` runs two `updateMany` full table scans **inside a write transaction** to delete one ~40-learner section. `Enrollment_gradeLevelId_sectionId_idx` cannot serve it — `sectionId` is not leading. |
| 5 | `TermGrade (recordedById)`, `AttendanceDayMeta (recordedById)`, `Announcement (authorId)`, `Notification (actorId)`, `Enrollment (schoolYearId)` | Same FK-trigger argument, smaller tables. Lower priority. |
| 6 | `Learner (schoolId, fullName) WHERE deletedAt IS NULL AND archivedAt IS NULL` | Sort elimination on school-head rosters (`src/app/school-head/(app)/aral/page.tsx:61`, `src/lib/actions/search-learners.ts:44`). Both verified to carry both predicates, so the two-predicate partial is valid. |
| 7 | `pg_trgm` GIN on `Learner (fullName)` | Optional. `nameSearchWhere` (`src/lib/learners/pagination.ts:204-210`) is `ILIKE '%q%'`, which no b-tree can serve. With #6 in place this runs over ~3,000 rows per school, which is acceptable. Only justified if search widens cross-tenant. |

**Application path (decided):** author `CREATE INDEX CONCURRENTLY` statements plus an apply checklist. A human runs them against `DIRECT_URL` via psql, then records them with `prisma migrate resolve --applied`.

This is required, not stylistic: `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block**, and Prisma's migration runner wraps every migration file in one. These cannot ship via `prisma migrate deploy`. `CREATE INDEX CONCURRENTLY` takes only a `SHARE UPDATE EXCLUSIVE` lock, so reads and writes continue.

### R7 — Point the cache at the pages people actually use (Phase 5)

The cache layer is well-built and correctly keyed. Every `cachedQuery` key was audited against the tenancy contract in `src/lib/cache/unstable.ts:8-12`; **no cross-tenant key exists.** The `isSuperAdmin` discriminator in the teacher keys is necessary and present — without it, a Super Admin impersonating a teacher would poison that teacher's entry.

The problem is placement:

| Surface | Cached |
|---|---|
| `/admin`, `/school-head`, `/teacher` dashboards | fully |
| Teacher sidebar shell (300 s), school name (900 s), admin schools table (300 s) | yes |
| `/teacher/learners` — sections, count, findMany, 4 stat counts, advisory | **none** |
| `/teacher/aral` — count, sections, candidates, tutors, table count + findMany | **none** |
| `/teacher/aral/[gradeId]/attendance` — 5 reads | **none** |
| `/teacher/aral/[gradeId]/reading-level` — 6 reads | **none** |
| `/…/terms-reports` — 8 reads | **none** |
| Every server action | **none** |

Every cached read belongs to a dashboard someone opens once a day. Every read on the pages a teacher works in all day is uncached. The `volatile` profile (15 s, `src/lib/cache/profiles.ts:26-31`) is defined and **used nowhere**, despite being built for exactly this case.

Work:

1. Wrap roster and grid reads in `cachedQuery` with the `volatile` profile. Every key must carry `schoolId` **and** `teacherId` **and** `isSuperAdmin`, following the existing pattern at `aggregates.ts:511-516`.
2. Bound the unbounded aggregate at `src/lib/dashboard/aggregates.ts:283-288`: `readingLevelRecord.groupBy(["weekStart"])` has **no time predicate**, reads the school's entire reading history across all school years, and then `.slice(-6)` at `:328` discards all but six bars. Add a `weekStart >= <6 months ago>` bound. Pure query change — no schema, no counter, no approval needed.
3. Add a date part to the `getSchoolHeadCharts` and `getAdminActivitySeries` keys, or leave a comment pinning their TTL. Both compute `daysAgo(6)` *inside* the cached function while the key carries no date — safe only because the TTL is 60 s. If anyone raises that TTL, the 7-day window silently freezes.

**Do not "clean up"** `getTeacherOverview` returning `todayKey`/`weekStartKey` as strings (`src/lib/dashboard/teacher-overview.ts:41-47`). It is deliberate and load-bearing: `unstable_cache` JSON-serializes, so a `Date` would return as a string and every method call would throw.

### R8 — Make the shell paint on hard navigation (Phase 6)

`src/app/teacher/(app)/layout.tsx:18,46-53` awaits `requireUser`, then `Promise.all([getSchoolName, getTeacherShellContext])`, **before** rendering `RoleShell`. A segment's own `loading.tsx` cannot cover its parent layout — so the fallback that actually shows on a hard load is the **root** `src/app/loading.tsx`, which renders `null` by design.

Result: hard-loading or refreshing any `/teacher` route shows a **blank screen** for an estimated 100–270 ms. Same shape at `src/app/school-head/(app)/layout.tsx:15,29`. There are 33 `loading.tsx` files and the one that fires here is the empty one.

Work:

1. Push the session read below `RoleShell` so the chrome renders from static/cached data and the authenticated content streams behind `<Suspense>`.
2. Add Suspense boundaries to the five fully-blocking routes: `aral/[gradeId]/learners/[id]/{attendance,reading-level,update}`, `grade/[id]/learners/[learnerId]`, and `/teacher/terms-reports` (which has no `loading.tsx` at all).
3. Move the blocking `await Promise.all` at `src/app/teacher/(app)/aral/page.tsx:276-327` below `<AppShell>`. It includes an unbounded `learner.findMany` (`:305-321`) feeding `<EnrollToAralDialog>` — a dialog that is usually closed. The same pair is already correctly streamed behind Suspense on the attendance and terms sheets (`_enroll-action.tsx:26-52`), so the pattern exists in-repo.

### R9 — ARAL weekly attendance grid (Phase 7)

The only unpaginated grid in the app. Every sibling paginates.

1. **Add `skip`/`take`** to `src/app/teacher/(app)/aral/[gradeId]/attendance/page.tsx:201-209` and the companion `attendance.findMany` at `:210-221`, matching the pattern already used at `reading-level/page.tsx:258-259` and `terms-reports/page.tsx:389-390`.
2. **Memoize the row.** `src/components/forms/aral-weekly-attendance-grid-form.tsx` — `setStatus` (`:269-281`) and `setNotes` (`:283-289`) both spread a new top-level `rows` object, and rows render inline via `learners.map` (`:434`) with no `React.memo` row component. The Remarks field is a text `<Input>` (`:511-518`), so this fires **per character**. Extract a memoized row keyed on that row's own slice of state.
3. Memoize `days = buildDays(...)` (`:237`). Its unstable identity currently invalidates `handleSave`'s `useCallback` (`:370-380`) and the `useImperativeHandle` (`:382`) on every render, so that memoization presently does nothing.
4. Remove the doubled scroll container: `:411` wraps in `overflow-x-auto`, and the `Table` primitive already wraps in `relative w-full overflow-auto` (`src/components/ui/table.tsx:6`). Same at `aral-monthly-reading-level-grid-form.tsx:508`.

Estimated cost without this, at 120 learners on the low-end Windows hardware typical of DepEd schools: **30–55 ms per character.** Estimates only — no profiler was run. Designed for the worst case by decision, since ARAL cohort size varies by school and the fix is the same either way.

`aral-monthly-reading-level-grid-form.tsx` has the same whole-table re-render shape via `setField` (`:340-346`) and is paginated at 10 but offers `perPage=100`. Apply the same row memoization.

### R10 — Forms: stop serializing the whole form four times per keystroke (Phase 7)

`src/components/forms/teacher-profile-form.tsx:365` and `src/components/forms/sh-profile-form.tsx:228` call bare `form.watch()`, which subscribes to **all** fields and re-renders the entire component on every change.

Both also pass `enableUnsavedGuard`, activating `useReliableFormDirty` (`src/components/forms/app-form.tsx:78-117`), which registers **two independent subscriptions to the same events** — `form.subscribe({...})` at `:104-107` and `form.watch(() => sync())` at `:108`. Each `sync()` runs two `stableSerialize` passes (`:92-93`), and `stableSerialize` (`src/hooks/unsaved-changes-context.tsx:123-134`) is a `JSON.stringify` that allocates a fresh key-sorted object for every object it visits.

Net: **four full serializations of the form per character typed.**

Work: replace bare `form.watch()` with field-scoped `watch(["currentGradeAssignment", "sectionId"])` — the only two fields the derived memos consume — and collapse the double subscription in `useReliableFormDirty` to one.

Worst case is **edit mode** (`/teacher/settings/profile`, `/school-head/settings/profile`), where every gate carries `isEdit ||` so all ~20 fields mount simultaneously. In wizard mode only ~4–6 mount at a time.

### R11 — Prefetch amplification (Phase 2, low priority)

`src/components/nav-prefetcher.tsx:111` issues `router.prefetch(href, { kind: "full" })` — a **complete RSC render** of the target, re-running middleware, `requireUser`, layout queries, and page queries. It fires on mount, every `WARM_TTL_MS = 480_000`, on every `visibilitychange → visible`, and on `invalidateNavWarm`.

Real server load is therefore roughly **4× visible navigations**, each paying the R0 fixed cost and holding one of `connection_limit=3` (`src/lib/db-url.ts:31`). This is precisely the P2024 pressure the code comments describe at `nav-prefetcher.tsx:22-27` and `session.ts:42-45`.

Two concrete defects:

1. **`INTENT_DELAY_MS = 80`** (`src/lib/nav/prefetch-intent.ts:12`) is aggressive; typical hover-intent thresholds are 150–250 ms. Sweeping a cursor down a vertical sidebar trips intent on most rows in between. Capped at `MAX_INTENT_PREFETCHES = 12` (`:15`), so worst case is 12 full RSC renders of `force-dynamic` routes per page view.
2. **Three call sites violate the rule the file itself states.** `nav-prefetcher.tsx:84-85` says *"do not FULL-warm reports, rosters, or transfer here."* Yet `getLearnerDetailWarmHrefs` (`src/lib/nav/warm-hrefs.ts:75`) FULL-warms `/teacher/learners?grade=…` (4 Prisma queries) and `getAralActionWarmHrefs` (`:87-90`) FULL-warms `/teacher/aral?grade=…` (the 8-wave page from R0).

Deliberately deferred until after R3. Prefetching is a *multiplier* on per-request cost; once co-located it becomes cheap and the aggressive settings may be correct. Re-evaluate with data rather than tuning blind.

### R12 — Next.js 16 (Phase 8, gated, deferrable in full)

Two separable decisions.

> **How "conditional go" and "deferrable in full" fit together.** Decision A is
> a *go* in the sense that the upgrade is worth doing and nothing here argues
> against it on its merits. It is *conditional* on Phases 0–7 having shipped and
> been measured first, and on the e2e gate below. And the whole phase is
> **deferrable indefinitely** because none of it addresses the actual bottleneck
> — if this program stopped after Phase 7, the latency target would still be
> met. Treat Phase 8 as scheduled maintenance that happens to be adjacent, not
> as part of the performance work.

**Decision A — upgrade to Next 16 without `cacheComponents`: go, but last.**

This is maintenance, not optimization. Nothing in it addresses the R0 bottleneck. Its performance content is the routing/prefetch overhaul (layout deduplication, incremental prefetching), which is real but second-order.

Migration surface, measured against this repo:

| Change | Impact |
|---|---|
| `next lint` **removed**; `next build` no longer lints | **Breaks the `lint` script and the CI gate.** Codemod: `next-lint-to-eslint-cli` |
| ESLint flat config default | `eslint-config-next` must bump; `.eslintrc` → flat |
| `middleware` → `proxy` | See runtime decision below |
| `revalidateTag(tag)` needs a second `cacheLife` arg | **8 calls, all in `src/lib/cache/revalidate.ts`** — one-file edit |
| `revalidatePath` | **unchanged** — all 111 calls safe |
| Turbopack default for `next build` | No custom webpack config → safe |
| `next dev` → `.next/dev`; dev and build concurrent | **The `NEXT_BUILD_DIST_DIR` Windows EPERM workaround in `next.config.mjs:1-13` can be deleted** — a genuine cleanup win |
| Parallel routes need `default.js` | **0 parallel routes → no impact** |
| Node 20.9+ / TS 5.1+ | CI on Node 20, local 22.14, TS 5.6 → fine (bump CI to 22 for headroom) |
| React 19.2 | already on 19.2.8 → fine |
| `next/image` defaults (`qualities: [75]`, `minimumCacheTTL` 60 s → 4 h, `imageSizes` drops 16) | 10 imports, no `images` config → low risk, verify visually |

Upgrade command: `npx @next/codemod@canary upgrade latest`.

**Unresolved sub-decision — `middleware` vs `proxy`.** The `edge` runtime is **not supported** in `proxy`; `proxy` is Node.js and the runtime cannot be configured. `src/lib/auth/roles.ts` exists specifically to be Edge-safe (pure, no Prisma, no `server-only`), and that split becomes pointless under `proxy`. `middleware.ts` still works in 16, deprecated.

**Recommendation: keep `middleware.ts` on Edge.** A cookie refresh plus a prefix check is exactly the cheap, Edge-shaped work Edge is good at, and moving it to Node trades that for cold starts on every request. This is a deferral, not a resolution — revisit when Vercel publishes Edge guidance for `proxy`. **Do not accept the codemod's rename blindly.**

Also unverified: whether `experimental.staleTimes` and `experimental.serverActions.bodySizeLimit` survive Next 16 unchanged. Neither is listed among removals, but neither is confirmed. Check before assuming.

**Decision B — enable `cacheComponents` / PPR: no-go for now.**

For a 100%-authenticated app whose bottleneck is transpacific latency, PPR makes the *skeleton* appear sooner around data that arrives **no sooner**. The static shell can contain only chrome — every learner name, score, and roster row still streams and still costs the same round trips.

Costs land squarely on this codebase's weak points:

- **Persistence regression.** `unstable_cache` persists across instances and deployments; `use cache` defaults to in-memory, per-instance, single-deployment. A naive port of the 14 `cachedQuery` sites would *reduce* dashboard cache hit rate. Recovering parity requires `use cache: remote`.
- **Tenancy governance downgrade.** The explicit, reviewable `keyParts` array becomes an implicit compiler-derived key. Cache keys and `cacheTag` values are stored in **plain text**, unhashed. In a codebase where CLAUDE.md names cross-tenant leakage the worst shippable bug, losing the auditable key list is a real loss.
- **`<Activity>` state preservation.** Routes are hidden rather than unmounted, so `useState`, form inputs, `useActionState` results, and scroll position persist across navigations. With 108 client components, heavy `react-hook-form` usage, and 24 files using Radix dialogs/popovers, this is a broad regression surface: dropdowns stay open on back-navigation, dialogs skip init effects, submitted forms retain stale success/error state.
- **Prerender-hostile synchronous IO.** 17 non-client files use `new Date()`, `Date.now()`, `Math.random()`, or `crypto.randomUUID()`. These are **hard build errors** under `cacheComponents` that the `instant = false` escape hatch cannot defer. `src/lib/date-keys.ts` and the ARAL grid pages are directly in the blast radius.
- **Five layouts to restructure**, plus an audit of ~107 `requireUser`/`getCurrentUser` call sites for boundary placement.

The one genuinely attractive piece is `use cache: private`, which *can* read `cookies()` and produces a prefetchable per-session App Shell. But it is browser-only, never stored server-side, and does not persist across reloads — narrower than it first appears. R8 delivers most of the same perceived benefit under Next 15 at a fraction of the risk.

**Revisit only after Phases 0–7 have shipped and Speed Insights shows shell-render time — not data-fetch time — is what users wait on.**

**Gate for Phase 8:** e2e coverage is currently **2 spec files** against 68 unit test files. That is too thin to catch `middleware`→`proxy` and `<Activity>` regressions. Phase 8 does not start until e2e covers the login flow, one roster page, and one grid save per role.

## Decisions already made

| Decision | Choice | Rationale |
|---|---|---|
| Optimize for | Production first; dev speed as a secondary win | User |
| Scale assumption | 3,000+ learners/school, many schools | User |
| Risk appetite | Config + query + caching; Next 16 considered | User |
| Index application | Author `CREATE INDEX CONCURRENTLY` + checklist; human applies via psql on `DIRECT_URL`, then `prisma migrate resolve --applied` | User; also technically required — concurrent builds cannot run in Prisma's transaction-wrapped migrations |
| Index drops | **Deferred.** Adds only this round | User. Four dead/harmful indexes documented below as follow-up |
| ARAL grid sizing | Design for the worst case — pagination **and** memoized row | User; cohort size varies by school and the fix is identical either way |
| Region config format | `vercel.json`, not `vercel.ts` | A single static `regions` line does not justify a dependency plus build-time execution |
| Cache Components | **No-go this round** | See R12 Decision B |

**Two phases fall outside the stated "config + query + caching only" appetite and are included deliberately:**

- **R5 (bulk writes)** is logic work, but it fixes what is probably a live production outage.
- **R8 (layout restructure)** is component work, but it fixes a blank screen on every hard navigation.

Both were flagged at design time and accepted. If either should drop to a documented backlog instead, say so before implementation planning.

## Non-goals

- No redesign of information architecture, navigation, or page layouts.
- No denormalization, counter columns, or materialized views. Ruled out by the user. The audit found exactly one aggregate that genuinely resists indexing (`aggregates.ts:283`), and its fix is a `where` bound rather than a schema change — so nothing forces this decision to be revisited.
- No index drops this round.
- No `cacheComponents` / PPR adoption.
- No Prisma 5 → 6 upgrade. Vercel's `attachDatabasePool` Fluid pattern requires driver adapters, which Prisma 5.22 does not expose. Speculative until connection leakage is evidenced.
- No `Server-Timing` header. Not native to Next.js; OTel supersedes it.
- No client bundle work beyond R10. The boundary is already in good shape: exceljs is server-only, recharts and papaparse are correctly lazy, and only two of 108 `"use client"` files are accidental (both under 2 KB).
- No changes to tenancy rules, auth semantics, or business logic beyond R4.1's stated tradeoff.

## Constraints

- Next.js 15.5.23 / React 19.2.8 / Prisma 5.22 / Tailwind 3.4 / TypeScript strict until Phase 8.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` must all pass before any phase is declared done.
- **Never apply migrations or destructive SQL to any remote database.** Author only; a human applies. See `docs/migrations.md`.
- Every school-scoped query keeps `schoolId` in its `where`, or validates via `assertSameSchool`.
- Every cache key keeps its tenant discriminator. No exceptions.
- Rendered HTML is never cached on `force-dynamic` role pages (carried forward from the 2026-08-14 spec).
- `.npmrc` `legacy-peer-deps=true` and the `@types/react` overrides stay when touching dependencies.

## Risks and open questions

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Phase 1 is a no-op** because the region is already `sin1`. Every estimate then drops ~11× and the ranking shifts toward R4–R7. | Phase 0 blocks on confirming this. |
| 2 | **The 220 ms RTT model is wrong.** All wave arithmetic re-bases. | The R1 `P2028` test falsifies or confirms it in five minutes. |
| 3 | R4.1 widens the revocation window to ≤ 1 hour for users banned directly in Supabase Auth. | App-level gates still re-check Postgres every request. Consider shortening JWT expiry. Accepted. |
| 4 | Concurrent index builds on `Attendance` take time proportional to table size and can fail, leaving an `INVALID` index. | Apply checklist includes verifying `indisvalid` and dropping/retrying on failure. |
| 5 | R7's added caching increases staleness on roster pages. | 15 s `volatile` TTL; existing tag invalidation already fires on the relevant mutations. |
| 6 | R8's layout restructure risks regressing role gating — the worst possible bug here. | `requireUser` stays authoritative in every page and action. Middleware is defense-in-depth, not the gate. Add e2e coverage for role redirects first. |
| 7 | Phase 8's `<Activity>` behavior change affects 24 dialog/popover files. | Gated behind e2e coverage. Deferrable in full. |
| 8 | Fluid Compute concurrency may make `connection_limit=3` (`src/lib/db-url.ts`) too **low**, not too high — one instance serving many concurrent requests through one pool of 3. | Measure P2024 rate against the setting before changing it. Do not tune blind. |

**Open questions requiring an answer before the phases that depend on them:**

1. What Vercel plan is this on? Observability Plus gates the per-route latency breakdown (R2). Not blocking — Speed Insights + OTel suffice.
2. Is `@supabase/ssr` 0.5.2 → 0.12.4 in scope? Badly stale, independent of everything here, and not blocked by Next 16. Recommend a separate task.
3. Should the four documented index drops be scheduled as a follow-up? They roughly pay for the write cost of R6's additions.

## Follow-up work, documented and deliberately not scheduled

**Index drops (deferred by decision):**

| Index | Verdict |
|---|---|
| `User_authId_idx` | **Strictly redundant** — `authId` is already `@unique`, so `User_authId_key` serves every lookup. Two identical b-trees on the hottest auth column, maintained on every `User` write. |
| `AttendanceDayMeta_date_idx` | Dead — every query is `gradeLevelId + date`, served by the unique constraint. |
| `ReadingLevelRecord_weekStart_idx` | Dead — every `weekStart` range query carries a `learner` filter. |
| `Attendance_date_idx` | Dead as an access path, and a **plan hazard**: it is the only thing making a cross-tenant "scan every school's week" plan available for `aggregates.ts:269-276`. Judgement call. |

**Tenancy hardening (free, recommended):** three ARAL `learnerWhere` objects filter `gradeLevelId` without `schoolId` — `attendance/page.tsx:178-185`, `reading-level/page.tsx:180-188`, `aral-grid.ts:63-72`. They are **safe today**: the grade was resolved through a `schoolId`-scoped `findFirst` immediately above, and a `GradeLevel` belongs to exactly one school. But the safety is *contextual*, not local — one refactor moving the query away from its guard turns it into a cross-tenant leak. Adding a redundant `schoolId` costs nothing at query time, since it becomes the leading column of the index added in R6 #2.

**Correctness bug found in passing (already logged separately):** `src/lib/cache/schools-list.ts:88` uses `_count: { select: { users: true, learners: true } }` with no `deletedAt: null` filter, so the admin schools table displays counts that include soft-deleted records. Not a performance issue.

**Scale-model corrections worth recording**, since they contradict the brief this work started from:

- `Attendance` is **ARAL-scoped only** — both the read grid and the write path (`src/lib/actions/attendance.ts:214-224`) hard-require `isAralLearner: true`. At ~20% ARAL enrollment that is ~120k rows/school/year, not 600k. The larger figure is the ceiling if ARAL ever widens to the full roster.
- `ReadingLevelRecord` is **monthly in practice**, not weekly. The schema says `@@unique([learnerId, weekStart])`, but `bulkRecordMonthlyReadingLevel` (`src/lib/actions/reading-level.ts:160-171`) upserts on a month anchor. The column name and the range-scan read exist to tolerate legacy weekly rows. Roughly an order of magnitude smaller than a weekly model implies.

## Sequencing

```
Phase 0 (blocking) ──► Phase 1 (alone, re-measure) ──► Phase 2 ──► Phase 3
                                                          │
                                    ┌─────────────────────┴─────────┐
                                    ▼                               ▼
                              Phase 4 (indexes)              Phase 5 (cache)
                                    └─────────────┬─────────────────┘
                                                  ▼
                                        Phase 6 ──► Phase 7
                                                       │
                                                       ▼
                                          Phase 8 (gated on e2e)
```

Phase 1 ships alone. Phases 4 and 5 may run in parallel — different owners (`database-engineer` vs `backend-developer`), no file overlap. Phase 8 is deferrable indefinitely.
