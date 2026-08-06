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

## Open decisions for user (non-blocking for Wave 1–2 code)
1. Applying committed migrations to the remote Supabase database (needed before live testing of new features). Follow `docs/migrate-checklist.md` (backup → `migrate deploy` with DIRECT_URL → verify → regen SH credentials → smoke). Options: user-approved `migrate deploy`, or a Supabase preview branch.
2. Resend sender domain for invitation/recovery emails (`RESEND_FROM_EMAIL`).
