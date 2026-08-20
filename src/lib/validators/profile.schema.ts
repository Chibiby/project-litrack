import { z } from "zod";
import { email, nonEmpty } from "./common";
import { optionalPhPhone } from "./phone";

const READING_TRAININGS = ["ARAL", "TEACHING_READING", "ELLN", "TEACEP", "NONE"] as const;

/** Single source of truth for the ARAL-only teacher designation literal. */
export const ARAL_VOLUNTEER_DESIGNATION = "Non-DepEd ARAL Volunteer" as const;

/**
 * Optional legacy profile contact email (P-I4 / DB column).
 * No longer collected in profiling UI; still accepted if present so older payloads
 * do not break. Never mutates login email on User.
 */
const optionalContactEmail = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  })
  .pipe(z.union([email, z.undefined()]));
const ENGLISH_TRAININGS = ["MATATAG_TRAINING", "UPSKILLING_ENGLISH_COMPETENCE", "NONE"] as const;

const TRAINING_LEVELS = ["INTERNATIONAL", "NATIONAL", "REGION", "DIVISION", "DISTRICT", "SCHOOL", "NA"] as const;

const EDUCATIONAL_ATTAINMENT = [
  "BACHELORS",
  "WITH_MASTERS_UNITS",
  "MASTERS",
  "WITH_DOCTORAL_UNITS",
  "DOCTORAL",
] as const;

/** Years in service: integer 0–70 (FormData strings coerced). */
export const YEARS_IN_SERVICE_MIN = 0;
export const YEARS_IN_SERVICE_MAX = 70;

const yearsInServiceSchema = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "string" && val.trim() !== "") {
    const n = Number(val);
    return Number.isFinite(n) ? n : val;
  }
  return val;
}, z
  .number({
    required_error: "Years in service is required",
    invalid_type_error: "Enter years in service as a number",
  })
  .int("Enter a whole number of years")
  .min(YEARS_IN_SERVICE_MIN, `Enter a value from ${YEARS_IN_SERVICE_MIN} to ${YEARS_IN_SERVICE_MAX}`)
  .max(YEARS_IN_SERVICE_MAX, `Enter a value from ${YEARS_IN_SERVICE_MIN} to ${YEARS_IN_SERVICE_MAX}`));

const SPECIALIZATION = [
  "GENERAL_EDUCATION",
  "ENGLISH",
  "MATH",
  "SCIENCE",
  "FILIPINO",
  "TLE_EPP",
  "ARALPAN",
  "MAPEH",
  "TECHVOC",
  "VALUES_ED",
  "OTHERS",
  "NA",
] as const;

const SH_POSITION = [
  "TEACHER_I_TIC", "TEACHER_II_TIC", "TEACHER_III_TIC", "TEACHER_IV_TIC", "TEACHER_V_TIC",
  "HEAD_TEACHER_I", "HEAD_TEACHER_II", "HEAD_TEACHER_III", "HEAD_TEACHER_IV",
  "HEAD_TEACHER_V", "HEAD_TEACHER_VI", "HEAD_TEACHER_VII",
  "PRINCIPAL_I", "PRINCIPAL_II", "PRINCIPAL_III", "PRINCIPAL_IV", "TECHVOC_AD",
] as const;

const TEACHER_POSITION = [
  "TEACHER_I", "TEACHER_II", "TEACHER_III", "TEACHER_IV", "TEACHER_V", "TEACHER_VI", "TEACHER_VII",
  "MASTER_TEACHER_I", "MASTER_TEACHER_II", "MASTER_TEACHER_III", "MASTER_TEACHER_IV",
] as const;

export const TEACHER_RANK_POSITIONS = [
  "TEACHER_I",
  "TEACHER_II",
  "TEACHER_III",
  "TEACHER_IV",
  "TEACHER_V",
  "TEACHER_VI",
  "TEACHER_VII",
] as const;

export const MASTER_TEACHER_RANK_POSITIONS = [
  "MASTER_TEACHER_I",
  "MASTER_TEACHER_II",
  "MASTER_TEACHER_III",
  "MASTER_TEACHER_IV",
] as const;

const GRADE_LEVEL_TYPES = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
] as const;

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

/** Empty / null form values → undefined for optional teacher position. */
const optionalTeacherPosition = z
  .union([z.enum(TEACHER_POSITION), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v === "" || v == null ? undefined : v));

/** Empty / null form values → undefined for optional advisory section. */
const optionalSectionId = z
  .union([z.string().uuid("Invalid section"), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v === "" || v == null ? undefined : v));

/**
 * Teacher-only relaxation of `yearsInServiceSchema`: "" / null / undefined mean
 * "N/A" (undefined), but a present value is still validated as an integer in
 * the same 0–70 range. Does not touch `baseProfile.yearsInService`, which stays
 * required for `schoolHeadProfileSchema`.
 */
const teacherYearsInServiceSchema = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "string" && val.trim() !== "") {
    const n = Number(val);
    return Number.isFinite(n) ? n : val;
  }
  return val;
}, z
  .number({
    invalid_type_error: "Enter years in service as a number",
  })
  .int("Enter a whole number of years")
  .min(YEARS_IN_SERVICE_MIN, `Enter a value from ${YEARS_IN_SERVICE_MIN} to ${YEARS_IN_SERVICE_MAX}`)
  .max(YEARS_IN_SERVICE_MAX, `Enter a value from ${YEARS_IN_SERVICE_MIN} to ${YEARS_IN_SERVICE_MAX}`)
  .optional());

type ProfileRefineShape = {
  fieldOfSpecialization: (typeof SPECIALIZATION)[number];
  specializationOther?: string;
  hasReadingTraining: boolean;
  readingTrainings: (typeof READING_TRAININGS)[number][];
  hasEnglishTraining: boolean;
  englishTrainings: (typeof ENGLISH_TRAININGS)[number][];
};

