# PROJECT LITRACK — Final Acceptance Report

**Reviewer:** Cursor Grok 4.5 High Fast (final acceptance + gap close)  
**Date:** 2026-08-06  
**Repo:** `C:\Users\PC5\Desktop\project-litrack`  
**Verdict:** **CONDITIONAL PASS** — code waves W1–W3 plus post-pass gap close (P-I4, cross-school transfer, migrate checklist) are complete; **live data features remain blocked** until a human applies committed Prisma migrations to the remote Supabase database (and connectivity is confirmed).

This report is honest: no fake completion of remote migrate, full multi-role browser isolation, or invented remote verification.

---

## 1. Completed requirements (summary by area)

| Area | Status |
|------|--------|
| Learner profiling survey (L-A…L-F) | Complete — Zod + UI + ARAL workflows; rows **VERIFIED** in traceability |
| Teacher / School Head profiling (P-I…P-IV) | Complete — **P-I4 VERIFIED** (read-only login email + optional `contactEmail` on profiles) |
| Workflow gates (W-1…W-10) | Implemented; most **VERIFIED**, W-1/W-3/W-4/W-7 **DONE** (security override on School-ID-as-password documented) |
| Auth overhaul (activation, invites, forced password change, recovery) | Done — School ID is identifier only |
| School Head / Super Admin management surfaces | Done (years, sections, invites, announcements, audit, same-school + **cross-school** transfer, SA schools/profile/audit) |
| Dashboards (DB3) | Done — real aggregates + Recharts + empty states |
| Import / Export (IO3) | Done — CSV import wizard; Excel + printable; tenant-scoped audits |
| Docs / ops (DOC3) | Done — README, DOCUMENTATION, deployment, runbook, privacy, **migrate-checklist** |
| Unit / smoke e2e (T3) | Done — unit tests; Playwright smoke skips without server |

Platform mandate items beyond DOCX are tracked in `docs/backlog.md` (Waves marked DONE).

---

## 2. Major architecture decisions

1. **Stack held:** Next.js 14.2.28 / React 18.3.1 — no major upgrades.
2. **Auth:** Supabase Auth retained; School Head one-time activation credential + `mustChangePassword`; unified teacher invite flow; School ID **not** password.
3. **Tenancy:** `Section`, `Enrollment` history, real `SchoolYear` (one active per school); learner denormalized pointers synced when active year exists.
4. **Migrations:** Committed under `prisma/migrations`; **agents never apply** to remote; human `prisma migrate deploy` only with approval. Checklist: `docs/migrate-checklist.md`.
5. **Audit:** `writeAudit()` — no passwords/tokens/credentials; SA + SH viewers.
6. **Security:** Zod env validation; in-memory rate limit (login/invite/recovery + public school list); security headers; role-prefix middleware defense-in-depth.
7. **Design:** Blue primary / amber secondary / Inter; violet reserved for ARAL.

Full text: `docs/backlog.md` → Architecture decisions.

---

## 3. Authentication and security changes

### Spot-check results (2026-08-06)

| Check | Result |
|-------|--------|
| `import-learners.ts` — `requireSchoolUser("TEACHER")`, grade assignment via `assertTeacherGradeAccess`, `schoolId: user.schoolId` on create | **PASS** |
| Import Zod via `validateImportRows` / `learnerImportRowSchema`; 500-row cap; valid-rows commit | **PASS** |
| Import audit `IMPORT_LEARNERS` — counts only (no row PII dump) | **PASS** |
| `export-learners.ts` — teacher export scoped to `schoolId` + `teacherId` (+ assigned grade if filtered) | **PASS** |
| School Head export uses own `schoolId`; Super Admin may pass `schoolId` override | **PASS** (no cross-school for SH) |
| Export audits `EXPORT_*` — counts/filters, not full PII | **PASS** |
| Auth does **not** compare password to `schoolIdCode` — `signInWithPassword` with synthetic email + entered password | **PASS** |
| Middleware `enforceRolePrefix` for `/admin`, `/school-head`, `/teacher` | **PASS** |
| Profiling does **not** overwrite synthetic `User.email` — survey email on `contactEmail` | **PASS** |
| Cross-school transfer — `requireUser("SUPER_ADMIN")`; target grade/section/teacher asserted on target school; audit IDs only | **PASS** (code) |
| Public `/api/schools/list` (`id` + `name` only) | **Residual risk** — school enumeration |

**Hardening applied in acceptance review:** IP-keyed in-memory rate limit (60/min) on `GET /api/schools/list`.

**Not fixed (by design / out of scope):** Rate limiter not globally shared across serverless instances.

---

## 4. Database migrations

Committed migration directories (SQL under each):

| Migration | Purpose |
|-----------|---------|
| `prisma/migrations/0_init/` | Baseline pre-change schema |
| `prisma/migrations/20260806000001_foundation_models/` | Section, Enrollment, Announcement, TeacherInvite rework, `mustChangePassword`, related foundation |
| `prisma/migrations/20260806000002_teacher_invite_user_id/` | `TeacherInvite.userId` FK |
| `prisma/migrations/20260806000003_profile_contact_email/` | `TeacherProfile.contactEmail` / `SchoolHeadProfile.contactEmail` (P-I4) |

