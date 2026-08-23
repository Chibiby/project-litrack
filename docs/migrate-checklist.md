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
- `20260812000001_teacher_profile_aral_volunteer_fields`
- `20260819000001_teacher_employment_type_and_notifications`
- `20260822000001_term_grades`
- `20260823000001_add_perf_indexes` — **see the carve-out in (b1) before applying this one to
  production.** It is 12 additive `CREATE INDEX` statements and nothing else; production takes
  `prisma/concurrent-indexes.sql` instead of letting `migrate deploy` run it.

`migrate deploy` applies whatever is pending in this order; the list is here so you
can eyeball what a given database is missing. Always confirm with the read-only
`npx prisma migrate status` first.

Do **not** apply a `migration.sql` by hand. Pasting the SQL into the Supabase SQL
Editor performs the DDL but writes no `_prisma_migrations` row, so Prisma still
counts the migration as pending — the next `migrate deploy` re-runs it, fails on
the objects that already exist, and marks the migration failed. Recovering from
that needs `prisma migrate resolve --applied <migration_name>`. Let
`migrate deploy` do the DDL and the bookkeeping together.

That rule stands. There is exactly **one** narrow carve-out, for concurrent index
builds, and it exists because of a hard PostgreSQL/Prisma mechanical conflict
rather than as a shortcut — see **(b1)** below. In that case the bookkeeping is
still done, just explicitly with `resolve --applied` as a required step instead of
an afterthought. Any other hand-application is still the mistake described above.

`prisma/rls-policies.sql` is a separate step and needs no migration bookkeeping —
run it in the SQL Editor after `migrate deploy` whenever a migration adds a table,
because a new table's RLS is off until that file enables it.

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

## (b1) Carve-out: concurrent index builds on a populated database

**Applies to `20260823000001_add_perf_indexes` and any future index-only migration.**
For everything else, section (b) is the whole story — use `migrate deploy` and stop
reading here.

### Why this carve-out is legitimate

It is mechanical, not a convenience:

- Plain `CREATE INDEX` takes an **ACCESS EXCLUSIVE** lock on the table for the
  entire build. Every read and every write on that table blocks until it finishes.
  On a populated `Learner` or `Attendance`, that is user-visible downtime.
- `CREATE INDEX CONCURRENTLY` takes only **SHARE UPDATE EXCLUSIVE**, so reads and
  writes continue throughout. It costs two table passes instead of one, so it is
  slower in wall-clock terms — that is the trade, and on a live database it is the
  right one.
