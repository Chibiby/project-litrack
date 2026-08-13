-- Additive only: widen TeacherProfile nullability + add a Specialization enum value.
-- yearsInService: null now means "N/A" (teacher declined to specify a number).
-- mostSubjectHandled: field is being removed from the UI; column kept nullable
-- (not dropped) per additive-first convention — safe to drop in a future wave
-- once explicitly approved.

ALTER TYPE "Specialization" ADD VALUE 'NA';
ALTER TABLE "TeacherProfile" ALTER COLUMN "yearsInService" DROP NOT NULL;
ALTER TABLE "TeacherProfile" ALTER COLUMN "mostSubjectHandled" DROP NOT NULL;
