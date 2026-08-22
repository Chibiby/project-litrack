# LITRACK — Architecture Decisions & Implementation Backlog

## Architecture decisions (manager-approved)

1. **Stack**: keep Next.js 14.2.28 / React 18.3.1; fix docs. No major upgrades.
2. **Auth (Supabase Auth retained)**:
   - School Head: school selection stays (DOCX W-1), but School ID stops being the password. School creation issues a one-time activation credential (strong random, shown once to Super Admin / optionally emailed). First login forces setting a private password (`mustChangePassword`). Password change + email-based recovery where a real email exists; Super Admin can regenerate activation credentials (audited).
   - Teacher onboarding: ONE flow. School Head adds a teacher (full name per DOCX, grade/section assignment, optional email) → `TeacherInvite` record with one-time activation credential + expiry; delivered on-screen and via Resend when email present. Teacher activates (sets own password), completes profiling, then works. Invite supports resend (regenerate credential) and revoke. The old unwired token-email path and the weak `createTeacherDirect` path are merged into this.
   - Sessions: `getCurrentUser` enforces `isActive` and `deletedAt`; middleware adds central role-prefix enforcement (defense in depth) while `requireUser` stays authoritative.
3. **Tenancy/data**: `Section` model under GradeLevel; `Enrollment` history model (learner × schoolYear × grade/section/teacher × status) — longitudinal history, no more mutating-only current pointers; `SchoolYear` becomes real (School Head manages, one active per school). Learner keeps denormalized current pointers for query simplicity, synced transactionally with active enrollment.
4. **Migrations**: committed SQL under `prisma/migrations` (baseline `0_init` = pre-change schema, then additive migrations). NEVER applied to the remote Supabase DB by agents; application to any remote DB happens only with explicit user approval (`prisma migrate deploy`). Local validation via `prisma validate` / `migrate diff`.
5. **Audit**: `writeAudit()` helper (never logs secrets/tokens/passwords), wired into all sensitive actions; Super Admin + School Head audit viewers.
6. **Security**: zod env validation; in-memory rate limiter (documented serverless limits + Upstash adapter notes) on login/invite/recovery; security headers via next.config; safe error messages; transactions for multi-step writes.
7. **Design**: dashboard-image direction — blue primary, warm amber secondary, pale blue-gray workspace, white cards/sidebar, Inter font. Violet retained ONLY as ARAL accent (DOCX marks additional profiling in violet). Recharts for charts with polished empty states.

## Waves

### Wave 1 — COMPLETE (all diffs manager-reviewed; integrated gates green: typecheck ✅, lint ✅ warnings-only, 27/27 unit tests ✅, build ✅)
Manager integration fixes applied after review: CI e2e job `secrets`→`vars` context (job-level `if` cannot read secrets); `teacher-setup/[token]` null-email guard + revokedAt check; `src/lib/prisma.ts` now imports `resolvePooledDatabaseUrl` from `src/lib/db-url.ts` (deduplicated). Remaining lint warnings assigned to Wave 2/3 file owners (unused imports, `any` in data-table/forms).
- **F1 Foundation** (serialized owner of schema): Prisma schema additions (Section, Enrollment, EnrollmentStatus, Announcement, TeacherInvite rework, `mustChangePassword`), baseline + additive migrations, env validation, audit lib + wiring into existing actions, session hardening (isActive/deletedAt, requireSchoolUser), rate-limit util on logins, `.env.example` completion, migration docs. Owns: `prisma/**`, `src/lib/**` (except validators), `.env.example`, `docs/migrations.md`.
- **Q1 Quality/CI**: vitest + playwright configs, validator/util unit tests, GitHub Actions CI, next.config security headers + stop ignoring ESLint in builds. Owns: `package.json`, `next.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tests/**`, `e2e/**`, `.github/**`.
- **D1 Design system**: tokens per dashboard image, restyled shell/sidebar/header/data-table, dashboard primitives (MetricCard, ChartCard, EmptyState), fonts, root loading/error/not-found boundaries. Owns: `tailwind.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`, root boundary files, `src/components/**` (excluding forms logic). — **DONE, diff reviewed.** Deferred: header search is a visual placeholder (wire in Wave 3); `admin/error.tsx` + `school-head/error.tsx` restyle pending; `teacher-setup/[token]/page.tsx` type error belongs to F1's `TeacherInvite.email String?` change (fix in F1 review or A2).

