"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { teacherLearnerScope } from "@/lib/teachers/scope";
import { formatLocalDateKey } from "@/lib/date-keys";
import {
  PROFILE_ATTENDANCE_TAKE,
  PROFILE_ENROLLMENT_TAKE,
  PROFILE_READING_TAKE,
  type LearnerProfileData,
} from "@/lib/learners/profile";

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Nullable Date → local `YYYY-MM-DD`, never `toISOString()` (UTC+8 shifts). */
function dateKey(value: Date | null | undefined): string | null {
  return value ? formatLocalDateKey(value) : null;
}

/**
 * The tenancy filter both reads below share: school scope plus the teacher's
 * advisory-or-ARAL scope, and `deletedAt: null`.
 *
 * Null means the caller can own no learner at all — a teacher with no school —
 * so the caller bails rather than letting `schoolId: undefined` drop out of the
 * filter and widen the query. One helper rather than two literals: a filter this
 * load-bearing must not be able to drift between the actions that use it.
 */
function teacherLearnerWhere(
  user: { id: string; schoolId: string | null },
  id: string
): Prisma.LearnerWhereInput | null {
  if (!user.schoolId) return null;
  return {
    id,
    schoolId: user.schoolId,
    deletedAt: null,
    ...teacherLearnerScope(user.id),
  };
}

/**
 * Everything the read-only Student Profile modal renders, in one round trip.
 *
 * The `where` mirrors the learner detail page exactly: school scope plus the
 * teacher's advisory-or-ARAL scope, and `deletedAt: null`. A learner in another
 * school — or in this school but another teacher's care — returns the same
 * generic "Not found" as a learner that does not exist, so the modal can never
 * confirm a record it has no right to see.
 *
 * Super Admin impersonates every role, so it skips the teacher scope but keeps
 * the soft-delete filter (see the same branch on the detail page).
 *
 * Read-only, so no audit row and no rate limit — matching `searchActiveLearners`.
 */
