-- Teacher advisory modes: Floating and Multi-grade become a declared setting.
--
-- NUMBERING: 20260911000010. Production holds up to 20260911000004; 005-009 are
-- left free for feat/error-handling, which must renumber its ErrorEvent table.
--
-- APPLY BEFORE THE CODE DEPLOYS. The generated client names "advisoryMode" on
-- every TeacherProfile read, so code first is P2022 on profiling and on the
-- School Head's teachers page. Applied first, the column is invisible.
--
-- 1. DDL. Additive; every existing row lands on DEFAULT.
CREATE TYPE "AdvisoryMode" AS ENUM ('DEFAULT', 'FLOATING', 'MULTI_GRADE');
ALTER TABLE "TeacherProfile" ADD COLUMN "advisoryMode" "AdvisoryMode" NOT NULL DEFAULT 'DEFAULT';

-- 2. Teachers who already hold two or three live sections keep them. Under the
--    new rule only MULTI_GRADE may hold more than one, so they are marked it.
--    Expected on production 2026-09-11: 9 rows.
UPDATE "TeacherProfile" tp
   SET "advisoryMode" = 'MULTI_GRADE'
 WHERE (
   SELECT COUNT(*) FROM "Section" s
    WHERE s."adviserId" = tp."userId" AND s."deletedAt" IS NULL
 ) >= 2;

-- 3. Volunteers never advise. The old wizard offered them an optional section
--    picker, and picking one made them the adviser — so empty sections read as
--    taken. Release those, and ONLY those with no live learner, so no roster
--    changes hands. Expected on production 2026-09-11: 25 sections.
--    The legacy mirrors (User.advisorySectionId, TeacherSection, _TeacherGrades)
--    are cleared for the same rows, as setTeacherAdvisory would.
CREATE TEMP TABLE "_released_volunteer_sections" AS
SELECT s.id AS section_id, s."adviserId" AS teacher_id, s."gradeLevelId" AS grade_id
  FROM "Section" s
  JOIN "TeacherProfile" tp ON tp."userId" = s."adviserId"
 WHERE tp.designation = 'Non-DepEd ARAL Volunteer'
   AND s."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "Learner" l WHERE l."sectionId" = s.id AND l."deletedAt" IS NULL
   );

UPDATE "Section" SET "adviserId" = NULL
 WHERE id IN (SELECT section_id FROM "_released_volunteer_sections");

UPDATE "User" SET "advisorySectionId" = NULL
 WHERE "advisorySectionId" IN (SELECT section_id FROM "_released_volunteer_sections");

DELETE FROM "TeacherSection" ts
 USING "_released_volunteer_sections" r
 WHERE ts."teacherId" = r.teacher_id AND ts."sectionId" = r.section_id;

DELETE FROM "_TeacherGrades" tg
 USING "_released_volunteer_sections" r
 WHERE tg."A" = r.grade_id AND tg."B" = r.teacher_id
   AND NOT EXISTS (
     SELECT 1 FROM "Section" s
      WHERE s."adviserId" = r.teacher_id AND s."gradeLevelId" = r.grade_id AND s."deletedAt" IS NULL
   );

DROP TABLE "_released_volunteer_sections";