### Wave 2 (after F1 review; auth serialized)
- **A2 Auth overhaul**: SH activation, unified teacher onboarding + invite lifecycle UI, password change, recovery, forced-change flow, middleware role enforcement, disabled-account handling, login rate-limit integration, remove School-ID-as-password, auth pages restyle. — **DONE** (manager review integration: `TeacherInvite.userId` FK + migration `20260806000002`, invite resolve prefers userId, audit actions consolidated).
- **L2 Learner lifecycle**: edit/archive/restore/transfer (section/school), duplicate detection, search/filter/sort/server-side pagination, enrollment + school-year integration, history views (enrollment/attendance/reading/intervention). — **DONE, diff reviewed.** New routes: learner detail + edit under `/teacher/grade/[id]/learners/[learnerId]`. New audit actions: LEARNER_UPDATE/ARCHIVE/RESTORE/TRANSFER (consolidate into AUDIT_ACTIONS after A2 lands). Deferred: cross-school transfer (SA2), transfer UI (S2 owns SH pages), enrollment skipped when no active school year (S2 delivers year setup). Integration note: `tests/unit/validators/auth.schema.test.ts` fails against A2's in-flight password-policy change — reconcile at A2 review.
- **S2 School Head area**: school year mgmt, sections, teacher assignment mgmt, school info editing, announcements/notices, school audit view, transfer UI, active-year messaging. — **DONE** (routes under `/school-head/school-years|sections|school-info|announcements|audit|transfer`).
- **SA2 Super Admin area**: school activation/archival UI, SH account mgmt (credential regeneration), school years oversight, `/admin/profile`, audit viewer, drill-down (authorized+audited). — **DONE** (`/admin/profile`, `/admin/audit`, `/admin/school-years`; schools table activate/deactivate + regen; SA nav no longer bounces without schoolId).
- **V2 Survey fidelity**: field-by-field DOCX verification of all forms + server validation parity + conditional rules + workflow gates (W-2, W-5, W-6, W-8), upgrade traceability rows to VERIFIED. — **DONE** (Zod refinements + UI gating + unit tests; traceability upgraded Aug 6 2026).

### Wave 3 (after Wave 2)
- **DB3 Dashboards**: role dashboards with real aggregates, Recharts (attendance trends, reading profile distributions, progress over time), empty states, responsive. — **DONE** (`src/lib/dashboard/aggregates.ts`, Recharts wrappers, `/admin` `/school-head` `/teacher` pages).
- **IO3 Import/Export**: CSV learner import wizard (template, validation, preview, transactional commit, row errors), Excel + printable/PDF reports, export authorization + audit. — **DONE** (`/teacher/grade/[id]/import`, `/teacher/reports`, `/school-head/reports`; valid-rows commit + error report; `IMPORT_LEARNERS` / `EXPORT_*` audits).
- **T3 Test depth**: authorization/tenant-isolation test suite, workflow tests, E2E happy paths per role. — **DONE** (~90 unit tests; smoke e2e covers login + forgot-password; skip-when-no-server preserved).
- **DOC3 Docs/ops**: README/DOCUMENTATION corrections, deployment/runbook/backup/privacy (PH DPA) docs. — **DONE** (README/DOCUMENTATION/SETUP-WINDOWS corrected to Next 14 / React 18 + activation/invite flows; `docs/deployment.md`, `docs/runbook.md`, `docs/privacy.md`).

### Final Acceptance — CONDITIONAL PASS (2026-08-06)
Reviewer: Cursor Grok 4.5 High Fast. Full report: `docs/FINAL-ACCEPTANCE.md`.

- **Quality gates (gap close):** typecheck ✅ (0), lint ✅ (0), unit tests ✅ 94/94 (0), build ✅ (0). Playwright not re-run (prior: 4 skipped / exit 0 without server).
- **Security spot-check:** import/export tenant + ownership + Zod + audit counts OK; School ID not password; middleware role prefixes present; public school list residual risk — soft IP rate limit added on `/api/schools/list`.
- **Post-pass gap close (same day):**
  - **P-I4 VERIFIED** — read-only login email + `contactEmail` on Teacher/SH profiles; migration `20260806000003_profile_contact_email` (offline only).
  - **Cross-school transfer** — `transferLearnerCrossSchool` (SUPER_ADMIN) + `/admin/transfers`; audit `LEARNER_TRANSFER_CROSS_SCHOOL`.
  - **Ops** — `docs/migrate-checklist.md`; SH credential regen banner on `/admin/schools`.
- **Traceability:** VERIFIED 46 · DONE 4 · PARTIAL 0 · MISSING 0.
- **Still open / blockers:** remote `prisma migrate deploy` (user-approved only — see migrate-checklist); full multi-role + 2-school isolation browser smoke pending reachable DB + migrations; Resend sender domain decision; post-migrate SH credential regeneration for legacy schools.