/** Shared P-II / P-IV conditional rules (specialization Other, training Yes/No, None exclusivity). */
function refineProfileConditionals(data: ProfileRefineShape, ctx: z.RefinementCtx) {
  if (data.fieldOfSpecialization === "OTHERS" && !data.specializationOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Specify specialization when Others is selected",
      path: ["specializationOther"],
    });
  }
  if (data.fieldOfSpecialization !== "OTHERS" && data.specializationOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Specialization details are only allowed when Others is selected",
      path: ["specializationOther"],
    });
  }

  if (data.hasReadingTraining) {
    if (!data.readingTrainings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one reading training when Yes is selected",
        path: ["readingTrainings"],
      });
    }
  } else if (data.readingTrainings.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Clear reading trainings when No is selected",
      path: ["readingTrainings"],
    });
  }

  if (data.readingTrainings.includes("NONE") && data.readingTrainings.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "'None at all' cannot be combined with other reading trainings",
      path: ["readingTrainings"],
    });
  }

  if (data.hasEnglishTraining) {
    if (!data.englishTrainings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one English curriculum training when Yes is selected",
        path: ["englishTrainings"],
      });
    }
  } else if (data.englishTrainings.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Clear English trainings when No is selected",
      path: ["englishTrainings"],
    });
  }

  if (data.englishTrainings.includes("NONE") && data.englishTrainings.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "'None at all' cannot be combined with other English trainings",
      path: ["englishTrainings"],
    });
  }
}

function isTeacherRankPosition(
  position: string | undefined,
): position is (typeof TEACHER_RANK_POSITIONS)[number] {
  return (
    position != null &&
    (TEACHER_RANK_POSITIONS as readonly string[]).includes(position)
  );
}

function isMasterTeacherRankPosition(
  position: string | undefined,
): position is (typeof MASTER_TEACHER_RANK_POSITIONS)[number] {
  return (
    position != null &&
    (MASTER_TEACHER_RANK_POSITIONS as readonly string[]).includes(position)
  );
}

/** Teacher designation ↔ position pairing (Teacher / Master Teacher / Others). */
function refineTeacherDesignationPosition(
  data: {
    designation: string;
    position?: (typeof TEACHER_POSITION)[number];
  },
  ctx: z.RefinementCtx,
) {
  if (data.designation === "School Head") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Teachers cannot use the School Head designation",
      path: ["designation"],
    });
    return;
  }

  if (data.designation === "Teacher") {
    if (!isTeacherRankPosition(data.position)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a Teacher I–VII position",
        path: ["position"],
      });
    }
    return;
  }

  if (data.designation === "Master Teacher") {
    if (!isMasterTeacherRankPosition(data.position)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a Master Teacher I–IV position",
        path: ["position"],
      });
    }
    return;
  }

  // Everything else (Others free text, "Non-DepEd ARAL Volunteer", or any other
  // custom designation string): none of these are ranked teaching positions, so
  // `position` must be cleared. This intentionally covers three non-ranked
  // cases, not just "Others" — not an oversight.
  if (data.position != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Position is not used for custom designations",
      path: ["position"],
    });
  }
}

const profileNames = z.object({
  firstName: nonEmpty("First name is required"),
  middleName: optionalText(100),
  lastName: nonEmpty("Last name is required"),
});

const baseProfile = z.object({
  contactNumber: optionalPhPhone,
  /** Legacy DB field — optional; not collected in current profiling UI. */
  contactEmail: optionalContactEmail,
  educationalAttainment: z.enum(EDUCATIONAL_ATTAINMENT),
  fieldOfSpecialization: z.enum(SPECIALIZATION),
  specializationOther: optionalText(100),
  yearsInService: yearsInServiceSchema,
  hasReadingTraining: z.boolean(),
  readingTrainings: z.array(z.enum(READING_TRAININGS)).default([]),
  hasEnglishTraining: z.boolean(),
  englishTrainings: z.array(z.enum(ENGLISH_TRAININGS)).default([]),
  highestTrainingLevel: z.enum(TRAINING_LEVELS),
});

export const schoolHeadProfileSchema = baseProfile
  .merge(profileNames)
  .extend({
    /** Read-only UI always sends School Head. */
    designation: z.literal("School Head"),
    position: z.enum(SH_POSITION),
  })
  .superRefine(refineProfileConditionals);

/** Names update User on save; other fields persist on TeacherProfile. */
export const teacherProfileSchema = baseProfile
  .merge(profileNames)
  .extend({
    designation: nonEmpty("Designation is required").max(100),
    position: optionalTeacherPosition,
    currentGradeAssignment: z.enum(GRADE_LEVEL_TYPES).optional(),
    sectionId: optionalSectionId,
    yearsInService: teacherYearsInServiceSchema,
  })
  .superRefine((data, ctx) => {
    refineProfileConditionals(data, ctx);
    refineTeacherDesignationPosition(data, ctx);
    // An ARAL Volunteer holds no classroom assignment at all: they advise no
    // section and they are not attached to a grade. Every other designation
    // describes a classroom teaching role, so both stay required there.
    // `undefined` on either field clears whatever the teacher held before.
    if (data.designation === ARAL_VOLUNTEER_DESIGNATION) return;
    if (data.currentGradeAssignment === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a grade level",
        path: ["currentGradeAssignment"],
      });
    }
    if (data.sectionId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a section",
        path: ["sectionId"],
      });
    }
  });

export type SchoolHeadProfileInput = z.infer<typeof schoolHeadProfileSchema>;
export type TeacherProfileInput = z.infer<typeof teacherProfileSchema>;