- But `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block**, and
  `prisma migrate deploy` wraps every migration file in one. So the concurrent form
  physically cannot live in a `migration.sql`.

Hence two artifacts for the same twelve indexes. Both are committed; both produce
**byte-identical index names** (they were generated from the same
`prisma migrate diff --script` output), which is what makes the migration's
`IF NOT EXISTS` a real safety net rather than decoration.

### The sequence

1. Back up / confirm the PITR window — section (a).

2. Read-only check of what is pending:

   ```powershell
   npx prisma migrate status
   ```

3. Apply the concurrent script on the **direct** connection (port 5432, session
   mode — *not* the 6543 transaction pooler):

   ```powershell
   psql "$env:DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/concurrent-indexes.sql
   ```

   **Do not use the Supabase SQL Editor for this file.** It can wrap statements in
   a transaction, which makes every `CONCURRENTLY` statement fail with `25001`
   (`CREATE INDEX CONCURRENTLY cannot run inside a transaction block`). Do not pass
   `-1` / `--single-transaction` to psql either, for the same reason.

4. **Check that every index is `valid` before step 5.** Step 5 tells Prisma the DDL
   is done, so a silently-invalid index would go unnoticed from then on. This query
   is a **live statement at the end of `prisma/concurrent-indexes.sql`**, so a
   *successful* step 3 already printed it — read that output rather than pasting
   this again. A zero exit code is not sufficient evidence; look at the rows. Expect
   12, all `valid = t`:

   ```sql
   SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready
   FROM pg_class c
   JOIN pg_index i ON i.indexrelid = c.oid
   WHERE c.relname IN (
     'Enrollment_sectionId_idx', 'Enrollment_schoolYearId_idx',
     'Learner_gradeLevelId_isAralLearner_fullName_idx', 'Learner_sectionId_idx',
     'Learner_schoolId_fullName_idx', 'Announcement_authorId_idx',
     'Attendance_recordedById_idx', 'AttendanceDayMeta_recordedById_idx',
     'ReadingLevelRecord_recordedById_idx', 'TermGrade_recordedById_idx',
     'Notification_actorId_idx', 'AuditLog_timestamp_idx'
   )
   ORDER BY c.relname;
   ```

   **If step 3 exited non-zero, no table was printed at all** — `ON_ERROR_STOP=1`
   aborts psql at the first error and this query is the file's last statement, so a
   failed build kills the run before it. That is not "fewer than 12 rows"; it is no
   result set. Paste the query above, see how far the build got, then go to
   [If an index build fails](#if-an-index-build-fails). Conversely, a **zero** exit
   with no table in front of you means you are not looking at the end of the
   output — the query did run.

   This query proves index **name and validity only**, not column list or order. If
   you need to confirm the definitions match the migration, use the `pg_indexes`
   query in
   [Verify the live index set matches the committed schema](#verify-the-live-index-set-matches-the-committed-schema)
   below.

   The full statement list and this query also live at the bottom of
   `prisma/concurrent-indexes.sql`, so the file is self-sufficient at 2am.

5. Record the migration as applied **without** re-running its SQL:

   ```powershell
   npx prisma migrate resolve --applied 20260823000001_add_perf_indexes
   ```

   Skipping this leaves the migration pending forever and the next `migrate deploy`
   re-runs it. It would in fact *succeed* — the migration uses `IF NOT EXISTS` — but
   it would take ACCESS EXCLUSIVE locks to accomplish nothing, which is precisely
   the downtime step 3 avoided. Do not skip it.

6. `npx prisma migrate status` again — expect no pending migrations.

### If an index build fails

A failed or interrupted `CREATE INDEX CONCURRENTLY` leaves behind an **INVALID**
index. This is the worst of both worlds: the planner will not use it (no read
benefit) but PostgreSQL still maintains it on every write (full write cost). It
must be dropped before retrying:

```sql
DROP INDEX CONCURRENTLY IF EXISTS "<index_name>";
```

`DROP INDEX CONCURRENTLY` **also cannot run inside a transaction block**, for the
same reason `CREATE INDEX CONCURRENTLY` cannot. Run it with `psql` on `DIRECT_URL`
— not in the Supabase SQL Editor, and not under `psql -1` / `--single-transaction`.
Whoever is reading this is by definition already recovering from a failed build, so
it is worth saying twice.

Then **re-run the whole file**, not just the statement that failed. The script is
invoked with `ON_ERROR_STOP=1`, so a failure aborts the run and every statement
*after* the failing one never executed either. Re-running everything is correct and
cheap because each statement is `IF NOT EXISTS`-guarded, so the indexes that already
built are skipped.

> **`IF NOT EXISTS` does not repair an invalid index.** It only checks whether the
> name is taken. An INVALID index still occupies its name, so both this script and a
> later `prisma migrate deploy` will skip it and report **success** — leaving an
> index the planner never uses and every writer pays for, permanently. This is a
> failure mode that looks exactly like success. Always drop invalid indexes before
> re-running, and trust the validity query above rather than a green exit code.

This is the only `DROP` sanctioned anywhere in this checklist, and it is scoped to
an index the same script created minutes earlier. It is not licence to drop
anything else.

### Verify the live index set matches the committed schema

This has **never been verified** against production in this program. Worth doing
once while you are here — list the indexes PostgreSQL actually has on the nine
affected tables and compare against `@@index` / `@@unique` in `prisma/schema.prisma`:

```sql
\d+ "Learner"
\d+ "Enrollment"
```

Expect `Enrollment` to carry one index that is **not** expressible in
`schema.prisma`: the partial unique `Enrollment_learner_active_unique` (one `ACTIVE`
row per learner). That is intentional — see `docs/migrations.md`. Any *other*
divergence is a finding worth reporting before it compounds.

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
