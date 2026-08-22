# Latency & Throughput — Implementation Plan

**Spec (binding authority):** `docs/superpowers/specs/2026-08-22-latency-and-throughput-design.md`
**Branch:** `perf/latency-and-throughput`
**Date:** 2026-08-22

This plan decomposes the spec's Phases 0–7 into tasks. Phase 8 (R12 / Next 16) and R11
(prefetch tuning) are deliberately out of scope — see the spec's own deferral language and
the rulings in the SDD ledger.

## Global Constraints

These bind every task. A task that violates one has failed regardless of whether its own
requirements are met.

1. **Stack is frozen.** Next.js 15.5.23 / React 19.2.8 / Prisma 5.22 / Tailwind 3.4 /
   TypeScript strict. Do not upgrade Next, React, Prisma, or Tailwind. Adding a new
   *runtime* dependency is allowed only where a task explicitly names it.
2. **Never apply migrations or destructive SQL to any remote/shared database.** Forbidden:
   `prisma migrate deploy|dev|reset`, `prisma db push`, and any `DROP`/`TRUNCATE`/unbounded
   `DELETE`/`UPDATE` via psql or the Supabase SQL editor. You *author* migrations; a human
   applies them. Safe: `prisma validate`, `prisma format`, `prisma generate`,
   `prisma migrate diff --script` with file inputs.
3. **Tenancy.** Every school-scoped query keeps `schoolId: user.schoolId` in its `where`, or
   validates ownership via `assertSameSchool` (`src/lib/auth/tenant.ts`). Cross-tenant
   leakage is the worst bug shippable in this repo.
4. **Every cache key keeps its tenant discriminator.** No exceptions. New `cachedQuery` keys
   carry `schoolId` **and** `teacherId` **and** `isSuperAdmin` where the read is
   teacher-scoped, following the existing pattern in `src/lib/dashboard/aggregates.ts`.
5. **Rendered HTML is never cached on `force-dynamic` role pages.** A Full Route Cache entry
   is shared across users and would leak one school's data to another tenant. Carried
   forward from the 2026-08-14 spec. Do not add `revalidate`, remove `force-dynamic`, or
   introduce `cacheComponents`/PPR.
6. **`requireUser` stays authoritative.** Middleware is defense-in-depth only. No task may
   move, weaken, or make conditional the `requireUser` / `requireSchoolUser` gate in any
   page or action. Restructuring a layout must leave every page's own gate intact.
7. **Server action shape.** Actions stay `"use server"` in `src/lib/actions/*.ts` and keep
   returning the discriminated `ActionResult` rather than throwing. Order stays: auth guard →
   Zod `safeParse` → ownership check → mutate → `writeAudit` → revalidate.
8. **Audit metadata never contains** passwords, tokens, invite secrets, or activation
   credentials. Log resource IDs and counts. New audit actions go in the `AUDIT_ACTIONS` map.
9. **Soft delete.** Reads filter `deletedAt: null` unless archived rows are explicitly wanted.
   `Learner`'s denormalized current grade/section pointers stay transactionally consistent
   with the active `Enrollment` row.
10. **Dates.** Use `formatLocalDateKey` / `parseLocalDateKey` from `src/lib/date-keys.ts`.
    Never `toISOString()` for a date key — it shifts the day in UTC+8.
11. **`.npmrc` `legacy-peer-deps=true` and the `package.json` `overrides` for
    `@types/react` / `@types/react-dom` stay.** Install with `npm install`, which picks up
    `.npmrc`. Do not add `--force` or edit the overrides.
12. **Gates.** `npm run typecheck`, `npm run lint`, `npm run test` must pass before a task
    reports DONE. `npm run build` must pass for tasks that touch config, the root layout,
    routes, or dependencies — and for every task in doubt. On Windows, if
    `npm run build` fails with `EPERM ... rename query_engine-windows.dll.node` because a
    dev server is running, note that the failure is in `prisma generate` — the first half of
    `prisma generate && next build` — so `next build` never starts and the error is not about
    your change. Skip that half and build to a scratch dir instead:
    `$env:NEXT_BUILD_DIST_DIR = ".next-verify"; npx next build` — then
    `git checkout -- tsconfig.json next-env.d.ts` to drop the churn it causes. That EPERM is
    **not** a blocked verification: run all four gates anyway.
13. **Enum labels.** Adding a Prisma enum value means updating
    `src/lib/constants/enum-labels.ts` too.
14. **Scope discipline.** Implement exactly what your task's brief requires. Do not fix
    unrelated issues you notice — report them in your report file instead. Do not refactor
    surrounding code for style. No speculative abstraction (YAGNI).
15. **Commit your own work** with a conventional-commit message. Do not amend or rebase
    commits you did not create. Do not push. Do not merge. Do not run `git clean -fdx`
    (it destroys the SDD workspace).
16. **Never dispatch subagents.** You are the implementer. Review arrives from the
    controller after your report.

## Measurement caveat that applies to the whole plan

The spec's success criterion is a before/after number from Vercel Speed Insights and
OpenTelemetry, filtered to Philippines traffic, per route. **No task in this plan can
satisfy that** — it needs production traffic over several days plus Vercel dashboard access.
Tasks deliver the code and the instrumentation; the human closes the measurement loop. Do
not claim a latency improvement you did not measure. Report what you changed and what it is
predicted to save, labelled as prediction.


---

## Reading these tasks

Every task names a **recon file** under
`.superpowers/sdd/2026-08-22-latency-and-throughput-implementation/`. That file was produced by a
read-only verification pass against the actual code and it **overrides the spec on every
factual detail** (line numbers, file paths, what a function currently does). The spec still
owns intent and scope. Where a task says "Ruling:", that decision is already made — implement
it, do not relitigate it.

"terms-reports" in this plan always means
`src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx` (the 442-line sheet), never
`src/app/teacher/(app)/terms-reports/page.tsx` (the 90-line redirect resolver). Where the
resolver is meant, this plan says "the terms-reports resolver".

Each task is its own commit. Do not squash across tasks — Phase 1 (Task 2) must be able to
ship alone.

---

## Task 1: Phase 0 — observability plumbing

**Owner:** backend-developer · **Recon:** `recon-phase-0-r2-observability-plumbing.md`
**Spec:** R2 / Phase 0

**Goal.** Install and wire the instrumentation the whole program's before/after numbers depend
on. No latency change is expected from this task.

**Files.** `package.json` · `src/app/layout.tsx` · `src/instrumentation.ts` (new) ·
`src/lib/auth/session.ts` · `.env.example` · `docs/deployment.md` (env note only)

**Steps.**

1. Install as **runtime** dependencies (not devDependencies — `next build` must resolve them):
   `npm i @vercel/speed-insights @vercel/otel @opentelemetry/api @vercel/functions`
   `@vercel/functions` is installed here because Task 7 needs it; nothing in this task imports it.
   After installing, confirm `.npmrc` still contains `legacy-peer-deps=true` and that
   `package.json`'s `overrides` for `@types/react` / `@types/react-dom` are unchanged. If npm
   rewrote either, restore it.