## Post-acceptance changes

- **SH1 School Head district login + DepEd roster import** — `/login` now narrows schools by district and searches the school dropdown (`src/lib/login/district-filter.ts`, `src/components/ui/searchable-select.tsx`, `src/lib/actions/school.ts`); `scripts/import-schools.ts` loads the DepEd School Heads roster, dry-run by default. It was originally specced as owner-run-only (Claude authors, a human applies, per the migration rule); the owner subsequently instructed that it be run from this session, which is the task-specific approval that rule carves out — see SH2. E2E in `e2e/school-head-login.spec.ts`. Spec: `docs/superpowers/specs/2026-08-18-school-head-district-login-and-roster-import.md`. — **DONE**, with one deliberate reversal: this **re-introduces School-ID-as-password**, contradicting decision 2 above ("School ID stops being the password"), Wave 2 A2's "remove School-ID-as-password", and the Final Acceptance spot-check "School ID not password". That was the project owner's explicit instruction and is **not a regression**. Read those three as superseded for School Heads: the School ID is now the *first-time* credential only — imported accounts are created with `mustChangePassword: true`, so the head is forced to set a private password at first sign-in, and the ID stops working once they do. Colliding School IDs across schools are safe because `loginSchoolHead` resolves the account from the selected `School.id`, never from the password.
- **SH2 Roster applied to the live database (2026-08-18)** — the owner instructed that the roster actually be loaded ("why not visible"), superseding SH1's author-only stance for this one task. Done in three steps: (1) `scripts/delete-schools.ts` — new, dry-run by default, takes a repeatable `--school <ID or exact name>` and refuses ambiguous tokens — removed the two hand-created schools `305402 Malandag National High School` and `500282 Alabel Integrated SPED Center` (3 users, 24 grade levels, 72 sections, **0 learners**); (2) the roster import ran with `--commit` and **without** `--wipe`; (3) the pilot school `130611 Malandag Central Elementary School SPED Center` was matched by School ID and skipped, so its 17 learners, 8 users, 3 enrollments and 28 attendance rows were never touched. `scripts/lib/script-db.ts` is new shared plumbing: it loads `.env.local` (names logged, never values) and *probes* `DIRECT_URL` before using it, falling back to the pooled `DATABASE_URL` — a Supabase project without the IPv4 add-on has an IPv6-only direct host that `DIRECT_URL || DATABASE_URL` would still select and then fail on with `P1001`. Ops steps in `docs/runbook.md`. — **DONE**
  - Note for the next roster refresh: `Malandag National High School` was **absent** from the July 2026 workbook (the nearest row is `304535 Malandag NHS (TechVoc)`, a different school), so its deletion is permanent rather than a delete-and-recreate. `Alabel Integrated SPED Center` is roster row 7 and came back with a proper district label.

### Deferred follow-ups (latency & throughput program)

Opened 2026-08-22 by the program in `docs/superpowers/plans/2026-08-22-latency-and-throughput-implementation.md`. None is a regression; they are pre-existing gaps the program surfaced and deliberately did not widen its scope to close, plus one source-verified fact recorded so a later reader does not re-derive it wrongly.