export async function getLearnerProfile(
  learnerId: string
): Promise<ActionResult<LearnerProfileData>> {
  const user = await requireUser("TEACHER");
  const id = learnerId?.trim();
  if (!id) return { ok: false, error: "Not found" };

  const isSuperAdmin = user.role === "SUPER_ADMIN";

  const where: Prisma.LearnerWhereInput | null = isSuperAdmin
    ? { id, deletedAt: null }
    : teacherLearnerWhere(user, id);
  if (!where) return { ok: false, error: "Not found" };

  const learner = await prisma.learner.findFirst({
    where,
    select: {
      id: true,
      fullName: true,
      firstName: true,
      middleName: true,
      lastName: true,
      age: true,
      gender: true,
      ethnicity: true,
      ethnicityOther: true,
      englishReadingProfile: true,
      englishFrustrationSubtypes: true,
      filipinoReadingProfile: true,
      filipinoFrustrationSubtypes: true,
      governmentBenefits: true,
      parentEducation: true,
      modeOfTransportation: true,
      distanceHomeToSchool: true,
      previousTransfers: true,
      transferDetails: true,
      gradeLevelId: true,
      isAralLearner: true,
      aralEnrolledAt: true,
      aralTeacherId: true,
      archivedAt: true,
      createdAt: true,
      gradeLevel: { select: { type: true } },
      section: { select: { name: true } },
      teacher: { select: { fullName: true } },
      aralTeacher: { select: { fullName: true } },
      enrollments: {
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          endedAt: true,
          schoolYear: { select: { label: true } },
          gradeLevel: { select: { type: true } },
          section: { select: { name: true } },
          teacher: { select: { fullName: true } },
        },
        orderBy: { enrolledAt: "desc" },
        take: PROFILE_ENROLLMENT_TAKE,
      },
      attendances: {
        select: {
          id: true,
          date: true,
          weekStart: true,
          status: true,
          notes: true,
        },
        orderBy: { date: "desc" },
        take: PROFILE_ATTENDANCE_TAKE,
      },
      readingLevels: {
        select: {
          id: true,
          weekStart: true,
          englishProfile: true,
          filipinoProfile: true,
          wordRecognitionLevel: true,
          readingComprehensionLevel: true,
          notes: true,
        },
        orderBy: { weekStart: "desc" },
        take: PROFILE_READING_TAKE,
      },
      aralProfile: {
        select: {
          absenteeismFrequency: true,
          absenteeismOtherReason: true,
          letterRecognition: true,
          letterSoundCorrespondence: true,
          wordRecognition: true,
          homeLiteracyEnvironment: true,
          parentalSupport: true,
          classroomEnvironment: true,
          languageConsiderations: true,
          suggestedInterventions: true,
          furtherAssessment: true,
          furtherAssessmentOther: true,
          lsenObservations: true,
        },
      },
    },
  });

  if (!learner) return { ok: false, error: "Not found" };

  return {
    ok: true,
    data: {
      id: learner.id,
      fullName: learner.fullName,
      firstName: learner.firstName,
      middleName: learner.middleName,
      lastName: learner.lastName,
      age: learner.age,
      gender: learner.gender,
      ethnicity: learner.ethnicity,
      ethnicityOther: learner.ethnicityOther,
      englishReadingProfile: learner.englishReadingProfile,
      filipinoReadingProfile: learner.filipinoReadingProfile,
      englishFrustrationSubtypes: learner.englishFrustrationSubtypes,
      filipinoFrustrationSubtypes: learner.filipinoFrustrationSubtypes,
      governmentBenefits: learner.governmentBenefits,
      parentEducation: learner.parentEducation,
      modeOfTransportation: learner.modeOfTransportation,
      distanceHomeToSchool: learner.distanceHomeToSchool,
      previousTransfers: learner.previousTransfers,
      transferDetails: learner.transferDetails,
      gradeLevelId: learner.gradeLevelId,
      gradeType: learner.gradeLevel.type,
      sectionName: learner.section?.name ?? null,
      adviserName: learner.teacher?.fullName ?? null,
      isAralLearner: learner.isAralLearner,
      aralEnrolledAt: dateKey(learner.aralEnrolledAt),
      aralTutorName: learner.aralTeacher?.fullName ?? null,
      aralTeacherId: learner.aralTeacherId,
      archivedAt: dateKey(learner.archivedAt),
      createdAt: formatLocalDateKey(learner.createdAt),
      enrollments: learner.enrollments.map((e) => ({
        id: e.id,
        status: e.status,
        enrolledAt: formatLocalDateKey(e.enrolledAt),
        endedAt: dateKey(e.endedAt),
        schoolYearLabel: e.schoolYear?.label ?? null,
        gradeType: e.gradeLevel?.type ?? null,
        sectionName: e.section?.name ?? null,
        teacherName: e.teacher?.fullName ?? null,
      })),
      attendances: learner.attendances.map((a) => ({
        id: a.id,
        date: formatLocalDateKey(a.date),
        weekStart: formatLocalDateKey(a.weekStart),
        status: a.status,
        notes: a.notes,
      })),
      readingLevels: learner.readingLevels.map((r) => ({
        id: r.id,
        weekStart: formatLocalDateKey(r.weekStart),
        englishProfile: r.englishProfile,
        filipinoProfile: r.filipinoProfile,
        wordRecognitionLevel: r.wordRecognitionLevel,
        readingComprehensionLevel: r.readingComprehensionLevel,
        notes: r.notes,
      })),
      aralProfile: learner.aralProfile
        ? {
            absenteeismFrequency: learner.aralProfile.absenteeismFrequency,
            absenteeismOtherReason: learner.aralProfile.absenteeismOtherReason,
            letterRecognition: learner.aralProfile.letterRecognition,
            letterSoundCorrespondence:
              learner.aralProfile.letterSoundCorrespondence,
            wordRecognition: learner.aralProfile.wordRecognition,
            homeLiteracyEnvironment:
              learner.aralProfile.homeLiteracyEnvironment,
            parentalSupport: learner.aralProfile.parentalSupport,
            classroomEnvironment: learner.aralProfile.classroomEnvironment,
            languageConsiderations: learner.aralProfile.languageConsiderations,
            suggestedInterventions: learner.aralProfile.suggestedInterventions,
            furtherAssessment: learner.aralProfile.furtherAssessment,
            furtherAssessmentOther: learner.aralProfile.furtherAssessmentOther,
            lsenObservations: learner.aralProfile.lsenObservations,
          }
        : null,
    },
  };
}

/*
 * There is no `getLearnerEditContext` any more.
 *
 * It existed to feed the edit form's grade and section selects. Placement is no
 * longer chosen in that form — a learner joins their teacher's advisory section
 * and moves only by transfer — so the form's remaining placement facts (grade
 * type, grade and section names) all come from the profile read that edit mode
 * already waits for. The round trip that used to sit between pressing Edit and
 * seeing the form went with it.
 */