2. Mount `<SpeedInsights />` from `@vercel/speed-insights/next` in the root layout
   (`src/app/layout.tsx`), inside `<body>`, after the existing children. It is inert when the
   project is not linked to Vercel — that is expected and is a human action, not a bug.
3. Create `src/instrumentation.ts` exporting `register()` that calls
   `registerOTel({ serviceName: "litrack" })` from `@vercel/otel`. Nothing else in the file.
4. **Ruling — span mechanism.** Do **not** touch `src/lib/prisma.ts`. It has no per-query seam
   (only a static `log` array on the constructor), and adding an extension or middleware to hang
   spans on would disturb the production `log: ["error"]` gate for no measurement benefit.
   **Corrected after the Task 1 review:** `@vercel/otel` ships fetch auto-instrumentation ONLY, and
   Prisma 5 tracing is a preview feature this program deliberately leaves off, so there are **no**
   DB query spans anywhere in the app. The `litrack.auth.user_lookup` span below is the only DB
   timing signal that exists — absent query spans elsewhere are expected, not a broken exporter,
   plan tier, or deploy link. Hand-roll exactly two spans,
   both in `src/lib/auth/session.ts`:
   - one wrapping `await supabase.auth.getUser()` (locate by symbol: the `supabase.auth.getUser()` call inside `getCurrentUserCached`)
   - one wrapping the `loadUserByAuthId` call (helper declared immediately above `getCurrentUserCached`)

   Use `trace.getTracer("litrack")` from `@opentelemetry/api` with `startActiveSpan`. The
   second span **must** record whether the Prisma `P2024` retry path fired, as a span attribute
   (e.g. `litrack.user_lookup.retried`), or the numbers will read as one round trip when they
   were two.
5. Both spans sit inside `React.cache()` (the `cache(...)` wrapper on `getCurrentUserCached`). Add a short comment saying so — they
   fire once per request regardless of how many callers ask for the user, and a reader comparing
   span counts to call sites will otherwise think instrumentation is missing.
6. `NEXT_OTEL_VERBOSE` is read by Next.js itself, not by app code. **Ruling:** no change to
   `src/lib/env.ts`. Document the variable in `.env.example` (commented out, with a one-line
   note that it is optional and verbose) and in `docs/deployment.md`'s env table. If any future
   variable must be app-readable, the rule is: add it to **both** `serverEnvSchema` (env.ts:14-24)
   **and** `readEnvInput()` (env.ts:31-43) — they duplicate the allowlist.

**Out of scope.** `Server-Timing` headers (spec non-goal). Any change to `src/lib/prisma.ts`.
Making `PRISMA_LOG_QUERIES` active in production.

**Verification.** The four gates (Global Constraint 12). The build must succeed with the new
`instrumentation.ts` present — that is the real gate on this task.

**Commit.** `chore(perf): add speed insights and otel instrumentation`

---

## Task 2: Phase 1 — pin the function region to sin1

**Owner:** devops · **Recon:** `recon-phase-0-r2-observability-plumbing.md` (B2)
**Spec:** R3 / Phase 1

**Goal.** The single highest-value change in the program: move Vercel functions into the same
region as the Supabase database (`ap-southeast-1`, Singapore), eliminating roughly 200 ms per
round trip on a path that costs at least two sequential round trips per authenticated render.

**Files.** `vercel.json` (new) · `docs/deployment.md`

**Steps.**

