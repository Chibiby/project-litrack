# Privacy guidance — PROJECT LITRACK

**Disclaimer:** This is operational guidance aligned with the spirit of the Philippines **Data Privacy Act of 2012 (RA 10173)** and common DepEd data-handling expectations. It is **not** a legal certification, DPIA, or substitute for counsel / your organization’s DPO.

## Why this matters

LITRACK stores **learner personal data** (names, age, gender, reading profiles, attendance, ARAL interventions) and staff profiling data. Treat learners as a **sensitive educational dataset** — minimize access, logging, and export scope.

## Roles & access control

- **Tenant isolation:** School users only access their school’s data. Super Admin cross-school views are audited (`ADMIN_SCHOOL_VIEW`).
- **Teacher scope:** Assigned grades / own learners for create/edit/import.
- **Least privilege:** Prefer grade-scoped import and filtered exports (grade / ARAL-only).

## Retention & deletion

- Soft deletes (`deletedAt`) and learner archive (`archivedAt`) support operational undo; define an institutional retention schedule for hard purge (not automated in-app today).
- When a school is deactivated, restrict logins (`isActive`) and review whether data must be retained for DepEd reporting.
- Audit logs retain action metadata (IDs, counts) — avoid putting names/PII into audit `metadata`.

## Export & import controls

- Exports (Excel / printable) are authorized + audited. Do not share download files outside authorized school staff.
- CSV import validates server-side (Zod); commit valid rows only. Do not email raw CSV with learner data over unsecured channels.
- Import audit records **counts**, not full row dumps.

## Email & synthetic accounts

- Prefer real staff emails for invite/recovery when available.
- Synthetic emails (`SYNTHETIC_EMAIL_DOMAIN`) exist for Auth bridging — they are not privacy-safe contact addresses. Do not assume learners/parents are emailed by this system (current product does not parent-notify).

## Security measures in product

- Private passwords (School ID is not the password).
- Rate limiting on login/invite/recovery (soft / per-instance).
- Security headers via Next config.
- Secrets only in server env (`SUPABASE_SERVICE_ROLE_KEY`, etc.).

## Recommended organizational practices

1. Appoint a privacy contact for the deployment.
2. Limit Super Admin accounts; use strong unique passwords / IdP where available.
3. Document lawful basis / consent for learner profiling under school authority.
4. Train teachers not to download/export more than needed.
5. Align backup retention with your privacy notice.
6. For incidents, see `docs/runbook.md`.

## Gaps / product limitations (transparency)

- No built-in parent portal or automated data-subject request workflow.
- No automated retention purge job.
- Migrations / backups are operational responsibilities outside the app UI.
