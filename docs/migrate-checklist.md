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
- `20260902000001_add_report_history`
- `20260903000001_support_assistant`
- `20260907000001_password_is_school_id` — one additive `BOOLEAN NOT NULL DEFAULT false` column on
  `User`, deliberately not backfilled. Adds no table, so `prisma/rls-policies.sql` does not need
  re-running. Existing School Head rows land on `false`, which the Super Admin school-accounts
  console reads as "custom password — reset to sign in"; that is always true and always
  recoverable in one click. The comment at the top of the migration explains why a backfill would
  be worse than none.
- `20260908000001_demo_environment`
- `20260908000002_demo_school_id_exempt_from_unique`
- `20260909000001_registered_as_aral_volunteer` — one additive
  `BOOLEAN NOT NULL DEFAULT false` column on `User`, recording what a teacher ticked at
  sign-up. Metadata-only on PostgreSQL 11+, so no table rewrite and no lock worth planning
  around. Adds no table, so `prisma/rls-policies.sql` does not need re-running. Every existing
  account lands on `false`, which is the truth: nobody had been asked yet.
- `20260910000001_nutritional_status_and_absenteeism_reasons`
- `20260910000002_ethnicity_second_slot` — six additive nullable columns, two on `Learner`
  and four on `TeacherProfile` (teachers are asked about ethnicity for the first time here).
  No backfill and no index by design: nothing reads a second ethnicity in bulk, and a profile
  finished before the question existed is meant to hold `NULL`, not a guess. Adds no table, so
  `prisma/rls-policies.sql` does not need re-running. Applied to production on 2026-09-10
  together with `20260909000001`.