1. Create `vercel.json` at the repo root with exactly this content and nothing else:

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "regions": ["sin1"]
   }
   ```

   No `functions`, no `crons`, no `headers` — security headers live in `next.config.mjs` and
   must stay there.
2. In `docs/deployment.md`, add a short subsection under the Vercel section: why `sin1`
   (co-location with the Supabase project in `ap-southeast-1`), that `sin1` compute bills at
   1.25× `iad1` rates (corrected 2026-08-22 from an uncited "1.5×" — source in the spec), and
   that this file is the only thing pinning the region.
3. **This task ships alone.** Its commit must contain only the two files above, so the human can
   deploy it and re-measure with nothing else confounding the delta. Do not touch source.

**Ruling — what cannot be verified here.** Which region the project deploys to today and whether
Fluid Compute is on are dashboard reads. Two items originally listed here were resolved locally
during the fix round: `.vercel/project.json` proves the project **is** linked (`project-litrack`),
and its `orgId` is a `team_` scope, which puts the account on Pro or Enterprise rather than Hobby —
so the Pro on-demand regional rates are the operative ones. They stay human actions and are listed in Task 16's checklist. Authoring
`vercel.json` is correct regardless of the current region: if it is already `sin1` the file is
a no-op that documents the requirement.

**Verification.** Confirm `vercel.json` is valid JSON, then run the four gates to prove the new
root file breaks nothing.

**Commit.** `perf: pin vercel functions to sin1`

---

## Task 3: R4.1 — replace getUser() with getClaims()

**Owner:** backend-developer · **Recon:** `recon-r4-1-replacing-supabase-auth-getuser-wit.md`
**Spec:** R4.1

**Goal.** `supabase.auth.getUser()` is a network call to the Supabase Auth server on every
authenticated render. `getClaims()` verifies the JWT locally with WebCrypto against a
module-cached JWKS, removing one full round trip from the critical path.

**Files.** `src/lib/auth/session.ts` · `src/middleware.ts`

**Steps.**

1. In `getCurrentUserCached` (locate the `getUser()` call by symbol, not by line — Task 1 shifted this file), replace
   `supabase.auth.getUser()` with `supabase.auth.getClaims()`. The authenticated subject is
   `data.claims.sub` — use it wherever the old code used `user.id` for the `authId` lookup.
2. **Ruling — mandatory try/catch.** `getClaims()` is **not** a drop-in for `getUser()`'s
   never-throws contract: it can throw a plain `Error` (e.g. from `validateExp`). An escaped
   throw would land on `src/app/teacher/error.tsx` instead of redirecting to `/login`, which is
   a visible regression. Required shape:

   ```ts
   let claimsResult;
   try {
     claimsResult = await supabase.auth.getClaims();
   } catch (err) {
     console.error("getClaims failed", err);
     return null;
   }
   const { data, error } = claimsResult;
   if (error || !data?.claims?.sub) return null;
   ```

   Match the surrounding file's existing `console.error` style (the `signOut` catches).
3. Do **not** pass `allowExpired: true`. That suppresses `exp` checking rather than handling the
   throw, and would let an expired session render.
4. Apply the same try/catch treatment to the call at `src/middleware.ts:56` while you are in
   there. Middleware is defence-in-depth (Global Constraint 6) — a throw there must fail closed
   to the login redirect, never to a 500.
5. The spec's line reference for this helper points at nothing relevant (it lands on a `: "";`). The
   helper the spec meant is `loadUserByAuthId`, declared immediately above `getCurrentUserCached`.
   **It is untouched
   by this task** — only its caller changes.

**Verification.** Four gates. Then read `src/lib/auth/roles.ts` and confirm nothing there
depends on the `User` object shape `getUser()` returned — `getClaims()` returns claims, not a
user record. If anything does, that is a real finding: report it, do not paper over it.

**Commit.** `perf: verify session jwt locally with getClaims`

---

## Task 4: R4.2 — Prisma relationJoins

**Owner:** database-engineer · **Recon:** `recon-r4-2-enabling-the-prisma-relationjoins-p.md`
**Spec:** R4.2

**Goal.** Nested `select`/`include` currently costs one round trip per relation. With
`relationJoins`, Prisma emits a single `LATERAL` join. Each relation collapsed is one fewer
cross-network round trip on the read path.

**Files.** `prisma/schema.prisma` (generator block only) · the read sites the spec names ·
`docs/migrations.md` (one note)

**Steps.**

1. Add `relationJoins` to `previewFeatures` on the `generator client` block in
   `prisma/schema.prisma`. **No model, field, index, or migration change in this task** — the
   generator block is the only edit to that file. (Task 10 owns the model-level edits; it runs
   after this one.)
2. Run `npx prisma generate`. The `relationLoadStrategy` argument does not exist in the
   generated types until this runs, so verification must follow generation.
3. **Ruling — be explicit, do not infer the default.** The default `relationLoadStrategy` in
   Prisma 5.22.0 with the flag on cannot be determined from the installed package, and there is
   no local database here to settle it empirically. Therefore add an explicit
   `relationLoadStrategy: "join"` at each read site the spec names, so behaviour is deterministic
   regardless of the default. If the generated client rejects the argument at a particular site
   (some query shapes do not accept it), **leave that site unchanged and list it in your
   report** — do not invent a workaround.
4. **Correction to the spec's round-trip table.** `src/lib/actions/export-learners.ts` is
   undercounted. There are two selects with different shapes: `learnerReportSelect` (:29-40) has
   2 relations; `learnerExportSelect` (:42-66) has 3 (`gradeLevel`, `section`, `aralProfile`).
   Treat the export path as +3 and the report path as +2.
5. In `docs/migrations.md`, add one line recording that `relationJoins` is enabled and that
   `PRISMA_RELATION_LOAD_STRATEGY` (native engine only) is the per-environment kill switch if a
   join plan regresses.

**Verification.** `npx prisma validate` and `npx prisma format` (both offline and safe), then
`npx prisma generate`, then the four gates. Typecheck is the real signal: it proves the argument
is accepted at every site you edited. Do **not** run any `prisma migrate` command or
`prisma db push` (Global Constraint 2).

**Commit.** `perf: load prisma relations with lateral joins`

---

## Task 5: R4.3 + R4.4 — delete the [gradeId] redirect and the duplicate learner count

**Owner:** backend-developer · **Recon:** `recon-r4-3-r4-4-r4-5-redirect-page-duplicate-c.md`
**Spec:** R4.3, R4.4

**Goal.** R4.3 is the largest waterfall win in Phase 2: `/teacher/aral/[gradeId]` is a page that
authenticates, queries, and then `redirect()`s — the client pays a full render plus a second
full navigation (~760 ms before co-location). R4.4 removes a redundant `learner.count`.

**Files.** `src/app/teacher/(app)/aral/[gradeId]/page.tsx` (delete) ·
the ARAL section filter component (`aral-section-filter.tsx`, around :53) ·
`src/lib/notifications.ts` (:172) · `src/app/teacher/(app)/aral/page.tsx` ·
the two tests that assert the redirect

**Steps — R4.3.**

1. Before deleting anything, run `grep -rn "aral/\[gradeId\]" src tests e2e` and
   `grep -rn "/teacher/aral/" src tests e2e` and enumerate **every** producer of a
   `/teacher/aral/<id>` URL. Recon found three (`aral-section-filter.tsx:53`,
   `notifications.ts:172`, and two tests) — confirm that list is complete before you delete the
   page, because a missed producer is a live 404.
2. Rewrite each producer to the destination the redirect was computing, in the
   `/teacher/aral?grade=<id>` query-param form. `notifications.ts:172` becomes
   `/teacher/aral?grade=${gradeIds[0]}`. This matters: that URL is embedded in **already-sent
   notifications**, so the new form must be one `/teacher/aral` can resolve.
3. Delete `src/app/teacher/(app)/aral/[gradeId]/page.tsx`. The sibling routes
   (`[gradeId]/attendance`, `[gradeId]/reading-level`, `[gradeId]/terms-reports`) stay exactly as
   they are — only the index page goes.
4. Update the two tests that assert the redirect so they assert the new direct URLs. Do not
   delete a test to make it pass.

**Steps — R4.4.**

5. **Ruling — the two counts are not duplicates; the spec's premise is wrong.** Recon confirms
   the two `learner.count` where-clauses diverge (one is section-filtered, one is not). Resolve
   it this way: drop the `:277` count, hoist `gradeSections` (and `resolveSection`) **above** the
   remaining `Promise.all`, and keep exactly one count whose where-clause is identical to the one
   the table's own query uses. The invariant to hold: **the subtitle count always equals the
   number of rows the table can page through.** For an unrecognised `?section=` value, keep
   whatever `resolveSection` already does today (do not add new behaviour) and make sure the
   surviving count agrees with it.

**Verification.** Four gates. Then `grep -rn "teacher/aral/" src tests e2e` and confirm no
remaining reference resolves to the deleted route.

**Commit.** `perf: navigate straight to the aral grade view`

---

## Task 6: R4.5 — parallelize the independent-but-sequential awaits

**Owner:** backend-developer · **Recon:** `recon-r4-3-r4-4-r4-5-redirect-page-duplicate-c.md`
**Spec:** R4.5

**Goal.** Four sites `await` reads that do not depend on each other, paying their round trips
serially. Each collapsed pair is one round trip saved. **Every claim the spec makes about these
four sites is partly wrong** — the corrected instruction per site is below, and it is what you
implement.

**Files.** `src/app/teacher/(app)/learners/page.tsx` ·
`src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx` ·
`src/app/admin/audit/page.tsx` · plus whatever fourth site the spec names that survives review

**Steps.**

1. **terms-reports (:133).** Already a `Promise.all`. **Ruling:** the only genuinely hoistable
   read in this file is `gradeSections` (:370-380), which does not depend on `totalCount`. Move it
   above :364 or into a `Promise.all` with the count. Leave `learners` and `termGrades` where they
   are — the comment at :364 documents them as deliberately serial, and that comment is correct.
2. **terms-reports schoolYear (:187).** **Ruling:** keep this read serial. It needs
   `grade.schoolId`, which is not available at the :133 barrier, and rewriting it as a nested
   relation filter to force it into the `Promise.all` trades a clear tenancy check for an implicit
   one. Not worth one round trip. Do not touch it.
3. **admin/audit (:22 and :32).** **Ruling — the spec is wrong that these are independent; they
   are not.** :32 resolves school names for the logs :22 returned. Do not parallelize them —
   **collapse them into one query**: add `select` to the :22 `findMany` (it currently has none)
   including `school: { select: { name: true } }`, then delete :27-37 and the `schoolName` Map
   entirely. One implicit join beats two round trips. Keep every field the render currently reads
   in the new `select` — enumerate them from the JSX before you write it, because adding a
   `select` where there was none silently drops fields.
4. **The remaining site(s).** For each one the spec names that is not covered above: verify the
   two reads are genuinely independent (neither's `where`, `select`, or arguments reference the
   other's result) before collapsing them into `Promise.all`. If they are not independent, leave
   the site alone and say so in your report. A wrong `Promise.all` here is a correctness bug, and
   the savings are ~20 ms each once Task 2 lands.
5. Tenancy is unchanged by this task: every collapsed read keeps its `schoolId` filter exactly as
   it is (Global Constraint 3).

**Verification.** Four gates. For the admin/audit change specifically, re-read the page's JSX and
confirm every field it renders appears in the new `select`.

**Commit.** `perf: collapse independent sequential reads`

---

## Task 7: R4.6 — take writeAudit off the response path

**Owner:** backend-developer · **Recon:** `recon-r4-6-r4-7-writeaudit-off-the-response-pa.md`
**Spec:** R4.6

**Goal.** Every mutating action awaits an `AuditLog` insert before responding — a full round trip
the user waits on for a write nobody reads synchronously. Defer it past the response.

**Files.** `src/lib/audit.ts` · `src/lib/school-context.ts` (one wrapped block) · any action with
an `await writeAudit` **inside a loop**

**Steps.**

1. **Ruling — the deferral lives inside `writeAudit`, not at the call sites.** `after()` from
   `next/server` throws E468 ("`after` was called outside a request scope") when
   `workAsyncStorage.getStore()` is falsy; `vitest.config.ts` has no `setupFiles` and none of the
   five action test files mock `next/server`, so wrapping call sites in `after()` would make every
   existing action unit test throw. Instead, change `writeAudit`'s own body to dispatch through
   `after()` inside a try/catch, falling back to the current inline behaviour when there is no
   request scope. All ~100 call sites stay `await writeAudit(...)`-shaped and every
   `vi.mock("@/lib/audit")` stub keeps working untouched.
2. The deferral must be a **same-tick dispatch**: by the time the action's promise settles,
   `writeAudit` must already have been *called*. Five test files
   (`tests/unit/actions/{term-grades-export,term-grades-save,teacher-profile-save,teacher-set-advisory-section,roster-enroll-aral}.test.ts`,
   ~20 assertions) do `await action(...)` then `expect(writeAudit).toHaveBeenCalledWith(...)`. Any
   design that defers the *call* rather than the *insert* breaks all of them. Do not add a flush
   helper to the tests to make a worse design pass.
3. `writeAudit` must keep its never-throws contract (CLAUDE.md): a failure inside the deferred
   callback is logged and swallowed, exactly as today.
4. **Ruling — `resolveSchoolContext` (school-context.ts:33-57) is a read-back-then-write and must
   not be split.** It does a `findFirst` over an 8-hour dedup window and only inserts if nothing
   was found. Wrap **both** the `findFirst` and the write in a single deferred callback so the
   check and the write stay ordered relative to each other. Do not let the `findFirst` run inline
   while the insert defers — that widens the existing race into reliable duplicate
   `ADMIN_SCHOOL_VIEW` rows. Note in a comment that this does not *fix* the pre-existing
   concurrent-request race; it preserves it unchanged. This is a page-render path, not an action.
5. Fix any `await writeAudit` **inside a loop** the spec names by hoisting it out or batching, so
   N audit inserts stop costing N serial round trips.
6. Audit metadata rules are unchanged (Global Constraint 8): resource IDs and counts only, never
   passwords, tokens, invite secrets, or activation credentials.

**Verification.** Four gates. `npm run test` is the load-bearing one here — the five test files
above must pass **unmodified**. If you had to edit any of them, that is a signal your design is
wrong: report it instead.

**Commit.** `perf: defer audit writes past the response`

---

## Task 8: R4.7 — narrow the revalidatePath fan-out

**Owner:** backend-developer · **Recon:** `recon-r4-6-r4-7-writeaudit-off-the-response-pa.md` (B4)
**Spec:** R4.7

**Goal.** 111 `revalidatePath` calls (35 in `learner.ts` alone) fire on mutations whose effect is
narrower. Reduce the ones that are provably redundant.

**Files.** `src/lib/actions/learner.ts` and the other action files the spec names

**Steps.**

1. **Ruling — narrow conservatively; do not do the wholesale deletion the spec implies.** Recon
   establishes that the server-side effect of these calls is near-nil (all six target routes are
   `force-dynamic`, so there is no Full Route Cache, and `cachedQuery` is tag-only — `tags.ts` has
   no path tags). But the remaining effect is **Client Router Cache expiry**, and
   `next.config.mjs` sets `experimental.staleTimes` to `dynamic: 180` / `static: 600`. Deleting a
   call can therefore serve a prefetched RSC payload for up to 180 s (600 s on a fully-prefetched
   route) *after* a mutation — a user mutating a learner and soft-navigating back to
   `/teacher/learners` would see stale data. That behaviour cannot be observed from a read-only
   pass, so it is not safe to assume away.
2. What you may delete, and only this:
   - an exact duplicate — the same path revalidated twice in one action
   - a path strictly contained by another already-revalidated path in the same action
   - a path for a route that no mutation in that action can change (prove it in your report,
     naming the route and the reason)
3. **Keep at least one `revalidatePath` per user-visible route each mutation can affect.** If in
   doubt about a call, keep it. The savings are milliseconds; a stale roster after an import is a
   bug report.
4. Where a call is genuinely replaceable by a tag helper, use the named helpers in
   `src/lib/cache/revalidate.ts` (`revalidateLearnerScoped`, `revalidateTeacherCaches`, …) rather
   than a raw `revalidateTag` — each mutation type deliberately busts a different set.
5. In your report, list every call you deleted with the one-line reason, and every call you
   considered and kept. The kept list is as important as the deleted one.

**Verification.** Four gates. Then, for each action you touched, state in the report which
user-visible routes still get a revalidation after that mutation.

**Commit.** `perf: narrow revalidation fan-out on mutations`

---

## Task 9: Phase 3 / R5 — bulk-write correctness

**Owner:** backend-developer · **Recon:** `recon-r5-bulk-write-correctness.md`
**Spec:** R5 / Phase 3

**Goal.** This is the **correctness** phase, not an optimization. Four bulk-write paths issue one
statement per row inside a `$transaction` with **no explicit `timeout:` anywhere in the repo**, so
they inherit Prisma's 5 s default. Cross-Pacific, `commitLearnerImport` dies at roughly 11 rows
and the attendance grid at roughly 22 cells with `P2028`. Array-form `$transaction` does not help:
it still executes serially.

**Files.** `src/lib/actions/import-learners.ts` · `src/lib/actions/attendance.ts` ·
`src/lib/actions/reading-level.ts` · `src/lib/actions/term-grades.ts` ·
`src/lib/validators/reading-level.schema.ts` · `src/lib/validators/term-grades.schema.ts`

**Steps.**

1. **Explicit transaction options on all four paths.** Pass `timeout:` and `maxWait:` explicitly
   rather than inheriting the 5 s / 2 s defaults. Size them for the worst case each path can
   actually receive after step 2's caps, with headroom for a 220 ms RTT (the co-location in Task 2
   is not yet deployed and this code must be correct either way).
2. **Ruling — Zod caps.** Add `.max()` to the two currently-unbounded entry arrays:
   - reading-level: `.max(200)`. The grid is **not** a diff — `aral-monthly-reading-level-grid-form.tsx:350-364`
     posts every row where `isRowComplete`, and `toRows` (:256-275) seeds from existing DB records
     with no `initial` snapshot, so a fully-encoded page re-posts all rows every save. At the page
     size of 100 that is 100 entries per save; 200 gives headroom.
   - term-grades: `.max(1000)`. Worst legitimate case is one full page re-typed: 100 learners ×
     8 subjects = 800.

   Note `reading-level.schema.ts:98` is dead code — capping it has no runtime effect, so do not
   count it as covering the live path. Find and cap the live schema.
3. **Ruling — attendance caps stay as they are.** `.max(1400)` on cells and `.max(200)` on remarks
   already exist. Do not raise them. Task 14 paginates that grid to the same 100-learner page size
   as the other two, which puts the worst case at 100 remarks and 500 cells — comfortably inside
   both. Do not paginate the attendance grid here; that is Task 14's file.
4. **Dedupe before any `ON CONFLICT`.** Neither `bulkRecordMonthlyReadingLevel` (reading-level.ts:161,
   which maps `parsed.data.entries` straight through — only `learnerIds` at :138 is deduped, and
   only for the auth check) nor `saveTermGrades` (term-grades.ts:165-168) deduplicates on its
   conflict key. Today the serial array form makes a duplicate a harmless last-write-wins; a
   single multi-row `INSERT ... ON CONFLICT DO UPDATE` raises Postgres `21000`
   ("ON CONFLICT DO UPDATE command cannot affect row a second time") and aborts the entire save.
   Dedupe last-wins into a `Map` keyed on the exact conflict tuple **in the same change as the
   set-based rewrite, not after**. `saveAralWeeklyAttendance` is already safe here — it dedupes via
   `cellByKey` (attendance.ts:187-201).
5. **Ruling — preserve `remarksApplied`.** `saveAralWeeklyAttendance` (attendance.ts:282-290) is the
   only one of the four paths that reads transaction output: it indexes `results[i]` via
   `clearIndexes`/`remarkIndexes` and computes `remarksApplied` from per-statement counts, which
   feeds a user-visible toast ("N remarks need at least one marked day in this week"). A plain
   `updateMany` returns one total and silently breaks it. Use
   `UPDATE "Attendance" SET "notes" = v.notes FROM (VALUES ...) v(...) WHERE ... RETURNING "learnerId"`
   and derive `remarksApplied` from the distinct returned `learnerId`s. Do not drop the counter.
6. **Ruling — bind dates as text, never as `Date`.** `parseLocalDateKey` (date-keys.ts:10-18)
   returns `new Date(y, m-1, d)`; `getMonday` and `monthStartOf` preserve that runtime-local
   midnight, and `Attendance.date` / `Attendance.weekStart` / `ReadingLevelRecord.weekStart` are
   `@db.Date` (schema.prisma:766-767, :802). On Vercel (`TZ=UTC`) local midnight equals UTC
   midnight; a developer machine at UTC+8 does not agree, so a raw-SQL rewrite that binds a JS
   `Date` will not reproduce Prisma's current serialization and the discrepancy only shows outside
   production. In every raw `INSERT`/`UPDATE`, pass the `YYYY-MM-DD` string from
   `formatLocalDateKey(...)` and cast in SQL (`$1::date`). Never pass a `Date` object. Add a unit
   test that runs with `TZ=Asia/Manila` and asserts the written key.
7. **Ruling — `commitLearnerImport` needs a try/catch.** import-learners.ts:256-311 awaits
   `prisma.$transaction` bare, and its caller `learner-import-wizard.tsx:135-155` has
   `try { … } finally { … }` with **no `catch`** — so a `P2028` today surfaces as a Next.js
   server-action error, not the toast the wizard is written for. Wrap the write and return the
   house `{ ok: false, error }` shape (Global Constraint 7). This is also what makes the human's
   production `P2028` validation test produce a legible signal.
8. Chunk any statement whose parameter count could approach Postgres' limit. Keep every chunk
   inside one transaction unless partial application is already this path's documented behaviour.
9. Tenancy and soft-delete rules are unchanged (Global Constraints 3 and 9): every raw statement
   carries its `schoolId` predicate and its `deletedAt IS NULL` filter where the Prisma version
   had one. A raw-SQL rewrite that drops a tenant predicate is the worst bug in this plan — write
   the `WHERE` clause first, then the `VALUES`.

**Verification.** Four gates, plus new unit tests: one per path asserting a large payload is
accepted, one asserting the cap rejects an over-large payload with the house error shape, and the
`TZ=Asia/Manila` date test. Do not claim a `P2028` fix you did not exercise — say what you tested.

**Commit.** `fix: make bulk writes survive realistic payloads`

---

## Task 10: Phase 4 / R6 — additive indexes

**Owner:** database-engineer · **Recon:** `recon-r6-index-additions.md`
**Spec:** R6 / Phase 4

**Goal.** Author the six ranked additive indexes. **You author; a human applies** (Global
Constraint 2). Nothing in this task touches a remote database.

**Files.** `prisma/schema.prisma` · a new migration directory under `prisma/migrations/` ·
`prisma/concurrent-indexes.sql` (new) · `docs/migrate-checklist.md` · `docs/migrations.md`

**Steps.**

1. **Ruling — proposal #7 (pg_trgm GIN) is out of scope this round.** The spec already marks it
   optional and conditions it on search widening cross-tenant, and `pg_trgm` is not enabled on
   this database (it would need `CREATE EXTENSION` as its own human step, landing in the
   `extensions` schema on Supabase). Author the other six.
2. **Ruling — proposals #2 and #6 ship without their `WHERE` clauses.** Prisma's schema language
   cannot express a partial index, and this repo has a written policy against schema/DB
   divergence; the one existing exception (Enrollment's partial unique) is documented precisely
   because it is an exception. `deletedAt`/`archivedAt` are already trailing columns of the
   existing composites, so the selectivity loss is small. Ship plain
   `@@index([gradeLevelId, isAralLearner, fullName])` and `@@index([schoolId, fullName])` so the
   schema and the database agree. Do not introduce two new SQL-only indexes.
3. Add all six as `@@index(...)` in `prisma/schema.prisma`. Additive only — **no index DROPs**
   (the spec defers those) and no column, type, or constraint changes.
4. **Ruling — two artifacts, because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction
   block and `prisma migrate deploy` wraps migrations in one:**
   - A committed `prisma/migrations/YYYYMMDDNNNNNN_add_perf_indexes/migration.sql` containing
     plain `CREATE INDEX IF NOT EXISTS` statements. This is what fresh databases, CI, and local
     dev get via `migrate deploy`.
   - A separate `prisma/concurrent-indexes.sql` (sibling to `prisma/rls-policies.sql`, which is
     already an out-of-band file) containing the `CREATE INDEX CONCURRENTLY IF NOT EXISTS` form
     for the existing production database.

   State explicitly, in both files' header comments, that production takes the script followed by
   `prisma migrate resolve --applied`, and every other environment takes `migrate deploy`.
   Generate the migration SQL with `prisma migrate diff --script` using **file inputs only** —
   never `--from-url`/`--to-url`.
5. **Ruling — amend the checklist rather than contradict it.** `docs/migrate-checklist.md:31-36`
   currently says "Do not apply a migration.sql by hand… Let migrate deploy do the DDL and the
   bookkeeping together" and treats `resolve --applied` as failure recovery only. R6's path is
   technically necessary, not a shortcut, so add an explicit carve-out section to that file:
   why the general rule does not apply to concurrent index builds, the exact psql-on-`DIRECT_URL`
   plus `resolve --applied` sequence, how to verify each index is `valid` afterwards
   (a `CONCURRENTLY` build that fails leaves an invalid index behind), and what to do if one is
   not. Cross-link it from `docs/migrations.md`, which currently does not mention `CONCURRENTLY`
   at all.
6. Preserve every existing hand-written SQL invariant you pass near: Enrollment's partial unique
   index (one `ACTIVE` row per learner) and the `TermGrade` CHECK constraint, both with their
   "preserve this when editing" comment blocks.

**Forbidden in this task** (Global Constraint 2): `prisma migrate deploy`, `prisma migrate dev`,
`prisma migrate reset`, `prisma db push`, psql against any remote database, and any
`DROP`/`TRUNCATE`/unbounded `DELETE`/`UPDATE`. Safe: `prisma validate`, `prisma format`,
`prisma generate`, `prisma migrate diff --script` with file inputs.

**Verification.** `npx prisma validate`, `npx prisma format`, `npx prisma generate`, then the four
gates. Read the generated `migration.sql` yourself and confirm it contains exactly six
`CREATE INDEX` statements and nothing else — no drops, no alters.

**Commit.** `perf: add covering indexes for the hot read paths`

---

## Task 11: Phase 5 / R7.2 + R7.3 — bound the unbounded groupBy, fix the date-in-key hazard

**Owner:** backend-developer · **Recon:** `recon-r7-cache-placement.md` (B3)
**Spec:** R7.2, R7.3

**Goal.** Two latent scaling bugs in the aggregate layer, both cheap to fix and both worth fixing
before Task 12 changes TTLs around them.

**Files.** `src/lib/dashboard/aggregates.ts`

**Steps.**

1. **Bound the unbounded `groupBy`.** `readingLevelRecord.groupBy(["weekStart"])` at
   aggregates.ts:283-288 has no date floor, so it scans every reading-level record the school has
   ever written and grows without limit. Add a `weekStart` lower bound matching the window the
   chart actually renders. Derive the bound with the repo's date helpers, never `toISOString()`
   (Global Constraint 10).
2. **Fix the date-in-key hazard.** `getSchoolHeadCharts` and `getAdminActivitySeries` call
   `daysAgo()` **inside** the cached function (aggregates.ts:265 and :94) while their `keyParts`
   carry no date (`["school-head-charts-v2", schoolId]` at :341,
   `["admin-activity-series-v2"]` at :137). The 7-day window therefore freezes with the cache
   entry. This is survivable at the 60 s default TTL and a bug at any longer one. Add a day key to
   both `keyParts`, following the pattern every teacher aggregate already uses
   (`formatLocalDateKey(start)` — aggregates.ts:651, :745; teacher-overview.ts:301-302).
3. **Ruling — do not change the window semantics.** `daysAgo`/`startOfDay` (aggregates.ts:24-34)
   use bare `new Date()` plus `setHours`, i.e. server-local, which on Vercel is UTC — so these two
   windows are UTC-day-boundaried while the teacher ones are Manila. That inconsistency is real
   but it is a behaviour change the spec does not ask for. Keep the existing `daysAgo()` semantics
   and use the **same** function to derive the key, so key and window always agree. Note the
   UTC-vs-Manila inconsistency in your report as a follow-up, not a fix.
4. Every cache key keeps its tenant discriminator (Global Constraint 4). Adding a date part must
   not remove or reorder `schoolId`.
5. **Do not "clean up"** `getTeacherOverview` returning `todayKey`/`weekStartKey` as strings
   (teacher-overview.ts:41-47). That is deliberate: `unstable_cache` JSON-serializes, and the
   spec calls this out explicitly.

**Verification.** Four gates. In your report, state the new key shape for both functions and the
window bound you chose for the `groupBy`.

**Commit.** `fix: bound the reading-level groupby and date-key the aggregate caches`

---

## Task 12: Phase 5 / R7.1 — cache placement on the hot reads

**Owner:** backend-developer · **Recon:** `recon-r7-cache-placement.md`
**Spec:** R7.1

**Goal.** Put the reads the spec names behind `cachedQuery`, using the `volatile` profile — which
is **defined at `src/lib/cache/profiles.ts:26-31` and used nowhere**. This is the task that makes
it earn its place.

**Files.** the read sites the spec names · `src/lib/cache/tags.ts` · `src/lib/cache/revalidate.ts`

**Steps.**

1. **Ruling — the Date→string conversion moves *inside* the cached function.** `unstable_cache`
   JSON-serializes, but Prisma still *types* the field as `Date`, so `tsc` passes and the failure
   is a runtime crash on a page that works today. Three of the most attractive targets have this
   trap:
   - `src/app/teacher/(app)/aral/page.tsx:176` — `l.aralProfile?.updatedAt.toLocaleDateString()`
   - `src/app/teacher/(app)/aral/[gradeId]/attendance/page.tsx:271` and :289 —
     `formatLocalDateKey(a.date)` / `formatLocalDateKey(h.date)`; `formatLocalDateKey`
     (date-keys.ts:2) calls `date.getFullYear()` and throws on a string
   - `src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx:189` selects
     `schoolYear.startDate` and :209 passes it to `getTermWindows(schoolYear.startDate)`

   For every read you cache: the cached function returns date-key **strings** and pre-resolved
   display strings, never a Prisma row carrying a date column. `aggregates.ts:293` and :329 already
   do exactly this — follow that pattern.
2. **Ruling — `listAralTutors` gets a real invalidation tag, or it does not get cached.**
   `src/lib/teachers/aral-tutor.ts:43` has no invalidation path today: `src/lib/actions/aral-tutors.ts`
   contains zero revalidate calls, and teacher approve/decline/deactivate/reassign
   (`teacher.ts:136,141,270,275`; `school-head.ts:422,424,468,470,524,586,588,688,690`) call
   `revalidateSchoolHeadTeachers()`, which is `revalidatePath` only — no tag — plus
   `revalidateTeacherCaches(thatTeacherId)`. `tags.ts` has no school-scoped teacher-list tag, so
   caching it as-is would leave a newly-approved teacher missing from every tutor picker for the
   full TTL. Add a `schoolTeachers(schoolId)` tag to `tags.ts`, a named helper in
   `revalidate.ts`, and call that helper from `revalidateSchoolHeadTeachers`. Four small edits;
   the alternative is a silently stale picker.
3. Use the `volatile` profile for roster and grid reads. Do not invent a new TTL constant — if
   `volatile`'s TTL is wrong for a read, say so in your report rather than adding a fifth profile.
4. **Every cache key carries its full tenant discriminator** (Global Constraint 4): `schoolId`,
   plus `teacherId` where the read is teacher-scoped, plus the `isSuperAdmin` flag where a Super
   Admin can view the same page through `?schoolId=`. A key that omits one of these serves one
   school's data to another tenant — the worst bug shippable here. Write the key parts first and
   check them against the `where` clause.
5. Rendered HTML is never cached (Global Constraint 5): these pages stay `force-dynamic`. You are
   caching data functions, not routes.
6. For each read you cache, name the mutation paths that must bust it and confirm each one calls a
   helper that busts your tag. A cached read with no verified invalidation path does not ship —
   leave it uncached and report it.

**Ordering note.** Task 5 has already edited `src/app/teacher/(app)/aral/page.tsx` and Task 6 has
edited `learners/page.tsx`. Pull the current state of both from the branch; do not work from the
spec's description of them.

**Verification.** Four gates. In your report, one row per cached read: the key parts, the profile,
and the exact revalidate helper that busts it.

**Commit.** `perf: cache the hot roster and grid reads`

---

## Task 13: Phase 6 / R8 — make the shell paint on hard navigation

**Owner:** frontend-developer · **Recon:** `recon-r8-make-the-shell-paint-on-hard-navigati.md`
**Spec:** R8 / Phase 6

**Goal.** On a hard navigation the user sees a blank screen for 100-270 ms because the layout
awaits chrome data before anything renders. Paint the shell first, stream the chrome data in.

**Read the recon file before you touch anything.** The spec's diagnosis of this requirement is
wrong in four ways and the fix it implies would not work:

- Four of the five routes the spec names **already have** a `loading.tsx`, and still show no
  chrome on hard navigation — because a segment's `loading.tsx` cannot cover its own parent
  layout.
- `src/app/loading.tsx` renders nothing **by design**, and it is load-bearing: the
  `PostLoginLoadingBridge` cream cover depends on it. Do not "fix" it.
- `RoleShell`, `AppSidebar`, and `AppHeader` are all `"use client"`, so there is no server
  Suspense boundary inside the chrome to stream into as the spec assumes.
- The teacher layout already carries comments arguing it must stay at exactly two awaited chrome
  reads. Those comments are correct about the constraint and wrong about the conclusion.

**Ruling — the shape to implement.** Render `RoleShell` immediately after `await requireUser()`
(that await is unavoidable — `role` decides the chrome), and pass the two chrome reads
(`getSchoolName`, `getTeacherShellContext`) **as unawaited promises**, resolved by a client child
with React 19's `use()` inside a `<Suspense>` boundary with a skeleton fallback. Concretely:

1. Widen the `RoleShellProps` contract to accept either a resolved value or a promise:
   `grades?: NavGrade[] | Promise<NavGrade[]>` and
   `schoolName?: string | Promise<string | undefined>`. Existing callers that pass resolved values
   keep working unchanged.
2. Add the `<Suspense>` boundary and the `use()` consumer in the client component that actually
   renders the sidebar/header content, not in the layout.
3. Update `AppShellFallback` in `src/components/app-shell.tsx` — it mounts `AppSidebar` with the
   same props and will break on the widened type otherwise.
4. Give the streaming region a skeleton that occupies the same space as the resolved chrome, so
   the paint does not reflow when the promises land.
5. Do not remove or reorder `await requireUser()`. It stays the authoritative gate (Global
   Constraint 6) and it stays before any render.

**Out of scope.** PPR and `cacheComponents` (spec no-go). Touching `src/app/loading.tsx`. Adding
`loading.tsx` files to routes that already have one.

**Verification.** Four gates. Then reason explicitly, in your report, about what a hard navigation
now renders in its first paint and what arrives later — and confirm no unauthenticated content can
paint before `requireUser()` resolves.

**Commit.** `perf: stream the role shell chrome`

---

## Task 14: Phase 7 / R9 — ARAL weekly attendance grid

**Owner:** frontend-developer · **Recon:** `recon-r9-and-r10-aral-grid-and-form-re-render-.md`
**Spec:** R9 / Phase 7

**Goal.** The weekly attendance grid renders the grade's entire ARAL cohort with no pagination and
re-renders every row on every keystroke.

**Files.** `src/app/teacher/(app)/aral/[gradeId]/attendance/page.tsx` ·
`aral-weekly-attendance-grid-form.tsx`

**Steps.**

1. **Paginate.** `attendance/page.tsx:201-209` has no `skip`/`take`, so `learners` is the whole
   cohort. Add pagination using the existing `parseLearnerPageSize` helper and the same page size
   as the other two ARAL grids (max 100). Match their URL param names and their pager UI exactly —
   three grids with three different pagination conventions is worse than none.
2. **Ruling — pagination must not silently discard typed edits.** These grids use plain
   `useState`, not RHF/`useAppForm`, there is no unsaved-changes guard anywhere in them, and the
   parent save only submits the mounted page. The reading-level grid already loses edits on page
   change; that is a pre-existing bug, not a licence to add a second one. Mount
   `useUnsavedChangesGuard` (`src/hooks/use-unsaved-changes-guard.tsx` — it works standalone,
   independent of RHF) in the attendance grid form so a page change with dirty state warns first.
   Scope this to the attendance grid only; retrofitting the reading-level grid is out of scope for
   this task, and say so in your report.
3. **Memoize the row.** Extract the row into its own component wrapped in `React.memo`, with
   stable callbacks (`useCallback`) so the memo actually holds. A memo defeated by a fresh closure
   every render is worse than no memo — verify the props are referentially stable.
4. **Memoize `days`.** `days = buildDays(...)` (grid form :138-157) recomputes on every render and
   feeds the whole grid. Wrap it in `useMemo` keyed on its real inputs (the week start and the
   holiday list).
5. **Remove the doubled scroll container.** Two nested scrollable elements wrap this grid; keep
   one. Confirm horizontal scrolling of the day columns still works after the change.
6. Dates stay on `formatLocalDateKey`/`parseLocalDateKey` (Global Constraint 10). `buildDays`
   locks Sat/Sun and holidays — that behaviour is unchanged.

**Ordering note.** Task 9 has already rewritten `src/lib/actions/attendance.ts` and Task 12 may
have cached this page's reads. Pull the current branch state of both. The Zod caps Task 9 set
(1400 cells, 200 remarks) are sized so that your 100-learner page size sits comfortably inside
them — do not change those caps.

**Verification.** Four gates. Then state in your report: the page size, the param name, what
happens to dirty state on a page change, and what you did to confirm the row memo is not defeated.

**Commit.** `perf: paginate and memoize the aral attendance grid`

---

## Task 15: Phase 7 / R10 — scope the form watches

**Owner:** frontend-developer · **Recon:** `recon-r9-and-r10-aral-grid-and-form-re-render-.md`
**Spec:** R10 / Phase 7

**Goal.** A bare `form.watch()` subscribes a component to **every** field, so each keystroke
re-renders and re-serializes the entire form. Combined with a double subscription in
`useReliableFormDirty`, the profile forms do four full serializations per keystroke.

**Files.** the teacher profile form · the School Head profile form (`sh-profile-form.tsx`) ·
`useReliableFormDirty`

**Steps.**

1. **Ruling — the spec's claim about `sh-profile-form.tsx` is false.** There is no `useMemo` in
   that file to fix, and no `currentGradeAssignment` / `sectionId` field exists in the School Head
   schema. The real fix is narrower: replace `const values = form.watch()` at :228 with the narrow
   field watches already present at :223-227, plus a `form.getValues()` read inside the step-4
   Review branch. `values` feeds only two things — `gradeLabelsSummary` (:430-433) and the Review
   rows (:653-730) — and the Review step re-renders on entry anyway, so a `getValues()` snapshot
   there is correct and costs nothing.
2. **Handle the two forms separately.** The teacher form's `watch()` usage differs from the School
   Head form's. Read each one and scope its subscription to the fields it actually renders; do not
   copy one file's fix into the other.
3. **Collapse the double subscription in `useReliableFormDirty`.** It subscribes twice where once
   suffices. Keep its external behaviour identical — the unsaved-changes guard depends on it, and
   Task 14 mounts a guard in the ARAL grid.
4. Validation behaviour is unchanged: these forms keep going through `useAppForm` with the same
   Zod schemas, validating on blur then revalidating on change. This task changes *what
   re-renders*, never *what validates*.

**Verification.** Four gates. In your report, name each `watch()` you narrowed, the fields it now
subscribes to, and the component that consumes them — and confirm the Review step still shows
current values, not stale ones.

**Commit.** `perf: scope profile form field subscriptions`

---

## Task 16: Document the program and the human actions it depends on

**Owner:** docs-writer · **Recon:** all ten recon files (read the "Blockers" sections)
**Spec:** the whole document, plus its Phase 0 and Phase 8 status

**Goal.** Leave the repo honest about what shipped, what was predicted rather than measured, and
what only a human can do next.

**Files.** `docs/backlog.md` · `docs/runbook.md` · a new
`docs/latency-and-throughput.md` · `README.md`/`DOCUMENTATION.md` only if a claim in them is now
wrong

**Do not touch** `docs/migrate-checklist.md` or `docs/migrations.md` — Task 10 owns both.

**Steps.**

1. Write `docs/latency-and-throughput.md`: what each phase changed, in the order the commits
   landed, with the spec requirement ID beside each. Every performance number is labelled
   **predicted**, not measured — no task in this plan closed the measurement loop.
2. Write the **human-action checklist**, as its own section, with a checkbox per item:
   - Confirm the Vercel project is linked and note which region it deployed to **before** Task 2
     (this is the baseline; without it the `sin1` delta is unattributable).
   - Confirm Fluid Compute is on, and the plan tier — the per-route breakdown may need
     Observability Plus.
   - Deploy Task 2 **alone**, then re-measure before deploying anything else.
   - Confirm Speed Insights data is arriving (deploy, load a page, check the Speed Insights tab).
   - Collect a multi-day Speed Insights baseline filtered to Philippines traffic.
   - Run the production `P2028` bulk-write validation test the spec's R2 asks for, against the
     Task 9 code.
   - Apply the Task 10 indexes via psql on `DIRECT_URL`, then `prisma migrate resolve --applied`,
     then verify each index is `valid` — pointing at Task 10's carve-out section for the exact
     sequence.
3. Record in `docs/backlog.md`, as decisions with their reasons:
   - **Phase 8 (Next 16) was not implemented.** The spec's Decision B (`cacheComponents`/PPR) is a
     no-go, the phase is "deferrable indefinitely", and it is gated on e2e coverage that does not
     exist. If it is ever revisited: keep `middleware.ts` on Edge and do not accept the codemod's
     `proxy` rename blindly.
   - **R11 (prefetch amplification) was not implemented.** The spec defers it until after R3 —
     "Re-evaluate with data rather than tuning blind."
   - **R6 proposal #7 (pg_trgm GIN) was not authored**, and index DROPs stay unscheduled — adds
     only this round.
   - The follow-ups the tasks surfaced: the UTC-vs-Manila window inconsistency in
     `aggregates.ts:24-34`, the reading-level grid's pre-existing edit loss on page change, the
     dead code at `reading-level.schema.ts:98`, and the pre-existing concurrent-request race in
     `resolveSchoolContext`'s audit dedup.
4. In `docs/runbook.md`, note that `@vercel/otel` spans and the two hand-rolled `session.ts` spans
   exist, that both sit inside `React.cache()` (so one per request, not one per caller), and that
   `NEXT_OTEL_VERBOSE` is the verbose switch.
5. `README.md` and `DOCUMENTATION.md` still claim Next 14.2.28 / React 18.3.1, which was already
   stale before this branch. Fixing that is **out of scope** — do not open it. Only correct a
   statement this branch actually made wrong.
6. Document what the code does, not what it was meant to do. If a task's report says it left
   something unchanged, the docs say that.

**Verification.** Four gates (docs changes should not move them, which is itself the check). Then
re-read every commit message on this branch and confirm the doc's phase list matches the commits
that actually exist — `git log --oneline` against your own table.

**Commit.** `docs: record the latency and throughput program`
