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

The in-app assistant answers by asking Google's Gemini API, and that is a
cross-border transfer of personal data under the Data Privacy Act. It is a
deliberate decision by the project owner, recorded here rather than left
implicit.

Every question goes to Google — there is no second answerer. The hand-written
help index that ships with the app is now the model's reference material rather
than a fallback voice: it is quoted into the prompt, never rendered as an answer
of its own.

**What is sent to Google**, per question asked:

- The question as typed.
- The help topics the asker's role can see — public product documentation, no
  personal data. All of them, so the model's knowledge tracks the app.
- The app's recent release notes (`src/lib/releases.ts`) — committed product
  copy, no personal data.
- A summary of the **asker's own scope only**: their school name, learner counts
  by grade and section, the current week's attendance totals, the current
  month's reading-level completion, whether editing deadlines are switched on,
  and the learners who still need an ARAL profile, identified as first name plus
  last initial (`Asriel A.`).

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

**Turning it off:** unset `GEMINI_API_KEY`. No data leaves the country, and the
panel says plainly that the assistant is not switched on rather than answering
from anything else. The support-ticket and chat routes to a real person are
untouched, as is the rest of the app.

## School Head passwords are recoverable by a Super Admin

Deliberate, and a genuine trade-off, so it is written down rather than left to
be discovered in the schema.

**What is stored:** when a School Head sets or changes their own password,
LITRACK keeps a copy of it in `User.passwordVaultCipher`, sealed with
AES-256-GCM (`src/lib/auth/password-vault.ts`). Supabase Auth still holds the
bcrypt hash that actually authenticates; this copy exists only so the Super
Admin accounts console can show the credential instead of resetting it out from
under a head who phoned for help.

**Who else:** nobody. Teachers and Super Admins are never sealed — no console
displays them. A head who set their password before this shipped has no stored
copy and never will; bcrypt does not run backwards.

**The exposure this creates:** a database dump plus the key decrypts real
personal passwords, and people reuse passwords. Before, a dump was worthless
for that. The key is `PASSWORD_VAULT_KEY`, or — unset — one derived from
`SUPABASE_SERVICE_ROLE_KEY`; either way it lives in deployment env and never in
Postgres, so a dump on its own still decrypts nothing. The in-app backups at
`/admin/database` null both columns (`REDACTED_SNAPSHOT_COLUMNS`), so a
downloaded backup file carries no password material at all; Supabase's own
platform backups are full dumps and do. Set
`PASSWORD_VAULT_KEY` explicitly if you want password recovery to survive a
service-role rotation, or to be able to destroy every stored password at once by
discarding the key.

**Accountability:** every reveal writes a `SCHOOL_HEAD_PASSWORD_VIEWED` audit
row naming the admin, the account, and the time — never the password —
viewable at `/admin/audit`. The reveal action is Super-Admin-only and rate
limited to 20 per 15 minutes so the console cannot be scripted into a
password dump.

**Turning it off:** unset both `PASSWORD_VAULT_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`… which also disables admin Auth APIs, so in
practice: set `PASSWORD_VAULT_KEY` to a value you then discard. Nothing new is
sealed that can be opened, existing blobs stop opening, and the console returns
to saying a custom password is not readable. Clearing the stored copies
outright is a `UPDATE "User" SET "passwordVaultCipher" = NULL` — a destructive
statement, so it follows `docs/migrate-checklist.md`, not an ad-hoc console.

**Tell people.** A head's password is now visible to the deployment's Super
Admins. Say so in the privacy notice the schools are given; the alternative is
a surprise during an audit.

## Security measures in product

- Private passwords (School ID is not the password), with the School Head
  exception documented above.
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