- `20260910000003_chat_channels`
- `20260910000004_backfill_password_is_school_id` — data-only, no DDL. One `UPDATE` on
  `User` setting `passwordIsSchoolId = true` for School Heads whose password is provably
  still their School ID, which `scripts/import-schools.ts` never recorded. It only ever
  sets the flag true, so it is idempotent and cannot revoke a credential the Super Admin
  console is already showing. Expect roughly 209 of 336 live heads to change — the count
  drifts as heads change their own passwords, so trust the predicate, not the number. It
  reads `AuditLog` to classify, so apply it after anything that rewrites that table. Adds
  no table, so `prisma/rls-policies.sql` does not need re-running.

  The ~124 heads it deliberately skips are those whose most recent password write was their
  own choice or a regenerated one-time credential. Those are the ones worth getting right:
  flagging one would make the console print a School ID that does not open the account, and
  an admin would read it out to a school. `tests/unit/db/password-is-school-id-backfill.test.ts`
  guards the classification rule.

  Applied to production on 2026-09-10: 208 heads flagged, 124 left false, 4 already true
  (212 of 336 flagged after). The rows it would flip were snapshotted by id before
  applying; reverting is `UPDATE "User" SET "passwordIsSchoolId" = false` over those ids.

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
   aborts psql at the first error and this query is the file's last statement, so the
   run died before reaching it. That is not "fewer than 12 rows"; it is no result
   set. Paste the query above to see how far the build got, then **branch on the
   error psql printed**, because the causes have opposite remedies:

   - **`25001` (`cannot run inside a transaction block`) — nothing was built.** You
     ran the file through something that opens an implicit transaction: the Supabase
     SQL Editor, `psql -1` / `--single-transaction`, or a `~/.psqlrc` containing
     `\set AUTOCOMMIT off` (`psql -f` still reads it — the step 3 command has no
     `-X`). There is no invalid index to drop, and re-running as-is reproduces the
     same failure. Fix the invocation per step 3 and start over.
   - **Any other error — read it against the query's output.** A `valid = f` row is a
     real build failure: go to
     [If an index build fails](#if-an-index-build-fails). **Zero rows** means the
     statement never started, so fix what the error names (host, database, role,
     file path) and start over.

   **Zero rows** means nothing was built and there is nothing to drop, whatever the
   error was. Conversely, a **zero** exit with no table in front of you means you are
   not looking at the end of the output — the query did run.

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

-- Super Admin username login (20260908000001_user_username).
-- Expect exactly one non-null row, and it is the account you will sign in as.
SELECT id, email, username FROM "User" WHERE "username" IS NOT NULL;

-- Migration history
SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at;
```

Confirm app build on Vercel already ran `prisma generate` for the matching schema.

---

## (c1) Set the Super Admin username (after `20260908000001_user_username`)

`/admin/login` signs in with **username + password**, not email. The migration
backfills `username = 'admin'` onto the oldest active Super Admin, so in most
cases nothing more is needed — the `SELECT` in (c) confirms it landed.

The email on that row is unchanged and stays the account's identity: it is what
Supabase Auth authenticates against and what **Forgot password** mails. The
username never enters the recovery path.

To change either credential — the username lives in Postgres but the password
lives in Supabase Auth, so one command covers both:

```powershell
npx tsx scripts/set-super-admin-credentials.ts                                   # dry run: report only
npx tsx scripts/set-super-admin-credentials.ts --username admin --password <pw> --commit
npx tsx scripts/set-super-admin-credentials.ts --email <recovery@address> --commit
```

> Call `tsx` directly rather than `npm run db:set-super-admin -- <flags>`. On
> Windows PowerShell npm drops the flags after `--` without warning, and because
> the script is dry-run by default the result looks like a successful no-op
> rather than an error. The `npm run` alias is fine for the bare dry run.

Needs `DIRECT_URL` (or `DATABASE_URL`), `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; it reads `.env.local` if the shell has not exported
them. Dry run is the default and prints which account it picked.

> **Password length.** Supabase enforces a minimum (6 characters by default), so
> a short password like `admin` is rejected until you lower it in
> Supabase Dashboard → Authentication → Policies. The script reports this
> explicitly rather than failing opaquely.

> **The recovery address must not already belong to another account.** Supabase
> Auth allows one user per email and `User.email` is `@unique`, so an address
> already held by a teacher or School Head cannot be moved onto the Super Admin —
> Supabase returns a bare "Error updating user". Nor would forcing it help:
> `forgotPassword` calls `resetPasswordForEmail(email)`, which Supabase resolves
> to whichever single auth user owns the address, so the reset link would be
> issued for *that* account rather than the Super Admin. Use a distinct address;
> a plus-alias (`you+admin@gmail.com`) delivers to the same inbox and is enough.

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
| Super Admin | `/admin/login` with **username** + password → schools list → regenerate credential UI → `/admin/transfers` loads. Also check **Forgot password** still mails the account's email. |
| School Head | Activation / login → set password if prompted → profiling (account email read-only + optional contact email) → school years / grades |
| Teacher | Invite accept or login → profiling (same email pattern) → grade learners |
| Cross-school | SA transfers one test learner between two schools; enrollment history shows TRANSFERRED → ACTIVE when target has active year |

Also verify: login pages load; public `/api/schools/list` returns id+name only; no secrets in client bundles.

---

## (f) Data-uniformity backfill  —  Sep 2026

Two migrations, applied in order, with a read-only check between them.

| # | File | What it does | Can it fail? |
|---|------|--------------|--------------|
| 1 | `20260908000003_normalize_existing_data` | Data only. Title-cases learner, user and invite names; rebuilds `fullName`; folds phone numbers to `09XXXXXXXXX`; collapses stray whitespace in school and section labels. Creates two permanent SQL functions the report below reuses. | No. Adds no constraint. |
| 2 | `20260908000004_case_insensitive_name_uniqueness` | Replaces three exact-match unique indexes with case-folded ones (school name, real-school `schoolIdCode`, section name per grade). | **Yes** — it aborts if case-variant duplicates still exist. |
| 3 | `20260908000005_fix_apostrophe_name_casing` | Corrects `litrack_format_person_name()` and re-runs the name backfill. Migration 1 leaned on `initcap()`, which capitalises after a hyphen but **not** after an apostrophe on this server, so it stored `ObrienOBrien`. The function now walks the token character by character and matches `capitalizeParts()` exactly. | No. |


> **Status:** all three applied to production on 8 Sep 2026 and verified with
> `npx tsx scripts/data-uniformity-parity.ts`, which reported full parity
> between the SQL function, `formatPersonName()` and all 366 stored rows.
> 12 rows were rewritten. Sections 1-4 of the pre-flight were clean, so nothing
> had to be merged by hand.

### Steps

1. **Back up first.** These rewrite name columns across every tenant.
2. Apply migration 1:
   ```powershell
   npx prisma migrate deploy   # uses DIRECT_URL (port 5432), not the pooler
   ```
   Stop here if `migrate deploy` would also pick up migration 2 — apply them in
   separate passes, or run migration 1 with `psql -f` and mark it applied.
3. Run the read-only pre-flight and read sections 1-3:
   ```powershell
   psql "$env:DIRECT_URL" -f prisma/reports/data-uniformity-preflight.sql
   ```
   - Sections 1, 2 and 3 must return **zero rows**. Anything they list is a
     genuine duplicate a human has to merge or rename first — the app cannot
     pick a winner between two real schools.
   - Section 4 lists case-variant account emails. These are **not** auto-fixed:
     `User.email` is dual-written with Supabase Auth, so rewriting one side
     alone breaks sign-in. Resolve them through `docs/runbook.md`.
   - Sections 5 and 6 should show 0 rows changing, confirming migration 1 took.
   - Section 7 lists over-long address/region/division/district values. They are
     left as-is, but the next School Head who edits that row will be asked to
     shorten it, because those fields now reject overflow instead of silently
     truncating it.
4. Once sections 1-3 are clean, apply migration 2.
5. Smoke test: add a learner as `juan dela cruz` and confirm the roster shows
   **Juan Dela Cruz**; try creating a section whose name differs from an
   existing one only by case and confirm it is refused.

### Rollback

Migration 1 is not reversible — the original casing is not kept anywhere, which
is why step 1 is a backup. Migration 2 reverses by dropping the three folded
indexes and recreating the originals (`School_name_key`,
`School_schoolIdCode_real_key` on the bare column, `Section_gradeLevelId_name_key`).

---

## (g) ARAL tutor designation backfill  —  Sep 2026

`20260910000006_backfill_aral_tutor_designation`. **Apply this in the same
deploy as the strict-ARAL-assignment change, not after it.** Between the two,
some ARAL learners are visible to nobody.

### Why it is needed

ARAL pages used to scope on "adviser OR designated tutor". They now scope on the
designation alone (`aralLearnerScope`), which is the fix for an adviser being
able to see and encode the ARAL records of learners somebody else runs the
programme for. The side effect is that `Learner.aralTeacherId` is the only way an
ARAL learner is reachable, and the CSV importer never set it — so every ARAL
learner imported from a sheet becomes invisible until this runs.

| # | File | What it does | Can it fail? |
|---|------|--------------|--------------|
| 1 | `20260910000006_backfill_aral_tutor_designation` | Data only. Sets `aralTeacherId = teacherId` for ARAL learners who have no tutor, where that adviser is an eligible tutor (same school, TEACHER, active, approved, not deleted). Fills NULLs only. | No. Adds no constraint, moves no existing designation. |

### Steps

1. Back up (step **a**), as for any data migration.
2. Apply:
   ```powershell
   npx prisma migrate deploy   # DIRECT_URL (port 5432), never the pooler
   ```
3. List what is left for a person to decide — learners with no adviser, or whose
   adviser is not an eligible tutor. The migration deliberately leaves these
   alone rather than guessing a name:
   ```powershell
   psql "$env:DIRECT_URL" -c "SELECT s.\"name\" AS school, l.\"id\", l.\"fullName\", CASE WHEN l.\"teacherId\" IS NULL THEN 'no adviser' ELSE 'adviser not an eligible tutor' END AS reason FROM \"Learner\" l JOIN \"School\" s ON s.\"id\" = l.\"schoolId\" WHERE l.\"isAralLearner\" = true AND l.\"aralTeacherId\" IS NULL AND l.\"deletedAt\" IS NULL ORDER BY school, l.\"fullName\";"
   ```
   Hand that list to each School Head — the ARAL picker on the learner is where a
   tutor gets designated. Note that a teacher whose `approvalStatus` is NULL
   (pre-approval-column accounts) is not eligible, in the migration or in the
   picker, so their learners appear here.
4. Smoke test: sign in as a teacher who imported ARAL learners from a CSV and
   confirm they appear on `/teacher/aral`. Then sign in as an adviser who is NOT
   the designated tutor for a learner in their class and confirm that learner is
   absent from the ARAL pages but still present on `/teacher/learners` — that
   pair is the whole point of the change.

### Rollback

Reversible in principle but not worth it: the migration only fills NULLs, and
clearing them again would restore the invisible state. If a designation is wrong,
reassign it through the ARAL picker rather than by SQL.

---

## (h) Multi-advisory, Wave A  —  Sep 2026

`20260911000001_section_adviser_pointer`. Apply it in the same deploy as the
multi-advisory code. Between the two, the app reads a column that does not exist
yet and every advisory reads as empty.

### What it does

Moves the advisory pointer from `User.advisorySectionId` to `Section.adviserId`,
so one teacher can advise up to three sections while a section still has exactly
one adviser.

| # | File | What it does | Can it fail? |
|---|------|--------------|--------------|
| 1 | `20260911000001_section_adviser_pointer` | Adds `Section.adviserId` (nullable, **not** unique) with its foreign key and a plain index; backfills it from `User.advisorySectionId`; then drops the old `User_advisorySectionId_fkey`. | No. Additive plus one constraint drop. No data is removed. |

Three things worth knowing before you run it:

- **The index is deliberately not unique.** The approved design said to add one.
  Following that would have re-imposed one-section-per-teacher on the other side
  of the relation and made the cap of three unreachable. One adviser per section
  is guaranteed by the column itself — a Section row holds one value.
- **The old foreign key is dropped**, because keeping both directions makes
  `User` and `Section` a cycle that no single restore order satisfies.
  `User.advisorySectionId` keeps its column and unique index and becomes a plain
  nullable column, the shape `School.createdById` already has. It is still
  dual-written and read by nothing.
- **Wave B is a separate, later change** that drops `User.advisorySectionId`
  outright. Do not run it in the same deploy — the point of two waves is that
  this one can be confirmed in production first.

### Steps

1. Back up (step **a**).
2. Apply:
   ```powershell
   npx prisma migrate deploy   # DIRECT_URL (port 5432), never the pooler
   ```
3. Confirm the backfill moved every advisory across. This must return **0 rows**;
   anything it lists is a teacher whose advisory did not survive the move:
   ```powershell
   psql "$env:DIRECT_URL" -c "SELECT u.\"id\", u.\"fullName\", u.\"advisorySectionId\" FROM \"User\" u WHERE u.\"advisorySectionId\" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM \"Section\" s WHERE s.\"id\" = u.\"advisorySectionId\" AND s.\"adviserId\" = u.\"id\");"
   ```
4. Smoke test: on the School Head teachers page, confirm each teacher's chips
   match what the page showed before. Add a second section to one teacher and
   confirm it appears; try a fourth and confirm it is refused by name. Then sign
   in as that teacher and confirm both sections' learners are reachable.

### Rollback

The column and index can be dropped and the old foreign key recreated, but only
while no teacher advises more than one section — a second advisory has nowhere to
go in the old shape. Check first:

```sql
SELECT "adviserId", count(*) FROM "Section"
WHERE "adviserId" IS NOT NULL AND "deletedAt" IS NULL
GROUP BY "adviserId" HAVING count(*) > 1;
```

Empty means a rollback is safe, because `User.advisorySectionId` was dual-written
throughout and still holds the first of each teacher's sections.

---

## (i) Release channel  —  Sep 2026

`20260911000002_release_channel`. **Apply this BEFORE the release-channel code
reaches production. This is not a same-deploy nicety — it is an outage if missed.**

`getCurrentUser` loads the user with a bare `findUnique` and no `select`, so the
generated client asks for every column the schema names. Once the code ships, every
signed-in request selects `User.lastSeenReleaseVersion`; if the column is not there
yet, every authenticated page fails with P2022. Applied first, it is invisible — the
running code ignores a column it does not know about.

| # | File | What it does | Can it fail? |
|---|------|--------------|--------------|
| 1 | `20260911000002_release_channel` | Adds `User.lastSeenReleaseVersion` (nullable TEXT) and the `NotificationType.RELEASE_PUBLISHED` enum value. No backfill, no data movement. | No. Additive; both statements guarded by `IF NOT EXISTS`. |

Not backfilled on purpose: every existing user has acknowledged nothing, and NULL
says so. Setting it to the current version would mark the whole user base as having
read notes they were never shown.

### Steps

1. Apply, from the branch that carries the file (`main` does not until it merges):
   ```powershell
   npx prisma migrate deploy   # DIRECT_URL (port 5432), never the pooler
   ```
2. Confirm:
   ```powershell
   npx prisma migrate status   # expect "Database schema is up to date!"
   ```
3. Deploy the code. Then sign in as a teacher: the 1.1.0 notes open once the login
   splash clears. Close them any way — "Got it", ✕ or Escape — and reload: they do
   not come back. The bell shows "What's new in LITRACK 1.1.0"; opening it clears it.

### Rollback

Drop the column (`ALTER TABLE "User" DROP COLUMN "lastSeenReleaseVersion"`) only
after reverting the code — the reverse of the apply order, for the same reason.
Postgres cannot drop an enum value; `RELEASE_PUBLISHED` is harmless left in place.

---

## Related docs

- `docs/deployment.md` — Vercel + env names
- `docs/migrations.md` — agent rules, baselining, rollback
- `docs/runbook.md` — day-2 ops
- `docs/FINAL-ACCEPTANCE.md` — acceptance status
