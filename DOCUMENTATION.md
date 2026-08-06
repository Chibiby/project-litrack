# LITRACK — Technical Documentation

**Stack (actual):** Next.js 14.2.28 · React 18.3.1 · Prisma 5 · Supabase Auth + Postgres · Zod · Recharts · papaparse · exceljs

This document describes architecture and platform behavior. For end-user UI walkthroughs, prefer role dashboards after login. For ops, see `docs/runbook.md` and `docs/deployment.md`.

---

## Architecture

- **App Router** (`src/app`) with role-prefixed routes: `/admin`, `/school-head`, `/teacher`.
- **Auth:** Supabase Auth (email/password). App `User` row linked by `authId`. Authorization in server actions via `requireUser` / `requireSchoolUser`; middleware adds defense-in-depth role-prefix checks (`enforceRolePrefix`).
- **Data:** Prisma against Supabase Postgres (service-role connection). RLS SQL is defense-in-depth for direct PostgREST; app writes go through Prisma.
- **Tenancy:** Every school-scoped resource carries `schoolId`. Helpers: `assertSameSchool`, `resolveSchoolContext` (Super Admin view).
- **Validation:** Zod schemas in `src/lib/validators`; server actions re-validate. Survey conditionals (frustration subtypes, transfer Specify, training Yes/No arrays) enforced with `superRefine`.
- **Audit:** `writeAudit()` — never logs passwords/tokens/credentials. Super Admin + School Head audit viewers.
- **Design system:** Blue primary, amber secondary, pale blue-gray workspace, Inter; violet reserved for ARAL accent.

---

## RBAC

| Role | Scope |
|------|--------|
| `SUPER_ADMIN` | Platform schools, activation, SH credential regen, audit, school-year oversight; can open school context (`?schoolId=`) |
| `SCHOOL_HEAD` | Own school: years, grades, sections, teachers/invites, announcements, transfer (within school), reports, audit |
| `TEACHER` | Assigned grade levels: learners, ARAL, attendance, reading level, CSV import, reports for assigned data |

Inactive / soft-deleted users are signed out by `getCurrentUser`. `mustChangePassword` redirects to `/account/set-password`.

---

## Authentication flows

### School Head activation

1. Super Admin creates school → SH user + one-time activation credential (shown once; optional email).
2. School ID (`schoolIdCode`) is an **identifier**, not the password.
3. SH logs in with activation credential → forced password change.
4. Super Admin may regenerate activation credential (audited: `SCHOOL_HEAD_CREDENTIAL_REGENERATED`).

### Teacher invite (single flow)

1. School Head invites teacher (first/middle/last, grade assignment, optional email).
2. `TeacherInvite` stores hashed token / credential + expiry; UI shows credential; Resend emails when address present.
3. Teacher activates via login or `/teacher-setup/[token]`, sets password, completes profiling.
4. Resend regenerates credential; revoke sets `revokedAt`.

### Synthetic email

Supabase requires email. School Heads (and some teachers without real email) use synthetic addresses under `SYNTHETIC_EMAIL_DOMAIN`. Password recovery email only works for real mailboxes — see `docs/privacy.md` / `docs/runbook.md`.

---

## School year & enrollment

- School Head manages `SchoolYear`; one active year per school.
- `Enrollment` records learner × schoolYear × grade/section/teacher × status (longitudinal history).
- `Learner` keeps denormalized current pointers, synced transactionally when an active year exists.
- Creating learners without an active year skips enrollment creation (messaging on SH dashboard).

---

## Dashboards

Role dashboards (`/admin`, `/school-head`, `/teacher`) use real Prisma aggregates in `src/lib/dashboard/aggregates.ts` (no hardcoded fake metrics). Recharts charts use `EmptyState` when series are empty / all-zero as gated in pages.

---

## Import / export

### CSV learner import

- Route: `/teacher/grade/[id]/import`
- Auth: `TEACHER`, `profileCompleted`, grade assignment, tenant isolation
- Flow: template → Papa Parse → Zod (`learnerImportRowSchema`) → preview → **commit valid rows only** (invalid + unconfirmed duplicates skipped)
- Audit: `IMPORT_LEARNERS` with counts (no full row PII)

### Excel & printable reports

- `/teacher/reports`, `/school-head/reports`
- Excel via exceljs (learners sheet + ARAL summary); filters: grade, ARAL-only
- Printable HTML + `@media print` (browser → PDF)
- Never exports another school’s data; audits `EXPORT_LEARNERS_EXCEL`, `EXPORT_PRINTABLE_REPORT`

---

## Audit

Sensitive actions write `AuditLog` rows (login, school lifecycle, invites, learner CRUD/transfer/ARAL, import/export, admin school view). Viewers: `/admin/audit`, `/school-head/audit`. `ADMIN_SCHOOL_VIEW` is deduped per admin+school (~8h).

---

## Security notes

- Zod env validation (`src/lib/env.ts`)
- In-memory rate limit on login/invite/recovery (per-instance; Upstash adapter recommended for multi-instance)
- Security headers via `next.config.mjs`
- Safe client error messages; transactions for multi-step writes

---

## Known limitations

1. **Migrations** under `prisma/migrations/` are committed but may be unapplied on remote DB — deploy only with human approval (`prisma migrate deploy`).
2. **Synthetic email recovery** is limited; ops regenerate credentials.
3. **Cross-school transfer** deferred.
4. **Browser smoke / multi-school isolation** still part of final acceptance checklist.
5. Rate limiter is not a global hard ceiling on serverless.

---

## Related docs

- `README.md` — setup & scripts  
- `SETUP-WINDOWS.md` — Windows paths  
- `docs/backlog.md` — waves & decisions  
- `docs/requirements-traceability.md` — DOCX matrix  
- `docs/deployment.md`, `docs/runbook.md`, `docs/privacy.md`, `docs/migrations.md`