- **No test covers `loadUserByAuthId`'s P2024 retry path** (`src/lib/auth/session.ts`). The helper retries exactly once on a Prisma pool timeout, then propagates a second failure. That "exactly once" is asserted only by reading the code: moving the second `await` from the `catch` into the `try` would make a second failure retry again instead of propagating, and every gate would still pass. The helper is module-private, `session.ts` has never had a test, and `vitest.config.ts` declares no `setupFiles`, so covering it means introducing Supabase + Prisma + `next/headers` mocks — new test infrastructure, which a performance program is the wrong vehicle for. Mitigated in the meantime by a comment at the retry pinning the `await`'s placement and naming this failure mode. To close it: add the mock setup, then assert one retry on P2024, propagation on a second P2024, and immediate propagation on any other error code.
- **`tsconfig.tsbuildinfo` is tracked in git and absent from `.gitignore`.** Pre-existing as of `66fe386`. Every `npm run typecheck` therefore dirties the working tree, the file lands in unrelated commits, and it conflicts on most merges. To close it: `git rm --cached tsconfig.tsbuildinfo` plus a `.gitignore` line. Left alone here because it touches every contributor's tree and belongs in its own commit rather than inside a perf fix round.
- **MEDIUM · a malformed `NEXT_PUBLIC_SUPABASE_URL` still 500s every request, including `/login`.** Surfaced 2026-08-23 by the Task 3 review, which found the same unrecoverable-500 class the task existed to remove is still reachable one line above the new guard. `getSupabasePublicEnv` (`src/lib/supabase/env.ts:9-12`) only checks non-empty-after-trim, so `isSupabaseConfigured()` returns true for a value like `abcdefg.supabase.co` (scheme omitted — a plausible copy-paste; `.trim()` already absorbs whitespace, so whitespace is *not* the hole). `middleware()` then skips its not-configured fallback at `src/middleware.ts:29-37`, and `createServerClient` — which sits **outside** the `try` added in `cb82d1e` — throws from supabase-js's `validateSupabaseUrl` (`node_modules/@supabase/supabase-js/src/lib/helpers.ts:114-116`) on every matched request. Deployment-wide, no path to self-recovery, and worse than the per-user case `cb82d1e` fixed. To close it: have `getSupabasePublicEnv` reject a URL failing `/^https?:\/\//i` and return `{ok:false}` so the existing not-configured branch handles it, and while there, document the fail-closed-on-throw contract in `updateSession`'s doc comment (`src/lib/supabase/middleware.ts:14-30`), which is now load-bearing behaviour and says nothing about it.
- **LOW · redirects in `src/middleware.ts` discard `supabaseResponse`'s refreshed `Set-Cookie` headers.** Pre-existing at `:49`, `:56-60` and `:65`, and unchanged by `cb82d1e`. `setAll` is synchronous, so there is never a *half*-written response — but a fully written one is thrown away: a session inside auth-js's 90 s `EXPIRY_MARGIN_MS` refreshes, `_saveSession` → `setAll` reassigns `supabaseResponse` with the **rotated** tokens, then any guard that returns a fresh `NextResponse.redirect` drops them. The browser keeps a refresh token the server has already rotated away, so past Supabase's reuse interval (~10 s) the user is hard-logged-out instead of transiently bounced. Contradicts Supabase's own SSR guidance ("copy the cookies over if you create a new response"). To close it: copy `supabaseResponse`'s cookies onto every redirect response. Note `cb82d1e` made this strictly *better* on public paths — `src/middleware.ts:52-54` returns `supabaseResponse`, so refreshed cookies now reach the browser where the old 500 dropped them.
- **Ops · alert on the string `[middleware] getClaims failed`.** `cb82d1e` trades a self-diagnosing 500 for a silent redirect to `/login`, and under a persistent fault (see the Ed25519 case below) login *succeeds* and the next middleware pass bounces the user straight back, indistinguishable from wrong credentials. `console.error` is the only operator signal and `package.json` + `src/` contain **zero** hits for `sentry|datadog|logtail|axiom`, so nothing alerts on it today. Two smaller notes from the same review: the log line omits `request.nextUrl.pathname` even though it is in scope (add it — a real outage gets much cheaper to triage), and one fault produces several lines per navigation because the redirect's own middleware pass and `nav-prefetcher.tsx` warming each log too.
- **Reachability of the `getClaims()` throw, recorded so nobody "discovers" the guard is unnecessary.** The Task 3 review confirmed from source that `getClaims` in auth-js 2.106.1 ends in a **brand-check** catch — `isAuthError` is `'__isAuthError' in error` (`lib/errors.ts:50`) — so anything unbranded escapes. Reachable unbranded throws: `getAlgorithm` throws plain `Error('Invalid alg claim')` for any `alg` that is not `RS256`/`ES256` (`lib/helpers.ts:368`), so **rotating this project's JWT signing key to Ed25519/EdDSA would 500 every request for every user, permanently**; `validateExp` throws `Error('Missing exp claim')` / `Error('JWT has expired')` (`lib/helpers.ts:344,348`), reachable because `__loadSession`'s staleness gate is `expires_at ? … : false` while `_isValidSession` only checks the key exists, so a stored session with `expires_at: null` skips the refresh and hands an expired token to `validateExp`; and `decodeJWT`'s `JSON.parse` throws `SyntaxError` (`lib/helpers.ts:203-204`). **A JWKS *network* failure is not one of them** — it surfaces as the branded `AuthRetryableFetchError` (`lib/fetch.ts:228`), which the pre-existing `error` guard already handled. Testing the JWKS path and seeing no throw therefore proves nothing about the guard.

### Security findings surfaced by the latency & throughput program (2026-08-22)

