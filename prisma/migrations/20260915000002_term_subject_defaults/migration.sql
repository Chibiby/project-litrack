-- Super Admin default End-of-Terms subjects, per GradeLevelType.
-- docs/superpowers/specs/2026-09-14-term-subjects-management-design.md.
--
-- Additive only. "TermSubjectDefault" is a brand-new, tenant-less table: no
-- existing row anywhere is read, written or reshaped by this migration, and
-- no existing code path queries it yet. It is schema-only until the backend
-- developer wires the zero-rows lazy seed (`src/lib/terms/subjects-db.ts`)
-- and `resetSchoolTermSubjects` to read from it instead of (or in addition
-- to) the hard-coded `DEFAULT_TERM_SUBJECTS` in `src/lib/terms/subjects.ts`.
--
-- WHAT THIS DOES, IN ORDER
-- =========================================================================
--
--   1. CREATE TABLE "TermSubjectDefault": one template row per
--      (GradeLevelType, subject). No "schoolId" -- this is a global
--      template, not a per-school table, the same shape as "SystemSetting".
--      Remove is archive ("deletedAt"), matching "TermSubject"'s own
--      convention, so a template row can be retired without touching any
--      school's already-seeded copy (a school's "TermSubject" rows are
--      independent copies, not pointers back here).
--
--   2. Plain index (2a) for the template read: one grade type's rows,
--      active first, in display order -- same shape as
--      "TermSubject_gradeLevelId_deletedAt_position_idx".
--
--   3. SQL-only partial unique (2b): one active name per grade type, case-
--      and whitespace-insensitively. Prisma's schema language cannot
--      express a functional partial unique -- the same reason
--      "TermSubject_grade_active_name_unique",
--      "Enrollment_learner_active_unique" and
--      "Section_gradeLevelId_name_folded_key" live in SQL only. PRESERVE IT
--      when editing TermSubjectDefault migrations (docs/migrations.md).
--
--   4. Seed 8 subjects for every "GradeLevelType" value EXCEPT "FLOATING".
--      "FLOATING" is a placeholder grade with no advisory section and no
--      end-of-term sheet at all (see "AdvisoryMode.FLOATING"); it is refused
--      at the action/validator layer, not here, and this migration simply
--      never writes it a template. Names and positions are byte-identical
--      to "DEFAULT_TERM_SUBJECTS" (src/lib/terms/subjects.ts) -- a unit test
--      pins that, the same guard the M1 migration's own seed has.
--      Idempotent via "WHERE NOT EXISTS", comparing on
--      "lower(btrim(name))" against non-archived rows only, mirroring the
--      partial unique's own expression -- safe to re-run.
--
-- LOCKING
-- =========================================================================
-- ACCESS EXCLUSIVE, briefly, on a table that does not exist until this
-- migration creates it -- there are no concurrent readers to block and no
-- existing rows to scan. The seed (step 4) is 8 subjects x 13 grade types =
-- 104 rows, trivial either way.
--
-- ROLLBACK
-- =========================================================================
-- Fully additive and reversible with no data-loss risk: no other table has
-- a foreign key into "TermSubjectDefault" (as of this migration), so
-- dropping it back out removes only rows this migration itself created.
-- Re-running this migration (should it ever be re-applied against a
-- database that already has rows) inserts nothing new, by the same
-- "WHERE NOT EXISTS" idempotency the seed relies on.

-- =========================================================================
-- 1. CreateTable "TermSubjectDefault"
-- =========================================================================

CREATE TABLE "TermSubjectDefault" (
    "id"             TEXT NOT NULL,
    "gradeLevelType" "GradeLevelType" NOT NULL,
    "name"           TEXT NOT NULL,
    "position"       INTEGER NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "deletedAt"      TIMESTAMP(3),

    CONSTRAINT "TermSubjectDefault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (2a)
-- The template read: one grade type's rows, active first, in display order.
CREATE INDEX "TermSubjectDefault_gradeLevelType_deletedAt_position_idx" ON "TermSubjectDefault"("gradeLevelType", "deletedAt", "position");

-- CreateIndex (2b) -- SQL-only partial unique.
-- One active name per grade type, case- and whitespace-insensitively.
-- Prisma's schema language cannot express a functional partial unique --
-- the same reason "TermSubject_grade_active_name_unique",
-- "Enrollment_learner_active_unique" and
-- "Section_gradeLevelId_name_folded_key" live in SQL only. PRESERVE IT when
-- editing TermSubjectDefault migrations (docs/migrations.md).
CREATE UNIQUE INDEX "TermSubjectDefault_type_active_name_unique" ON "TermSubjectDefault"("gradeLevelType", lower(btrim("name"))) WHERE "deletedAt" IS NULL;

-- =========================================================================
-- 4. Seed 8 default subjects for every GradeLevelType except FLOATING.
--    Names/positions byte-identical to DEFAULT_TERM_SUBJECTS
--    (src/lib/terms/subjects.ts) -- tests/unit/terms/subject-defaults.test.ts
--    pins it. Idempotent via WHERE NOT EXISTS against the same
--    lower(btrim(name))/deletedAt IS NULL comparison the partial unique
--    above enforces -- safe to re-run.
-- =========================================================================

INSERT INTO "TermSubjectDefault" ("id", "gradeLevelType", "name", "position", "updatedAt")
SELECT gen_random_uuid()::text, t.type::"GradeLevelType", d.name, d.pos, CURRENT_TIMESTAMP
FROM (VALUES
    ('KINDER'), ('G1'), ('G2'), ('G3'), ('G4'), ('G5'), ('G6'),
    ('G7'), ('G8'), ('G9'), ('G10'), ('G11'), ('G12')
) AS t(type)
CROSS JOIN (VALUES
    ('English', 0),
    ('Filipino', 1),
    ('Mathematics', 2),
    ('Science', 3),
    ('Araling Panlipunan', 4),
    ('Edukasyon sa Pagpapakatao', 5),
    ('MAPEH', 6),
    ('TLE', 7)
) AS d(name, pos)
WHERE NOT EXISTS (
    SELECT 1 FROM "TermSubjectDefault" existing
    WHERE existing."gradeLevelType" = t.type::"GradeLevelType"
      AND lower(btrim(existing."name")) = lower(btrim(d.name))
      AND existing."deletedAt" IS NULL
);
