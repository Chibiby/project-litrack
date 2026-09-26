# Prisma migrations (PROJECT LITRACK)

## Structure

```
prisma/migrations/
  migration_lock.toml          # provider = postgresql
  0_init/migration.sql         # baseline = schema as it existed before Wave 1 F1
  20260806000001_foundation_models/migration.sql
                               # additive: Section, Enrollment, Announcement, …
  20260806000002_teacher_invite_user_id/migration.sql
  20260806000003_profile_contact_email/migration.sql
                               # TeacherProfile / SchoolHeadProfile.contactEmail (P-I4)
```

Human apply steps: `docs/migrate-checklist.md`.

Migrations are **committed SQL**. They are the source of truth for how the database should evolve.

## Baseline (`0_init`)

`0_init` was generated offline with:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

against the pre-F1 schema. It represents the tables/enums that already existed on the remote Supabase database (created via earlier ad-hoc/`db push` workflows). When applying for the first time against that database, mark the baseline as already applied before running later migrations (see Prisma “baselining” docs), or apply only additive migrations if the baseline state is already present.

## How to apply (humans only)

```bash
npx prisma migrate deploy
```

Use a direct (non-pooler) connection for migrations (`DIRECT_URL` / session mode on port 5432). Never use the transaction pooler (6543) for migrate.

## How to roll back safely

Prisma does not auto-generate down migrations. To roll back:

1. Write a compensating SQL migration (or restore from a backup / point-in-time recovery).
2. Prefer forward-fix migrations over destructive resets on shared environments.
3. For local throwaway DBs only: `prisma migrate reset` (destroys data).

## Agent / automation rule

**Agents must never apply migrations to any remote database.** Do not run `prisma migrate dev`, `prisma migrate deploy`, or `prisma db push` against Supabase (or any shared URL). Allowed offline checks only: `prisma validate`, `prisma format`, `prisma generate`, and `prisma migrate diff` with schema/migrations file inputs (never `--from-url` / `--to-url`).

Application to remote DBs requires **explicit user approval**.

## Partial unique index

`Enrollment` allows at most one row with `status = 'ACTIVE'` per learner:

```sql
CREATE UNIQUE INDEX "Enrollment_learner_active_unique"
  ON "Enrollment"("learnerId") WHERE "status" = 'ACTIVE';
```

Prisma’s schema language cannot express partial unique indexes, so this lives only in the SQL migration. Keep it when editing Enrollment-related migrations.

`TermSubject` has the same kind of SQL-only object, added in
`20260915000001_term_subject_table`: one ACTIVE (non-archived) subject name per
grade, case- and whitespace-insensitively —

```sql
CREATE UNIQUE INDEX "TermSubject_grade_active_name_unique"
  ON "TermSubject"("gradeLevelId", lower(btrim("name")))
  WHERE "deletedAt" IS NULL;
```

Prisma's schema language cannot express a *functional* partial unique either
(it folds case/whitespace, not just a `WHERE`), so this too lives only in SQL.
Keep it when editing `TermSubject`-related migrations. Same family as
`Section_gradeLevelId_name_folded_key` and `School_name_folded_key`, which
fold casing/whitespace the same way but are not additionally partial.

## `20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes`

Authored for the Global Archive (`docs/archive-purge-spec.md`, task T1), **not yet applied to production**. It does two things in one file.

**Part A — nine "who recorded this" foreign keys become nullable with `ON DELETE SET NULL`:**

| Table | Column | Constraint |
|---|---|---|
| `Attendance` | `recordedById` | `Attendance_recordedById_fkey` |
| `AttendanceDayMeta` | `recordedById` | `AttendanceDayMeta_recordedById_fkey` |
| `ReadingLevelRecord` | `recordedById` | `ReadingLevelRecord_recordedById_fkey` |
| `TermGrade` | `recordedById` | `TermGrade_recordedById_fkey` |
| `Announcement` | `authorId` | `Announcement_authorId_fkey` |
| `Report` | `createdById` | `Report_createdById_fkey` |
| `UnlockGrant` | `grantedById` | `UnlockGrant_grantedById_fkey` |
| `SchoolUnlockGrant` | `grantedById` | `SchoolUnlockGrant_grantedById_fkey` |
| `TermWindowOverride` | `setById` | `TermWindowOverride_setById_fkey` |

