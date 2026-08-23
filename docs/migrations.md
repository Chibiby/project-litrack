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

## Preview features

`generator client` has `previewFeatures = ["relationJoins"]` (R4.2), so the engine fetches relations in one `LATERAL` join instead of one round trip per relation.

**With this flag on and PostgreSQL, `join` is the default — app-wide.** It is not an opt-in gate. The blast radius is **every relation read in the app** (on the order of 50, across roughly 19 files), not only the handful of hot paths that pass the argument explicitly. This was established by reading the query engine at the commit `@prisma/engines-version` pins for 5.22.0, `605197351a3c8bdd595af2d2a9bc3025bca48ea2`: in `get_relation_load_strategy`, an explicit strategy is honoured as-is, and a query that passes none falls back to `Join`. The decision is engine-side — `relationLoadStrategy` appears nowhere in the client runtime.

A few measured hot-path reads do pass `relationLoadStrategy: "join"` explicitly. Those are **pins, redundant with today’s default**, kept so the hot paths cannot silently change behaviour if the default flips or the semantics move when the feature leaves preview. They are not what makes R4.2 faster; the flag is. Accepted values **for that query argument** are `"join"` and `"query"` — documented and verified, unlike the environment variable's value strings discussed under “Rolling back” below.

This is a generator flag only: it changes no table, column, or index, and needs no migration.

### Rolling back

Remove `relationJoins` from `previewFeatures`, run `npx prisma generate`, redeploy. One line, effective on all affected reads including the pinned ones. That is the kill switch.

`PRISMA_RELATION_LOAD_STRATEGY` is **not** a substitute, and anyone reaching for it in an incident needs both of these facts. First, the engine consults it **only for queries that pass no explicit `relationLoadStrategy`** — so it cannot roll back the pinned hot paths, which are exactly the sites someone under pressure would most want to change. Second, its accepted value strings are **unverified**: the variable name is present in the engine binary, but it is absent from Prisma’s public docs and no value literal sits near it, so a wrong string would silently do nothing while looking like a guard. Treat it as an undocumented, unversioned, partial lever at best.

## Concurrent index builds

**This section is the normative statement of the concurrent-index rule.** The operational copies of it — in `prisma/concurrent-indexes.sql`, the header comment of `prisma/migrations/20260823000001_add_perf_indexes/migration.sql`, and `docs/migrate-checklist.md` section (b1) — are deliberate duplicates, kept so each file stands alone at the moment someone is using it; if the rule changes, all four must be updated together.

Index-only migrations have a second, hand-applied artifact. `20260823000001_add_perf_indexes` is the first:

- `prisma/migrations/20260823000001_add_perf_indexes/migration.sql` — plain `CREATE INDEX IF NOT EXISTS`. CI, fresh clones, local dev and any new Supabase project get this the normal way, via `migrate deploy`.
- `prisma/concurrent-indexes.sql` — the `CREATE INDEX CONCURRENTLY IF NOT EXISTS` form, for the existing populated production database, followed by `prisma migrate resolve --applied 20260823000001_add_perf_indexes` to do the bookkeeping the DDL skipped.

The split is forced, not stylistic: plain `CREATE INDEX` holds an ACCESS EXCLUSIVE lock for the whole build (blocking all reads and writes on that table), while `CREATE INDEX CONCURRENTLY` takes only SHARE UPDATE EXCLUSIVE but **cannot run inside a transaction block** — and `prisma migrate deploy` wraps every migration file in one.

Both files must keep **byte-identical index names**, taken from `prisma migrate diff --script` output, or the migration's `IF NOT EXISTS` stops protecting the production database and you get duplicate indexes under different names.

A failed `CONCURRENTLY` build leaves an **invalid** index behind — unused by the planner, still maintained on every write — which must be dropped with `DROP INDEX CONCURRENTLY` (also not runnable inside a transaction block, so also `psql` only) before retrying. Note that `IF NOT EXISTS` does **not** rescue this case: an invalid index still holds its name, so both the script and a later `migrate deploy` skip it and report success. Verify validity explicitly; do not infer it from a green exit code.

Full human procedure, including the validity-verification query: **`docs/migrate-checklist.md` section (b1)**, which is also the one sanctioned carve-out to that file's "never apply a `migration.sql` by hand" rule.
