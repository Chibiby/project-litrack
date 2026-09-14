-- M1 of editable End-of-Terms subjects.
-- docs/superpowers/specs/2026-09-14-term-subjects-management-design.md §1, §2, §8.
--
-- Additive only: old code (subject-keyed reads/writes) keeps working after this
-- applies. M2 (SET NOT NULL on TermGrade.termSubjectId, drop the old subject
-- unique) and M3 (drop TermGrade.subject entirely) are separate, later,
-- owner-approved migrations — not this one.
--
-- WHAT THIS DOES, IN ORDER
-- =========================================================================
--
--   1. GradeLevel gets @@unique([id, schoolId]) so TermSubject can carry a
--      COMPOSITE foreign key [gradeLevelId, schoolId] -> GradeLevel.[id,
--      schoolId]. Postgres requires a unique/PK target for a composite FK;
--      this is the only reason the constraint exists, and nothing queries it
--      directly. It ties every subject row to a grade that provably belongs
--      to its own school, the same way TermSubject's own schoolId column is
--      cross-checked rather than trusted alone.
--
--   2. CREATE TABLE "TermSubject": the school's per-grade, editable
--      end-of-terms subject list. "legacyArea" is set ONLY on the 8 rows
--      this migration seeds in step 3 -- it is the backfill join key from
--      "TermGrade"."subject" to a row here (step 5) and lets the seed
--      re-run without duplicating. Remove = archive ("deletedAt"); scores
--      stay attached by id and are hidden everywhere only active rows are
--      read. The partial functional unique index in step 2c enforces "no
--      two ACTIVE subjects on one grade share a name" case- and
--      whitespace-insensitively -- the same shape as
--      "Section_gradeLevelId_name_folded_key" and "School_name_folded_key".
--      Prisma's schema language cannot express a functional partial unique,
--      so it is SQL-only here too. PRESERVE IT when editing TermSubject
--      migrations, same rule as "Enrollment_learner_active_unique"
--      (docs/migrations.md).
--
--   3. Seed one row per default learning area for EVERY GradeLevel,
--      including soft-deleted and FLOATING ones -- a grade that later comes
--      back to life (undeleted) or a FLOATING placeholder must not be the
--      one grade with no sheet. Idempotent via ON CONFLICT DO NOTHING
--      against the (gradeLevelId, legacyArea) unique from step 2. Labels
--      are byte-identical to LEARNING_AREA_LABELS
--      (src/lib/constants/enum-labels.ts) -- a unit test pins that.
--
--   4. TermGrade gains a nullable "termSubjectId" pointer (FK, NO ACTION --
--      a subject is archived, never hard-deleted, while grades still
--      reference it) and its legacy "subject" column loses NOT NULL. New
--      code writes termSubjectId only and leaves subject NULL; that is safe
--      against the OLD "TermGrade_learnerId_schoolYearId_term_subject_key"
--      unique because Postgres never treats two NULLs as equal, so multiple
--      NULL-subject rows for one learner/year/term coexist under that index
--      without conflict.
--
--   5. Backfill: point every existing TermGrade row at the TermSubject row
--      seeded from its own "subject" value, scoped to the learner's grade
--      in that school year (falling back to the learner's CURRENT grade
--      when no Enrollment row exists for that year -- the same "no active
--      year" case the rest of the app already tolerates). Only ever WRITES
--      where "termSubjectId" IS NULL, so it is naturally idempotent and
--      safe to re-run. Checklist:
--        SELECT count(*) FROM "TermGrade" WHERE "termSubjectId" IS NULL;
--      must return 0 after this runs (docs/migrate-checklist.md).
--
--   6. New @@unique([learnerId, schoolYearId, term, termSubjectId]) -- the
--      ON CONFLICT target the save action moves to -- plus a lookup index
--      on "termSubjectId". The OLD unique on "subject" is KEPT in M1 (old
--      code still writes through it, and the OLD NULL-distinctness argument
--      in step 4 covers why that is safe); M2 drops it once the new code
--      path is confirmed live everywhere.
--
-- LOCKING
-- =========================================================================
-- ACCESS EXCLUSIVE, briefly, on "GradeLevel" (step 1, catalog-only -- that
-- table is small: one row per school per grade type) and on "TermGrade"
-- (steps 4 and 6: one column add, one FK add, two new indexes), all inside
-- `prisma migrate deploy`'s single transaction.
--
-- "TermGrade" is populated enough that it already needed a CONCURRENTLY
-- index build once before (see "TermGrade_recordedById_idx" in
-- prisma/concurrent-indexes.sql, batch 1). Production takes the
-- CONCURRENTLY twins of this migration's two step-6 indexes from that same
-- file (BATCH 3) BEFORE running this migration -- see
-- docs/migrate-checklist.md. Once those two indexes already exist, this
-- migration's own "IF NOT EXISTS" index statements for them become no-ops,
-- so `migrate deploy` pays only for the column/FK/backfill work here and
-- never holds an index-build lock on "TermGrade".
--
-- Every other environment (CI, fresh clones, local dev, a brand-new Supabase
-- project) takes this whole file the normal way, via `migrate deploy` alone
-- -- those tables are empty or small, so the plain CREATE INDEX statements
-- in step 6 are instant and BATCH 3 is not needed there.
--
-- ROLLBACK
-- =========================================================================
-- Additive throughout except the backfill (step 5), which only ever WRITES
-- "termSubjectId" where it was NULL -- it never clears or overwrites an
-- existing value, so re-running it is a no-op and it loses nothing on its
-- own.
--
-- That said, "no data is ever lost by this migration" stops being true the
-- moment the app deploy that follows M1 goes live. From then, new writes
-- dual-write "subject" = the TermSubject row's "legacyArea" -- EXCEPT for a
-- School Head-created custom subject, which has no "legacyArea" and so
-- leaves "subject" NULL, because there is no legacy value to dual-write.
-- Pre-M1 code reads and writes "subject" only and has never heard of
-- "termSubjectId" -- so a NULL-"subject" row is invisible to it, full stop.
--
-- Check this BEFORE any rollback, app or DB:
--   SELECT count(*) FROM "TermGrade" WHERE "subject" IS NULL;
--
--   * Reverting the APP to the pre-termSubjectId build is safe only while
--     that count is 0 -- i.e. nobody has yet saved a score on a custom
--     subject. A non-zero count means some scores exist ONLY as
--     ("termSubjectId" set, "subject" NULL); the reverted code cannot read
--     "termSubjectId", so those scores read as blank/missing on the sheet
--     the instant the revert lands, even though the row and its value are
--     still sitting in the table.
--   * Dropping the DB objects themselves -- the two step-6 indexes, the
--     "termSubjectId" FK and column, "TermSubject", the "GradeLevel" unique
--     from step 1 -- is a separate, later action and is likewise safe ONLY
--     at count 0. At any other count it deletes the only place those
--     custom-subject scores are recorded, which is real, unrecoverable data
--     loss, not just an app-level revert.
--
-- A non-zero count is not this migration's rollback to perform: escalate to
-- the project owner. Keeping the custom subjects, migrating their scores
-- back onto a legacyArea, and accepting the loss are all product decisions,
-- not a SQL rollback. See docs/migrate-checklist.md section (o) for the
-- guarded pre-M2 backfill re-run and the diagnostics for rows the original
-- backfill (step 5) could never reach.

-- =========================================================================
-- 1. GradeLevel: unique target for TermSubject's composite FK.
-- =========================================================================

ALTER TABLE "GradeLevel" ADD CONSTRAINT "GradeLevel_id_schoolId_key" UNIQUE ("id", "schoolId");

-- =========================================================================
-- 2. CreateTable "TermSubject"
-- =========================================================================

CREATE TABLE "TermSubject" (
    "id"           TEXT NOT NULL,
    "schoolId"     TEXT NOT NULL,
    "gradeLevelId" TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "position"     INTEGER NOT NULL,
    "legacyArea"   "LearningArea",
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    "deletedAt"    TIMESTAMP(3),

    CONSTRAINT "TermSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (2a)
-- At most one row per (grade, legacy area). NULLs are distinct in Postgres,
-- so School Head-created subjects (legacyArea IS NULL) never collide with
-- each other or with a default -- only the 8 seeded rows are ever compared
-- here. Also the ON CONFLICT target for the idempotent seed in step 3.
CREATE UNIQUE INDEX "TermSubject_gradeLevelId_legacyArea_key" ON "TermSubject"("gradeLevelId", "legacyArea");

-- CreateIndex (2b)
-- The sheet read: one grade's rows, active first, in display order.
CREATE INDEX "TermSubject_gradeLevelId_deletedAt_position_idx" ON "TermSubject"("gradeLevelId", "deletedAt", "position");

-- CreateIndex (2c) -- SQL-only partial unique.
-- One active name per grade, case- and whitespace-insensitively. Prisma's
-- schema language cannot express a functional partial unique -- the same
-- reason "Enrollment_learner_active_unique" and
-- "Section_gradeLevelId_name_folded_key" live in SQL only. PRESERVE IT when
-- editing TermSubject migrations (docs/migrations.md).
CREATE UNIQUE INDEX "TermSubject_grade_active_name_unique" ON "TermSubject"("gradeLevelId", lower(btrim("name"))) WHERE "deletedAt" IS NULL;

-- AddForeignKey (2d)
-- Cascade: a deleted school takes its subject list with it.
ALTER TABLE "TermSubject" ADD CONSTRAINT "TermSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (2e) -- composite, against GradeLevel's new (id, schoolId)
-- unique from step 1. Ties every subject row to a grade that provably
-- belongs to its own school. Named "...gradeLevelId_schoolId_fkey" (both
-- columns), matching `prisma migrate diff --script`'s own naming for a
-- composite FK -- not the single-column "...gradeLevelId_fkey" shorthand.
ALTER TABLE "TermSubject" ADD CONSTRAINT "TermSubject_gradeLevelId_schoolId_fkey" FOREIGN KEY ("gradeLevelId", "schoolId") REFERENCES "GradeLevel"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 3. Seed defaults for every GradeLevel, including soft-deleted and
--    FLOATING rows. Idempotent via the (gradeLevelId, legacyArea) unique
--    from step 2a. Labels must equal LEARNING_AREA_LABELS
--    (src/lib/constants/enum-labels.ts) -- tests/unit/terms/subjects.test.ts
--    pins it.
-- =========================================================================

INSERT INTO "TermSubject" ("id","schoolId","gradeLevelId","name","position","legacyArea","updatedAt")
SELECT gen_random_uuid()::text, g."schoolId", g."id", d.name, d.pos, d.area::"LearningArea", CURRENT_TIMESTAMP
FROM "GradeLevel" g
CROSS JOIN (VALUES ('ENGLISH','English',0),('FILIPINO','Filipino',1),('MATHEMATICS','Mathematics',2),
  ('SCIENCE','Science',3),('ARALING_PANLIPUNAN','Araling Panlipunan',4),
  ('EDUKASYON_SA_PAGPAPAKATAO','Edukasyon sa Pagpapakatao',5),('MAPEH','MAPEH',6),('TLE','TLE',7)) AS d(area,name,pos)
ON CONFLICT DO NOTHING;

-- =========================================================================
-- 4. AlterTable "TermGrade" -- new subject pointer; legacy column loosened.
-- =========================================================================

ALTER TABLE "TermGrade" ADD COLUMN "termSubjectId" TEXT;
ALTER TABLE "TermGrade" ALTER COLUMN "subject" DROP NOT NULL;

-- AddForeignKey
-- NO ACTION: a subject is archived ("deletedAt"), never hard-deleted, while
-- grades still reference it, so no delete on "TermSubject" should ever need
-- to touch "TermGrade". (M3 drops "subject" itself once nothing reads it
-- any more; this FK on "termSubjectId" is unaffected by that.)
ALTER TABLE "TermGrade" ADD CONSTRAINT "TermGrade_termSubjectId_fkey" FOREIGN KEY ("termSubjectId") REFERENCES "TermSubject"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- =========================================================================
-- 5. Backfill -- point every existing TermGrade row at the TermSubject row
--    seeded from its own "subject", scoped to the learner's grade in that
--    school year. Only ever WRITES where "termSubjectId" IS NULL --
--    idempotent, safe to re-run. Checklist:
--      SELECT count(*) FROM "TermGrade" WHERE "termSubjectId" IS NULL;
--    must return 0 after this runs.
--
--    MIGRATION WINDOW: this UPDATE runs once, here, when M1 applies. Any row
--    the OLD app writes between M1 applying and the new code deploying
--    (subject-keyed write, "termSubjectId" left NULL by definition) is not
--    covered by this run and needs the app's own idempotent per-grade heal
--    (`healLegacyTermGrades`, src/lib/terms/subjects-db.ts) on first
--    load/save, or the guarded pre-M2 re-run in docs/migrate-checklist.md
--    section (o), before M2 makes "termSubjectId" NOT NULL.
--
--    KNOWN MISS: a learner with no Enrollment row for that school year AND a
--    NULL "Learner"."gradeLevelId" has no grade this query can resolve. The
--    app heal (`healLegacyTermGrades`) does not close this gap either, but
--    for a narrower reason -- it never consults Enrollment at all, and only
--    matches the learner's CURRENT "gradeLevelId" within the one active
--    school year its caller passes; a row with a NULL "gradeLevelId" fails
--    that match too, by any school year. Its "termSubjectId" stays NULL
--    forever by either path. Diagnosed, not auto-fixed, by the query in
--    docs/migrate-checklist.md section (o); resolution is to leave the row
--    (its score is stored, just hidden from the sheet) and escalate to the
--    project owner, never to delete it.
-- =========================================================================

UPDATE "TermGrade" tg
SET "termSubjectId" = ts."id"
FROM "Learner" l, "TermSubject" ts
WHERE l."id" = tg."learnerId" AND tg."termSubjectId" IS NULL
  AND ts."legacyArea" = tg."subject"
  AND ts."gradeLevelId" = COALESCE(
    (SELECT e."gradeLevelId" FROM "Enrollment" e
      WHERE e."learnerId" = tg."learnerId" AND e."schoolYearId" = tg."schoolYearId"
      ORDER BY (e."status" = 'ACTIVE') DESC, e."updatedAt" DESC LIMIT 1),
    l."gradeLevelId");

-- =========================================================================
-- 6. CreateIndex -- the ON CONFLICT target the save action moves to, plus
--    the FK lookup side. IF NOT EXISTS is what lets the CONCURRENTLY
--    pre-build in prisma/concurrent-indexes.sql (BATCH 3) make these
--    no-ops on production -- it checks only that the NAME is taken, so it
--    will also skip an INVALID index left by a failed CONCURRENTLY build
--    and report success. Verify validity there; do not infer it from a
--    green deploy here. The OLD
--    "TermGrade_learnerId_schoolYearId_term_subject_key" unique is KEPT in
--    M1 -- M2 drops it once the new path is live everywhere.
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "TermGrade_learnerId_schoolYearId_term_termSubjectId_key" ON "TermGrade"("learnerId", "schoolYearId", "term", "termSubjectId");

CREATE INDEX IF NOT EXISTS "TermGrade_termSubjectId_idx" ON "TermGrade"("termSubjectId");