All nine were `ON DELETE RESTRICT`, which made a permanent delete of any teacher who had ever recorded anything impossible at the storage layer. `docs/archive-purge-spec.md` section 2b recommended refusing such a delete; **the project owner overruled that** — a permanent delete of a teacher must always succeed. The stated and accepted cost is that attendance records, reading assessments and term grades taken by a purged teacher keep existing but lose their attribution. `SchoolUnlockGrant` was the only one whose `RESTRICT` was written explicitly rather than inherited as Prisma's implicit action.

**Part B — `User_deletedAt_idx` and `Learner_deletedAt_idx`**, batch 2 of the concurrent-index pair above.

**Existing rows: untouched.** Every statement widens what a column may hold, widens what a delete may do, or adds an index. Nothing narrows, nothing rewrites a row, nothing sets a value. No backfill is needed, and all nine columns stay fully populated — a `NULL` can only appear later, when a `User` row is actually deleted.

**Rollback.** Clean only *before* the first purge: re-tighten by restoring each constraint to `ON DELETE RESTRICT` and each column to `SET NOT NULL`. Once any teacher has been purged, `NULL`s exist and nothing can reconstruct who the recorder was — the `User` row is gone and `AuditLog` stores ids, not per-row attribution. From that point a revert needs point-in-time recovery, not a compensating migration. **Whoever applies this is committing to that.**

**Locking.** Brief `ACCESS EXCLUSIVE` on each of the nine tables for `DROP CONSTRAINT` + `DROP NOT NULL` (both catalog-only, no table rewrite), then `SHARE ROW EXCLUSIVE` on the child table and on `User` while each re-added foreign key validates by scanning the child. `migrate deploy` wraps the file in one transaction, so the locks accumulate — including on `User`, which means sign-in blocks for the duration. Apply in a low-traffic window.

## `20260912000002_add_teacher_presence`

Adds nullable `User.lastOnlineAt` for the teacher activity heartbeat used by the
Super Admin support workspace. It is additive, has no default and needs no
backfill: every existing account remains valid and reports unavailable presence
until its own eligible teacher session records activity.

**Rollout.** Apply the migration before deploying version `1.10.0`. Version
`1.9.0` ignores the extra nullable column, so the migration-first mixed-version
window is safe. Deploying the application first is not safe because the new
support query selects the column immediately.

**Retry and verification.** `ADD COLUMN IF NOT EXISTS` makes a retry idempotent.
After the human-run migration, verify `information_schema.columns` contains
`public.User.lastOnlineAt` as nullable `timestamp without time zone`, then open a
real teacher session and confirm its heartbeat changes only that account.

**Rollback.** First redeploy `1.9.0`, which stops all readers and writers. The
column can then remain harmlessly in place (preferred). Dropping it with a later
compensating migration is destructive because it erases last-online history and
must be separately authorized; no automatic down migration is provided.

## `20260915000001_term_subject_table` (M1 of editable End-of-Terms subjects)

Authored for `docs/superpowers/specs/2026-09-14-term-subjects-management-design.md`
§1, §2, §8. Additive-only, not yet applied to production. Adds `TermSubject`
(the school's per-grade, editable subject list; remove = archive via
`deletedAt`), seeds 8 default rows per `GradeLevel` (including soft-deleted and
`FLOATING` grades) with labels byte-identical to `LEARNING_AREA_LABELS`
(`src/lib/constants/enum-labels.ts`), adds nullable `TermGrade.termSubjectId`
with a backfill from the existing `subject` column, and loosens
`TermGrade.subject` to nullable. `GradeLevel` gains `@@unique([id, schoolId])`
so `TermSubject` can carry a composite FK `[gradeLevelId, schoolId] ->
GradeLevel.[id, schoolId]` — Postgres requires a unique target for a composite
foreign key.

**Existing rows: read but not rewritten**, except the backfill UPDATE, which
only ever fills `termSubjectId` where it was NULL (idempotent, safe to
re-run). The old `TermGrade_learnerId_schoolYearId_term_subject_key` unique is
kept through M1 — once `1.15.0` is live, new code dual-writes `subject` = the
`TermSubject` row's `legacyArea` alongside `termSubjectId`, so the old unique
still sees a value and never collides on NULL. The one exception is a School
Head-created custom subject, which has no `legacyArea` and so leaves
`subject` NULL — there is no legacy value to dual-write, and that NULL is
what makes app/DB rollback conditional (see Rollback below).