A read-only security audit run before implementing R4.1 (`getUser()` → `getClaims()`) traced the installed
`@supabase/auth-js` 2.106.1 source and every account-lockout path in the app. **R4.1 was cancelled as a
result** — see the ruling in `docs/superpowers/plans/2026-08-22-latency-and-throughput-implementation.md`
Task 3 and the program's report. These findings are all **pre-existing**; none was introduced by the
program, and none is fixed by it.

- **HIGH · School Head lockout has no enforceable post-condition.** `regenerateSchoolHeadCredential`
  (`src/lib/actions/school.ts:150-161`) is the only implemented lockout for a `SCHOOL_HEAD` — no action
  anywhere sets `isActive: false` or `deletedAt` on one, although `docs/runbook.md:86` tells an incident
  responder to do exactly that. It sets a new Supabase password plus `mustChangePassword: true` and
  `isActive: true`, and does not sign the user out. Its only DB-side post-condition is
  `mustChangePassword`, which routes to `/account/set-password`, whose `setPasswordAction`
  (`src/lib/actions/auth.ts:693-728`) writes a new password **with no current-credential re-auth** —
  unlike `changePasswordAction:753-757`, which does verify. So a still-valid session held at lockout time
  can set a password of its own choosing, invalidating the credential the Super Admin just issued, with
  the audit row reading `PASSWORD_CHANGE / set_password` under the victim's userId. Today the exposure is
  bounded by whether GoTrue revokes sessions on `PUT /admin/users/{id}` — **an open question, unverifiable
  from this repo.** It becomes unbounded (to the access-token TTL) if session verification ever moves
  local. Note `setPasswordAction` also serves email password recovery via `/auth/reset`, where the user has
  no current password by definition — so requiring re-auth needs flow discrimination, not a blanket check.
  Related: `regenerateSchoolHeadCredential` setting `isActive: true` unconditionally re-activates.
- **MEDIUM · a soft-deleted School does not end its users' sessions.** `deleteSchool`
  (`src/lib/actions/school.ts:243-260`) soft-deletes only the `School` row. `getCurrentUserCached`
  (`src/lib/auth/session.ts`) never joins `School`, and `resolveSchoolContext`
  (`src/lib/school-context.ts:62-63`) returns `user.schoolId` unchecked. `loginSchoolHead`
  (`src/lib/actions/auth.ts:109-115`) does block a *fresh* login, so this affects only sessions already
  open at delete time — which then keep full read/write on a school the admin believes is gone,
  indefinitely. To close it: check `School.deletedAt` / `isActive` in the session gate or in
  `resolveSchoolContext`.
- **LOW · the forced-password-change gate is not universal.** `mustChangePassword` is enforced in
  `requireUser`, not `getCurrentUser`. Three call sites use `getCurrentUser()` directly and skip it:
  `src/app/admin/layout.tsx:16`, `src/app/pending-approval/page.tsx:17`,
  `src/app/account/created/page.tsx:21`. Render-only impact today, but it means the gate is not a
  reliable place to hang anything stronger.
- **LOW · the access-token TTL is undeclared.** There is no `supabase/config.toml`, and nothing in
  `src/lib/env.ts` or `docs/deployment.md` records it, so the window on any session-validity question is
  literally unknown rather than merely long. Pin it deliberately in the Supabase dashboard and write the
  value into `docs/deployment.md`.
- **LOW · `getCurrentUserCached`'s verification branch has no test coverage.** `tests/unit/` does not mock
  the Supabase client, so mishandling the auth result — e.g. treating `getClaims()`'s
  `{data: null, error: null}` no-session arm as authenticated — would pass all four CI gates. Same missing
  infrastructure as the P2024 retry gap noted above.

**Also flagged, so nobody swaps them blind later.** Two `getUser()` call sites must **not** become
`getClaims()`: `completePasswordReset` (`src/lib/actions/auth.ts:934-941`) and
`src/app/auth/reset/page.tsx:28-31` use it to prove a *recovery* session still exists, and local
verification would remove the server's ability to say that session was already consumed or revoked. And
`resolveTeacherRegisterAuthId` (`src/lib/actions/auth.ts:424-430`) reads `sessionUser?.email` — `claims.email`
is the email at token-issue time, not live, so swapping it introduces a stale-value bug.

## Open decisions for user (non-blocking for Wave 1–2 code)
1. Applying committed migrations to the remote Supabase database (needed before live testing of new features). Follow `docs/migrate-checklist.md` (backup → `migrate deploy` with DIRECT_URL → verify → regen SH credentials → smoke). Options: user-approved `migrate deploy`, or a Supabase preview branch.
2. Resend sender domain for invitation/recovery emails (`RESEND_FROM_EMAIL`).
