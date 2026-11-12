import "server-only";

import type { GradeLevelType, Learner } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LearnerUpdateInput } from "@/lib/validators/learner.schema";
import { ethnicityColumns } from "@/lib/validators/ethnicity";
import {
  formatPersonName,
  formatOptionalPersonName,
  buildFullName,
} from "@/lib/names";
import {
  LEGACY_READING_VALUE_MESSAGE,
  allowedReadingValuesForGrade,
  isLegacyReadingValue,
  languagesForGrade,
} from "@/lib/reading/policy";

/** Normalize optional Section B for Prisma (clear transferDetails unless MULTIPLE). */
export function sectionBData(data: {
  modeOfTransportation?: "WALKING" | "MOTORCYCLE" | "BUS_JEEP_CAR";
  distanceHomeToSchool?: "LESS_THAN_1KM" | "ONE_TO_FIVE_KM" | "MORE_THAN_5KM";
  previousTransfers?: "NONE" | "ONE" | "MULTIPLE";
  transferDetails?: string;
}) {
  return {
    modeOfTransportation: data.modeOfTransportation ?? null,
    distanceHomeToSchool: data.distanceHomeToSchool ?? null,
    previousTransfers: data.previousTransfers ?? null,
    transferDetails:
      data.previousTransfers === "MULTIPLE" ? (data.transferDetails?.trim() || null) : null,
  };
}

/**
 * The learner the edit applies to: the stored row plus its grade type, which
 * decides which reading languages and bands are valid.
 */
export type LearnerForUpdate = Pick<
  Learner,
  | "id"
  | "englishReadingProfile"
  | "filipinoReadingProfile"
  | "governmentBenefits"
> & { gradeLevel: { type: GradeLevelType } };

/**
 * The profile edit shared by the teacher (`updateLearner`) and the Super Admin
 * (`updateLearnerAsAdmin`). Both callers do their own auth and tenancy checks
 * first; this only enforces the reading-policy rules and writes the row.
 *
 * Placement is never touched: grade and section move only through the School
 * Head's transfer flow, so the active Enrollment row already points where it
 * should and needs no reconcile here.
 *
 * Returns an error message for a policy refusal, or null once saved.
 */
export async function applyLearnerProfileUpdate(
  learner: LearnerForUpdate,
  data: LearnerUpdateInput
): Promise<string | null> {
  // Grade comes from the learner's real, current, DB-stored grade — never the
  // edit form's own state, which never carries a gradeLevelId in the first place.
  const collectsEnglish = languagesForGrade(learner.gradeLevel.type).includes("ENGLISH");
  if (collectsEnglish && !data.englishReadingProfile) {
    return "English reading level is required";
  }
  if (!collectsEnglish && data.englishReadingProfile) {
    return "English reading level is not collected for this grade";
  }
  // A legacy value outside the grade's current allowed set stays editable for
  // every OTHER field on the row (docs/reading-policy-spec.md decision I): a
  // submitted value is accepted when it is in policy for this grade, or
  // byte-identical to what is stored. Except a Grade 1-3 legacy combined level,
  // which must be re-picked even when unchanged.
  const profiles = [data.englishReadingProfile, data.filipinoReadingProfile];
  if (profiles.some((v) => isLegacyReadingValue(v, learner.gradeLevel.type))) {
    return LEGACY_READING_VALUE_MESSAGE;
  }
  if (
    data.englishReadingProfile &&
    data.englishReadingProfile !== learner.englishReadingProfile &&
    !allowedReadingValuesForGrade(learner.gradeLevel.type).includes(data.englishReadingProfile)
  ) {
    return "Invalid English reading level for this grade";
  }
  if (
    data.filipinoReadingProfile !== learner.filipinoReadingProfile &&
    !allowedReadingValuesForGrade(learner.gradeLevel.type).includes(data.filipinoReadingProfile)
  ) {
    return "Invalid Filipino reading level for this grade";
  }

  const firstName = formatPersonName(data.firstName);
  const lastName = formatPersonName(data.lastName);
  const middleName = formatOptionalPersonName(data.middleName);
  const fullName = buildFullName(firstName, middleName, lastName);

  // Form only manages 4Ps; preserve any existing IPS flag (no longer offered in UI).
  const governmentBenefits = [
    ...(data.governmentBenefits.includes("FOUR_PS") ? (["FOUR_PS"] as const) : []),
    ...(learner.governmentBenefits.includes("IPS") ? (["IPS"] as const) : []),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.learner.update({
      where: { id: learner.id },
      data: {
        firstName,
        middleName,
        lastName,
        fullName,
        age: data.age,
        gender: data.gender,
        nutritionalStatus: data.nutritionalStatus,
        // Omitted (not set to null) when the grade doesn't collect English, so an
        // edit never touches a value stored earlier (reading-policy-spec 4a).
        ...(collectsEnglish ? { englishReadingProfile: data.englishReadingProfile } : {}),
        englishFrustrationSubtypes: data.englishFrustrationSubtypes,
        filipinoReadingProfile: data.filipinoReadingProfile,
        filipinoFrustrationSubtypes: data.filipinoFrustrationSubtypes,
        governmentBenefits,
        parentEducation: data.parentEducation,
        ...ethnicityColumns(data),
        ...sectionBData(data),
      },
    });
  });

  return null;
}

/** FormData → plain object, folding `name[]` and repeated keys into arrays. */
export function learnerFormToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      const arr = (obj[key] as string[]) ?? [];
      arr.push(String(v));
      obj[key] = arr;
    } else if (obj[k] !== undefined) {
      obj[k] = Array.isArray(obj[k])
        ? [...(obj[k] as string[]), String(v)]
        : [obj[k] as string, String(v)];
    } else {
      obj[k] = v;
    }
  }
  return obj;
}