**Migration window.** Whatever the OLD build (pre-`1.15.0`) writes between M1
applying and `1.15.0` deploying lands `termSubjectId` NULL, same as any
pre-M1 row — the old build has never heard of the column. `1.15.0` heals
these itself, per grade, on first load/save (`healLegacyTermGrades`,
`src/lib/terms/subjects-db.ts`), so deploy `1.15.0` promptly after M1 rather
than treating the gap as an incident. Before M2 tightens `termSubjectId` to
`NOT NULL`, re-run the M1 backfill with an explicit `NOT EXISTS` duplicate
guard (same guard the app heal itself carries) rather than assuming every
grade was opened since M1 — see `docs/migrate-checklist.md` section (o) for
the guarded SQL and the follow-up listing query.

**Backfill misses.** The M1 backfill and the pre-M2 re-run pick a row's grade
the same way — the learner's `Enrollment` row for that `schoolYearId` if one
exists, else current `gradeLevelId`. The app heal is narrower: it never
consults `Enrollment`, it only matches the learner's *current*
`gradeLevelId`, and only for the one `schoolYearId` its caller passes (every
call site pins that to the active `SchoolYear`), so it neither reaches a
non-active-year row nor tracks a mid-year grade move the way the
Enrollment-aware SQL passes do. A row whose learner has no `Enrollment` for
that `schoolYearId` *and* a NULL `Learner.gradeLevelId` cannot be resolved by
any of the three. That is not a migration-window row; re-running anything
never fixes it. Leave it — the score is still stored, only hidden from every
`termSubjectId`-keyed reader — and escalate to the project owner rather than
deleting it or guessing a grade. The diagnostic query is in
`docs/migrate-checklist.md` section (o).

**Two of its indexes take the concurrent-index carve-out** (batch 3 of
`prisma/concurrent-indexes.sql`): the new `@@unique([learnerId, schoolYearId,
term, termSubjectId])` and the `termSubjectId` lookup index, both on
`TermGrade`, which already needed one CONCURRENTLY build before
(`TermGrade_recordedById_idx`, batch 1). See `docs/migrate-checklist.md`
section **(o)** for the human apply steps and the post-apply verification
query (`SELECT count(*) FROM "TermGrade" WHERE "termSubjectId" IS NULL` must
return 0). This migration is **not** index-only — it also creates a table,
adds a column/FK and backfills — so, like batch 2, it must go through
`prisma migrate deploy` and must **never** be `migrate resolve`d.

M2 (`20260915000002_term_grade_subject_tighten`, not yet authored) re-runs the
backfill, sets `TermGrade.termSubjectId` `NOT NULL`, and drops the old
`subject` unique, once the code that writes only `termSubjectId` has been live
long enough. M3 (drop `TermGrade.subject` outright) needs the project owner's
explicit, separate sign-off before it is authored — see the spec's §0.

**Rollback.** Before any rollback, app or DB, check:

```sql
SELECT count(*) FROM "TermGrade" WHERE "subject" IS NULL;
```

Reverting the app to the pre-`termSubjectId` build is safe only while that
count is 0 (nobody has saved a score on a custom subject yet) — the reverted
code reads only `subject`, so a NULL there is invisible to it even though
`termSubjectId` still points at the real row. Dropping the DB objects
themselves (the two step-6 indexes, the `termSubjectId` FK and column,
`TermSubject`, the `GradeLevel` unique from step 1) is likewise safe only at
count 0; at any other count it destroys the only place those custom-subject
scores are recorded. A non-zero count is an escalation to the project owner,
not a rollback to run — see the full walkthrough and guarded pre-M2 backfill
in `docs/migrate-checklist.md` section (o).

## `20260918000001_user_avatar_path`

