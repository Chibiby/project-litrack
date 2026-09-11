-- Release the advisories still held by teachers who have already been removed.
--
-- Data only. No schema change, so `schema.prisma` is untouched and this cannot
-- drift from it.
--
-- WHY
-- ---
-- Removing a teacher is a soft delete (`User.deletedAt`), so no foreign-key
-- action ever fires. Since Wave A of multi-advisory the authoritative adviser is
-- `Section.adviserId`, but both removal paths — the School Head's Remove and the
-- Super Admin's bulk removal — only cleared the legacy `User.advisorySectionId`.
-- Every section a removed teacher advised therefore still names them:
--
--   * it never reads as Unassigned, and the advisory picker labels it with the
--     removed teacher's name;
--   * `setTeacherAdvisory` only claims a section whose `adviserId IS NULL`, so no
--     School Head can give it to anyone else — it is stuck.
--
-- The code shipped with this migration releases the advisory at removal time
-- (`releaseTeacherAdvisory`). This clears the rows removed before that.
--
-- WHAT IT DOES — the same end state `releaseTeacherAdvisory` produces
-- -------------------------------------------------------------------
--   1. `Section.adviserId`       -> NULL where it names a removed teacher.
--   2. `Learner.teacherId`       -> NULL where it names a removed teacher. Those
--      learners are adviser-less — the state a floating learner is already in —
--      until the School Head assigns their section a new adviser, who then picks
--      them up automatically.
--   3. `Enrollment.teacherId`    -> NULL on ACTIVE rows only, so each active
--      enrolment keeps agreeing with its learner row. Closed enrolments are
--      history and keep who advised that year.
--   4. `TeacherSection` rows of removed teachers are deleted, and their
--      `User.advisorySectionId` is nulled — the legacy mirrors `setTeacherAdvisory`
--      keeps in step with `Section.adviserId`.
--
-- `Learner.aralTeacherId` is deliberately NOT touched: an ARAL designation is a
-- separate assignment, and clearing it would silently drop learners out of ARAL
-- tracking. The School Head's Remove still refuses while one is held.
--
-- Before applying, this previews what will change:
--
--   SELECT
--     (SELECT count(*) FROM "Section" s JOIN "User" u ON u."id" = s."adviserId"
--       WHERE u."deletedAt" IS NOT NULL) AS sections,
--     (SELECT count(*) FROM "Learner" l JOIN "User" u ON u."id" = l."teacherId"
--       WHERE u."deletedAt" IS NOT NULL) AS learners,
--     (SELECT count(*) FROM "Enrollment" e JOIN "User" u ON u."id" = e."teacherId"
--       WHERE u."deletedAt" IS NOT NULL AND e."status" = 'ACTIVE') AS enrollments;
--
-- SAFETY
-- ------
-- Every statement is bounded by `u."deletedAt" IS NOT NULL`: it can only touch a
-- pointer to a teacher who can no longer sign in, never a live teacher's
-- assignment. Idempotent — once a pointer is NULL (or the row deleted) nothing
-- matches it again, so a second run changes nothing. Removal already deleted
-- these teachers' logins, so nothing here takes access from anyone.

UPDATE "Section" AS s
SET "adviserId" = NULL
FROM "User" AS u
WHERE s."adviserId" = u."id"
  AND u."deletedAt" IS NOT NULL;

UPDATE "Learner" AS l
SET "teacherId" = NULL
FROM "User" AS u
WHERE l."teacherId" = u."id"
  AND u."deletedAt" IS NOT NULL;

UPDATE "Enrollment" AS e
SET "teacherId" = NULL
FROM "User" AS u
WHERE e."teacherId" = u."id"
  AND u."deletedAt" IS NOT NULL
  AND e."status" = 'ACTIVE';

DELETE FROM "TeacherSection" AS ts
USING "User" AS u
WHERE ts."teacherId" = u."id"
  AND u."deletedAt" IS NOT NULL;

UPDATE "User"
SET "advisorySectionId" = NULL
WHERE "deletedAt" IS NOT NULL
  AND "advisorySectionId" IS NOT NULL;
