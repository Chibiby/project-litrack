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

## The assistant, and data leaving the country

The in-app assistant answers from a hand-written index that ships with the app.
When `GEMINI_API_KEY` is set it *also* asks Google's Gemini API, and that is a
cross-border transfer of personal data under the Data Privacy Act. It is a
deliberate decision by the project owner, recorded here rather than left
implicit.

**What is sent to Google**, per question asked:

- The question as typed.
- The relevant help topics — public product documentation, no personal data.
- A summary of the **asker's own scope only**: their school name, learner counts
  by grade and section, the current week's attendance totals, the current
  month's reading-level completion, and the learners who still need an ARAL
  profile, identified as first name plus last initial (`Asriel A.`).

**What is never sent:** another teacher's learners, another school, full names,
LRNs, birthdates, addresses, contact numbers, email addresses, credentials, or
audit records. The boundary is one file — `src/lib/assistant/prompt.ts` — and
the `AssistantScope` type has no field capable of carrying any of it. Tests in
`tests/unit/assistant-prompt.test.ts` assert the exclusions.

**What is retained:** Google's API terms govern retention on their side; assume
prompts may be retained and do not treat this channel as confidential. LITRACK
itself logs an `ASSISTANT_AI_QUERY` audit row carrying token counts only — never
the question and never the answer, because both can name a learner.

**Disclosure:** the panel states, before anyone types, that answers come from
Google Gemini and that a summary of their own class is sent to produce them.

**Turning it off:** unset `GEMINI_API_KEY`. The assistant falls back to the
offline index and no data leaves the country. Nothing else in the app changes.

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