Adds nullable `User.avatarPath` (object key in the `avatars` Supabase
Storage bucket, not a URL) and a fourth SQL-only CHECK, next to
`TermGrade_score_range`, `TermSubject_grade_active_name_unique`, and
`TermGrade_score_xor_mark` above: `User_avatarPath_shape` pins the column to
either NULL or `<id>/<uuid>.(webp|jpg|png)` for the row's own `id`, mirroring
`isValidAvatarPath` (`src/lib/avatars/paths.ts`) at the database layer.
Prisma's schema language cannot express a CHECK constraint, so, like the
others, this lives only in the migration SQL — preserve it when editing
`User` migrations. Also adds `NotificationType` value
`PROFILE_PHOTO_REMOVED`, combined into the same file as the column change
following the `20260910000003_chat_channels` / `20260911000002_release_channel`
precedent (an added enum value just can't be used in the same transaction
it's added in, and nothing here does). Additive, no backfill: every existing
`User` row already satisfies the CHECK because NULL passes it. The paired
`prisma/storage-avatars.sql` (bucket + restrictive storage policy) is a
separate, non-Prisma, human-applied file — see its own header and
`docs/migrate-checklist.md` section **(q)**.

## `20260926000001_notification_created_at_index`

Adds `Notification_createdAt_idx` (`@@index([createdAt])` on `Notification`),
serving the daily retention purge (`src/lib/retention/purge.ts`):
`purgeExpiredNotifications` deletes `WHERE "createdAt" < $cutoff` and
`purgeReadNotifications` deletes `WHERE "readAt" IS NOT NULL AND "createdAt" <
$cutoff`. Neither existing `Notification` index leads with `createdAt` —
`[recipientId, readAt, createdAt]` needs `recipientId` first,
`[schoolId, createdAt]` needs `schoolId` first — so both purge queries were
doing a full sequential scan. A single plain (non-partial) index on
`createdAt` serves both: it range-scans straight to the cutoff, and the
read-only variant's extra `readAt IS NOT NULL` predicate is then a cheap
filter over that already-narrowed range rather than a second leading index
column (which wouldn't help further prune the scan anyway, since `IS NOT
NULL` is not a single-value equality). Index-only, additive, no backfill:
existing rows are untouched, the index simply gets populated as a background
build.

**Its one index takes the concurrent-index carve-out** (batch 4 of
`prisma/concurrent-indexes.sql`), same treatment as batch 1: it is
index-only, so on the existing production database it is built with
`CREATE INDEX CONCURRENTLY` via that script, then
`npx prisma migrate resolve --applied 20260926000001_notification_created_at_index`
records it as applied without re-running the plain-lock DDL. Every other
environment (CI, fresh clones, local dev, a new Supabase project) takes it
through ordinary `npx prisma migrate deploy`.

**Rollback.** `DROP INDEX CONCURRENTLY IF EXISTS "Notification_createdAt_idx"`
(psql only, same transaction-block restriction as the build) — safe at any
time, since nothing depends on the index for correctness, only for scan
cost.

## Preview features

`generator client` has `previewFeatures = ["relationJoins"]` (R4.2), so the engine fetches relations in one `LATERAL` join instead of one round trip per relation.

**With this flag on and PostgreSQL, `join` is the default — app-wide.** It is not an opt-in gate. The blast radius is **every relation read in the app** (on the order of 50, across roughly 19 files), not only the handful of hot paths that pass the argument explicitly. This was established by reading the query engine at the commit `@prisma/engines-version` pins for 5.22.0, `605197351a3c8bdd595af2d2a9bc3025bca48ea2`: in `get_relation_load_strategy`, an explicit strategy is honoured as-is, and a query that passes none falls back to `Join`. The decision is engine-side — `relationLoadStrategy` appears nowhere in the client runtime.

A few measured hot-path reads do pass `relationLoadStrategy: "join"` explicitly. Those are **pins, redundant with today’s default**, kept so the hot paths cannot silently change behaviour if the default flips or the semantics move when the feature leaves preview. They are not what makes R4.2 faster; the flag is. Accepted values **for that query argument** are `"join"` and `"query"` — documented and verified, unlike the environment variable's value strings discussed under “Rolling back” below.

This is a generator flag only: it changes no table, column, or index, and needs no migration.

### Rolling back

Remove `relationJoins` from `previewFeatures`, run `npx prisma generate`, redeploy. One line, effective on all affected reads including the pinned ones. That is the kill switch.

`PRISMA_RELATION_LOAD_STRATEGY` is **not** a substitute, and anyone reaching for it in an incident needs both of these facts. First, the engine consults it **only for queries that pass no explicit `relationLoadStrategy`** — so it cannot roll back the pinned hot paths, which are exactly the sites someone under pressure would most want to change. Second, its accepted value strings are **unverified**: the variable name is present in the engine binary, but it is absent from Prisma’s public docs and no value literal sits near it, so a wrong string would silently do nothing while looking like a guard. Treat it as an undocumented, unversioned, partial lever at best.

## Concurrent index builds

**This section is the normative statement of the concurrent-index rule.** The operational copies of it — in `prisma/concurrent-indexes.sql`, the header comments of `prisma/migrations/20260823000001_add_perf_indexes/migration.sql` and `prisma/migrations/20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes/migration.sql`, and `docs/migrate-checklist.md` section (b1) — are deliberate duplicates, kept so each file stands alone at the moment someone is using it; if the rule changes, all five must be updated together.

Index-only migrations have a second, hand-applied artifact. `20260823000001_add_perf_indexes` is the first:

- `prisma/migrations/20260823000001_add_perf_indexes/migration.sql` — plain `CREATE INDEX IF NOT EXISTS`. CI, fresh clones, local dev and any new Supabase project get this the normal way, via `migrate deploy`.
- `prisma/concurrent-indexes.sql` — the `CREATE INDEX CONCURRENTLY IF NOT EXISTS` form, for the existing populated production database, followed by `prisma migrate resolve --applied 20260823000001_add_perf_indexes` to do the bookkeeping the DDL skipped.

The split is forced, not stylistic: plain `CREATE INDEX` holds an ACCESS EXCLUSIVE lock for the whole build (blocking all reads and writes on that table), while `CREATE INDEX CONCURRENTLY` takes only SHARE UPDATE EXCLUSIVE but **cannot run inside a transaction block** — and `prisma migrate deploy` wraps every migration file in one.

`prisma/concurrent-indexes.sql` now holds **four batches**, 17 indexes in total:

| Batch | Indexes | Migration | Bookkeeping after running the script |
|---|---|---|---|
| 1 | 12 (R6 / Phase 4) | `20260823000001_add_perf_indexes` | `migrate resolve --applied` — the carve-out |
| 2 | `User_deletedAt_idx`, `Learner_deletedAt_idx` | `20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes` | **`migrate deploy`. Never resolve.** |
| 3 | `TermGrade_learnerId_schoolYearId_term_termSubjectId_key`, `TermGrade_termSubjectId_idx` | `20260915000001_term_subject_table` | **`migrate deploy`. Never resolve.** |
| 4 | `Notification_createdAt_idx` | `20260926000001_notification_created_at_index` | `migrate resolve --applied` — the carve-out (index-only, like batch 1) |

**The batch 2 exception matters.** The carve-out in `docs/migrate-checklist.md` (b1) is scoped, in its own words, to *index-only* migrations, and batch 2's migration is not one: alongside the two indexes it drops `NOT NULL` on nine columns and rewrites nine foreign keys from `ON DELETE RESTRICT` to `ON DELETE SET NULL`. `resolve --applied` writes the bookkeeping row and runs no SQL, so resolving it would record it as done while silently skipping all of that — the database would keep enforcing `RESTRICT` against a `schema.prisma` that promises `SET NULL`, and a teacher purge would fail with `P2003` for a reason nothing in the code explains.

Running the script first is still the right move: it builds the two indexes concurrently, and the migration's `CREATE INDEX IF NOT EXISTS` then makes them no-ops, so `migrate deploy` does only the foreign-key work and never holds `ACCESS EXCLUSIVE` on `Learner` for an index build.

Both files must keep **byte-identical index names**, taken from `prisma migrate diff --script` output, or the migration's `IF NOT EXISTS` stops protecting the production database and you get duplicate indexes under different names.

A failed `CONCURRENTLY` build leaves an **invalid** index behind — unused by the planner, still maintained on every write — which must be dropped with `DROP INDEX CONCURRENTLY` (also not runnable inside a transaction block, so also `psql` only) before retrying. Note that `IF NOT EXISTS` does **not** rescue this case: an invalid index still holds its name, so both the script and a later `migrate deploy` skip it and report success. Verify validity explicitly; do not infer it from a green exit code.

Full human procedure, including the validity-verification query: **`docs/migrate-checklist.md` section (b1)**, which is also the one sanctioned carve-out to that file's "never apply a `migration.sql` by hand" rule.
