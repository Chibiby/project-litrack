-- One-time data backfill for the advisory/ARAL split. Data only, no DDL.
-- Deterministic and idempotent: re-running produces the same result and cannot
-- introduce a duplicate adviser.
--
-- 1) "User"."advisorySectionId" from "TeacherSection".
--    Today a teacher may hold MANY sections and a section MANY teachers, so the
--    m2m has to collapse to a single section per teacher AND a single teacher
--    per section. Resolution order, in two passes:
--      pass 1 (per teacher)  assignedAt ASC, "Section"."name" ASC, "sectionId" ASC
--                            -> take the first; that is the teacher's candidate
--      pass 2 (per section)  assignedAt ASC, "User"."createdAt" ASC, "User"."id" ASC
--                            -> earliest assignment wins the section; losers keep
--                               advisorySectionId = NULL and become ARAL-only /
--                               floating teachers
--    Why this cannot violate the unique index added by 20260811000004:
--      `per_teacher` keeps ROW_NUMBER() = 1 partitioned by "teacherId", so
--      "teacherId" is unique in it. `ranked_sections` then keeps ROW_NUMBER() = 1
--      partitioned by "sectionId" over that same set, so "sectionId" is unique
--      too. One row per teacher and one row per section => no duplicate
--      advisorySectionId is expressible. The NOT EXISTS guard covers re-runs
--      where some rows are already populated.
--    Soft-deleted teachers and soft-deleted sections are excluded so a dead row
--    cannot occupy a section's single adviser slot. Restricted to role =
--    'TEACHER' for the same reason; advisory is a teacher-only concept.
-- 2) "Learner"."aralTeacherId" from "Learner"."teacherId", preserving today's
--    implicit behaviour where the adviser is also the ARAL teacher.
--
-- Deliberately NOT done here: no "GradeLevel" rows are inserted (the app creates
-- the per-school FLOATING grade lazily in a later wave) and
-- "Learner"."gradeLevelId" is never touched.

WITH ranked AS (
  SELECT
    ts."teacherId",
    ts."sectionId",
    ts."assignedAt",
    ROW_NUMBER() OVER (
      PARTITION BY ts."teacherId"
      ORDER BY ts."assignedAt" ASC, s."name" ASC, ts."sectionId" ASC
    ) AS teacher_rank
  FROM "TeacherSection" ts
  JOIN "Section" s ON s."id" = ts."sectionId"
  JOIN "User" u ON u."id" = ts."teacherId"
  WHERE u."deletedAt" IS NULL
    AND u."role" = 'TEACHER'
    AND s."deletedAt" IS NULL
),
per_teacher AS (
  SELECT "teacherId", "sectionId", "assignedAt"
  FROM ranked
  WHERE teacher_rank = 1
),
ranked_sections AS (
  SELECT
    pt."teacherId",
    pt."sectionId",
    ROW_NUMBER() OVER (
      PARTITION BY pt."sectionId"
      ORDER BY pt."assignedAt" ASC, u."createdAt" ASC, u."id" ASC
    ) AS section_rank
  FROM per_teacher pt
  JOIN "User" u ON u."id" = pt."teacherId"
),
advisers AS (
  SELECT "teacherId", "sectionId"
  FROM ranked_sections
  WHERE section_rank = 1
)
UPDATE "User" u
SET "advisorySectionId" = a."sectionId"
FROM advisers a
WHERE u."id" = a."teacherId"
  AND u."advisorySectionId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "User" taken
    WHERE taken."advisorySectionId" = a."sectionId"
      AND taken."id" <> u."id"
  );

-- ARAL learners inherit their current adviser as the designated ARAL teacher.
-- Soft-deleted learners are included so a restore keeps its designation.
UPDATE "Learner"
SET "aralTeacherId" = "teacherId"
WHERE "isAralLearner" = true
  AND "teacherId" IS NOT NULL
  AND "aralTeacherId" IS NULL;
