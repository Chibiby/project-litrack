# Migrate-ready ops checklist (human only)

Use this after code with new Prisma migrations is deployed. **Agents must not run** `prisma migrate deploy`, `migrate dev`, or `db push` against remote databases.

Committed migrations (apply in order via `migrate deploy`):

- `0_init`
- `20260806000001_foundation_models`
- `20260806000002_teacher_invite_user_id`
- `20260806000003_profile_contact_email`
- `20260807000001_teacher_approval_status`
- `20260808000001_teacher_position_optional`
- `20260808000002_years_in_service_int`
- `20260808190001_teacher_section`
- `20260808190002_backfill_null_section_a`
- `20260809200001_section_b_to_learner_weekly_reading`
- `20260809220001_attendance_day_meta`
- `20260810130001_weekly_wr_rc_reading_levels`
- `20260811000001_learner_ethnicity`
- `20260811000002_advisory_section_and_aral_teacher`
- `20260811000003_backfill_advisory_and_aral`
- `20260811000004_advisory_section_unique`

`migrate deploy` applies whatever is pending in this order; the list is here so you
can eyeball what a given database is missing. Always confirm with the read-only
`npx prisma migrate status` first.

---

## (a) Backup Supabase

1. Open the Supabase project → **Database** → **Backups** (or use Point-in-Time Recovery if enabled).
2. Take a manual backup / note the PITR restore window before migrating.
3. Optionally dump schema+data with `pg_dump` using the **direct** connection string (port **5432**), store the dump offline.
4. Confirm you can restore from backup before proceeding.

---

## (b) Apply migrations with DIRECT_URL

From a trusted machine with production env loaded (session only — do not commit values):

```powershell
# Prefer DIRECT_URL (port 5432 / session mode). Avoid transaction pooler 6543 for migrate.
$env:DIRECT_URL = "<production-direct-url>"
# Prisma reads DATABASE_URL for the client; migrate deploy uses the datasource URL.
# If schema uses `directUrl = env("DIRECT_URL")`, ensure both are set for production.
$env:DATABASE_URL = "<production-pooled-or-direct-url>"

npx prisma migrate deploy
```

Expected: all pending migrations apply cleanly; exit code 0.

If the remote DB predates `0_init`, baseline first — see `docs/migrations.md`.

Optional after migrate: apply `prisma/rls-policies.sql` in the Supabase SQL Editor.

---

## (c) Verify tables / columns

In Supabase SQL Editor (or `psql`), spot-check:

```sql
-- Foundation models
SELECT to_regclass('"Section"'), to_regclass('"Enrollment"'), to_regclass('"Announcement"');

-- TeacherInvite.userId
SELECT column_name FROM information_schema.columns
WHERE table_name = 'TeacherInvite' AND column_name = 'userId';

-- P-I4 contact email
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('TeacherProfile', 'SchoolHeadProfile')
  AND column_name = 'contactEmail';

-- Migration history
SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at;
```

Confirm app build on Vercel already ran `prisma generate` for the matching schema.

---

## (d) Regenerate School Head credentials (pre-auth-overhaul schools)

Schools created when School ID was used as password need a one-time activation credential after the auth overhaul.

1. Sign in as Super Admin → **Schools** (`/admin/schools`).
2. Read the amber banner: regenerate credentials for schools created before the auth overhaul.
3. For each affected school, click the **key** icon → confirm → copy the one-time credential (shown once).
4. Deliver the credential out-of-band to the School Head.
5. School Head signs in with School ID + activation credential → forced password change → profiling if needed.

Audit action: `SCHOOL_HEAD_CREDENTIAL_REGENERATED` (no secrets in audit metadata).

---

## (e) Smoke test roles

| Role | Checks |
|------|--------|
| Super Admin | `/admin/login` → schools list → regenerate credential UI → `/admin/transfers` loads |
| School Head | Activation / login → set password if prompted → profiling (account email read-only + optional contact email) → school years / grades |
| Teacher | Invite accept or login → profiling (same email pattern) → grade learners |
| Cross-school | SA transfers one test learner between two schools; enrollment history shows TRANSFERRED → ACTIVE when target has active year |

Also verify: login pages load; public `/api/schools/list` returns id+name only; no secrets in client bundles.

---

## Related docs

- `docs/deployment.md` — Vercel + env names
- `docs/migrations.md` — agent rules, baselining, rollback
- `docs/runbook.md` — day-2 ops
- `docs/FINAL-ACCEPTANCE.md` — acceptance status
