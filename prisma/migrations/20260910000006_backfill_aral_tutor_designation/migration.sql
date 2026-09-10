-- Backfill `Learner.aralTeacherId` for ARAL learners who have no designated
-- tutor, handing each one to their own adviser.
--
-- Numbered 000006, not 000005: the release-channel work already schedules its
-- own migration ahead of this one, and a gap costs nothing — migrations apply in
-- lexicographic order, and this must land after 20260910000004 either way.
--
-- WHY
-- ---
-- §11 of the ten concerns (`docs/superpowers/specs/2026-09-10-version-1-0-0-and-
-- ten-concerns-design.md`) narrowed every ARAL page and write path from
-- `teacherLearnerScope` — "adviser OR designated tutor" — to `aralLearnerScope`,
-- which is `aralTeacherId` alone. That was the fix for a real bug: an adviser
-- could see and encode the ARAL records of learners in their class that somebody
-- else was running the programme for.
--
-- The cost of the narrowing is that `aralTeacherId` is now the ONLY way an ARAL
-- learner is reachable. A row with `isAralLearner = true` and
-- `aralTeacherId IS NULL` was previously visible to its adviser through the other
-- half of the predicate; it is now visible to nobody at all. Not to the adviser,
-- not to a School Head's teacher view, not on any ARAL page.
--
-- HOW SUCH A ROW EXISTS
-- ---------------------
-- Two ways, neither of them a data error at the time:
--
--   1. The CSV importer. `commitLearnerImport` set `isAralLearner` and
--      `aralEnrolledAt` from the sheet but never wrote `aralTeacherId`. Fixed
--      forward in the same change as this migration — new imports designate the
--      importing teacher — so this backfill covers the rows already written.
--   2. A deleted tutor. `Learner.aralTeacher` is `onDelete: SetNull`, so hard
--      deleting a teacher's `User` row nulls the designation on every learner
--      they tutored and leaves the learners in the programme.
--
-- `toggleAralEnrollment` has never produced one: it falls back to
-- `learner.aralTeacherId || user.id`, and un-enrolling clears the pointer so it
-- can never grant access to a learner outside the programme.
--
-- WHO GETS THE DESIGNATION
-- ------------------------
-- The learner's own adviser (`teacherId`), and only when that adviser is a
-- teacher the app would let somebody pick today. The predicate below is
-- `aralTutorScope` (`src/lib/teachers/aral-tutor.ts`) written out in SQL: same
-- school, role TEACHER, not soft-deleted, active, approval APPROVED. Designating
-- someone the picker would refuse would put the database in a state the app
-- cannot reproduce or validate.
--
-- Note `approvalStatus` is nullable and this requires the literal 'APPROVED', so
-- a teacher whose row predates the approval column is NOT eligible — exactly as
-- in the app, where the picker will not offer them either. That is deliberate
-- consistency, and it means some rows are left for a human below.
--
-- The adviser is the right default rather than merely the available one: before
-- the narrowing they were the person who could see these learners, so handing
-- them the designation preserves what was actually happening rather than
-- inventing a new assignment. A School Head can reassign from the ARAL picker.
--
-- WHAT IS DELIBERATELY LEFT ALONE
-- -------------------------------
--   * Learners with no adviser at all (`teacherId IS NULL`). There is nobody to
--     hand them to, and guessing — the school's first teacher, the head — would
--     put a name against a programme nobody agreed to run.
--   * Learners whose adviser fails the eligibility predicate above.
--   * Soft-deleted learners (`deletedAt IS NOT NULL`). They are visible nowhere
--     and a restore is a deliberate act that can set the designation then.
--
-- ARCHIVED learners ARE included. Archiving is not deletion — an archived
-- learner can come back — and restoring one into an unreachable state is the
-- bug this migration exists to remove.
--
-- Both leftover cases need a person, not a default. After applying, this lists
-- them for the School Head to designate through the ARAL picker:
--
--   SELECT s."name" AS school, l."id", l."fullName",
--          CASE WHEN l."teacherId" IS NULL
--               THEN 'no adviser'
--               ELSE 'adviser not an eligible tutor' END AS reason
--   FROM "Learner" l
--   JOIN "School" s ON s."id" = l."schoolId"
--   WHERE l."isAralLearner" = true
--     AND l."aralTeacherId" IS NULL
--     AND l."deletedAt" IS NULL
--   ORDER BY school, l."fullName";
--
-- SAFETY
-- ------
-- Idempotent: the `aralTeacherId IS NULL` predicate means a second run matches
-- nothing. It only ever fills a NULL — no existing designation is moved, so a
-- deliberate assignment made between authoring and applying is untouched, and
-- re-running cannot take a learner away from the tutor actually running their
-- programme. Bounded by that same predicate: it cannot touch a non-ARAL learner,
-- and it writes no column but this one.

UPDATE "Learner" AS l
SET "aralTeacherId" = l."teacherId"
WHERE l."isAralLearner" = true
  AND l."aralTeacherId" IS NULL
  AND l."deletedAt" IS NULL
  AND l."teacherId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "User" AS u
    WHERE u."id" = l."teacherId"
      -- aralTutorScope(), in SQL. Keep the two in step.
      AND u."schoolId" = l."schoolId"
      AND u."role" = 'TEACHER'
      AND u."deletedAt" IS NULL
      AND u."isActive" = true
      AND u."approvalStatus" = 'APPROVED'
  );