Also: `prisma/migrations/migration_lock.toml`, optional `prisma/rls-policies.sql`.

### CRITICAL — remote status

**These migrations are committed in git but NOT applied to the remote Supabase database by agents.**

Live features that depend on new tables/columns **will fail or be incomplete** until a human runs (after explicit approval):

```powershell
npx prisma migrate deploy
```

Prefer `DIRECT_URL` (port 5432). Exact steps: **`docs/migrate-checklist.md`**. Also see `docs/deployment.md` and `docs/migrations.md`.

---

## 5. Changed feature areas

- Foundation schema + audit + env + session hardening  
- Auth activation / teacher invites / password change & recovery / middleware roles  
- Learner lifecycle (edit/archive/restore/same-school + **cross-school** transfer, pagination, history)  
- School Head: school years, sections, school info, announcements, audit, transfer UI  
- Super Admin: school activate/deactivate, credential regen banner, `/admin/transfers`, profile, audit, school-year oversight  
- Survey fidelity (Zod conditionals + UI gates) including **P-I4 contact email**  
- Role dashboards with real aggregates + Recharts  
- CSV import + Excel/printable export  
- CI, Vitest, Playwright smoke, docs/ops + migrate checklist  

---

## 6. Environment variables (NAMES only)

From `.env.example` / README (never commit values):

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `NEXT_PUBLIC_APP_URL`
- `SYNTHETIC_EMAIL_DOMAIN`
- `SEED_SUPER_ADMIN_EMAIL`
- `SEED_SUPER_ADMIN_PASSWORD`

---

## 7. Exact typecheck / lint / test / build / e2e results

Captured during post-pass gap-close run (Windows / PowerShell):

| Gate | Command | Exit code | Summary |
|------|---------|-----------|---------|
| Typecheck | `npm run typecheck` | **0** | `tsc --noEmit` clean |
| Lint | `npm run lint` | **0** | No ESLint warnings or errors |
| Unit tests | `npm run test` | **0** | **15** files, **94** tests passed |
| Build | `npm run build` | **0** | `prisma generate && next build` success (includes `/admin/transfers`) |
| E2E | `npx playwright test` | *(not re-run)* | Prior acceptance: 4 skipped without server — expected |

**Interpretation:** Auth **pages** and code paths are ready. School picker / live data paths need a reachable DB **and** applied migrations.

---

## 8. Deployment steps

Follow **`docs/deployment.md`** and **`docs/migrate-checklist.md`**. Condensed:

1. Configure Vercel env (names in §6).  
2. Deploy (build runs `prisma generate && next build`).  
3. **User-approved only:** backup Supabase, then `npx prisma migrate deploy` with direct URL.  
4. Optional: apply `prisma/rls-policies.sql` in Supabase SQL Editor.  
5. Seed Super Admin once (`npm run db:seed`); rotate password.  
6. Regenerate School Head credentials for pre-auth-overhaul schools (`/admin/schools` key icon).  
7. Smoke test roles (checklist §e).

Ops after go-live: `docs/runbook.md`. Privacy: `docs/privacy.md`.

---

## 9. Remaining blockers or risks

| Priority | Item |
|----------|------|
| **Blocker (user action)** | Apply committed migrations to remote Supabase (`prisma migrate deploy`) before relying on new models / live feature QA — follow `docs/migrate-checklist.md` |
| **Blocker / env** | Confirm network/`DATABASE_URL` before production cutover |
| **Ops after migrate** | Regenerate SH credentials for schools created before auth overhaul (banner on `/admin/schools`) |
| **Gap** | Full browser smoke all roles + 2-school tenant isolation + responsive checks not executed end-to-end pending reachable DB + migrate deploy |
| **Open decision** | `RESEND_FROM_EMAIL` / sender domain for real invite/recovery mail |
| **Residual risk** | Public school list (id+name) — rate-limited but still enumerable |
| **Soft limit** | In-memory rate limiter is per-instance (document Upstash for multi-instance) |
| **Ops** | No automated retention purge / parent portal (documented in privacy.md) |

---

## 10. Requirements traceability summary

Source: `docs/requirements-traceability.md` (DOCX matrix rows).

| Status | Count |
|--------|------:|
| **VERIFIED** | **46** |
| **DONE** | **4** (W-1, W-3, W-4, W-7) |
| **PARTIAL** | **0** |
| **MISSING** | **0** |
| **TBD** | **0** |

**Notable residual (ops, not matrix):**

- **Remote migrations** — ops blocker until user approve + deploy  
- **Browser smoke / multi-tenant isolation acceptance** — incomplete pending reachable DB + migrate deploy  
- **Cross-school transfer** — implemented in code (`/admin/transfers`); live QA pending migrate  

---

## Wave backlog sanity

| Wave item | Backlog mark |
|-----------|--------------|
| F1, Q1, D1 (Wave 1) | COMPLETE / DONE |
| A2, L2, S2, SA2, V2 (Wave 2) | DONE |
| DB3, IO3, T3, DOC3 (Wave 3) | DONE |
| Post-pass gaps (P-I4, cross-school, migrate checklist) | DONE (code) — remote migrate still user-gated |
| Final acceptance | This report — **conditional pass** |

---

_Last updated: 2026-08-06 (post-conditional-pass gap close)._
