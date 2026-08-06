import { z } from "zod";
import { email } from "./common";

const READING_TRAININGS = ["ARAL", "TEACHING_READING", "ELLN", "TEACEP", "NONE"] as const;

/** Optional survey contact email (P-I4). Empty → undefined; never mutates login email. */
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

const YEARS_IN_SERVICE = ["Y0_3", "Y4_10", "Y11_20", "Y21_PLUS"] as const;

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
] as const;

const SUBJECT = [
  "ENGLISH", "MATH", "SCIENCE", "FILIPINO", "TLE_EPP", "ARALPAN", "MAPEH", "TECHVOC", "VALUES_ED", "ABM",
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

const GRADE_LEVEL_TYPES = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
] as const;

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

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

const baseProfile = z.object({
  contactNumber: optionalText(40),
  /** DOCX P-I4 — real contact email on profile; login email stays on User. */
  contactEmail: optionalContactEmail,
  /** Free text; UI offers Teacher / Master Teacher / School Head / Others (P-I2). */
  designation: optionalText(100),
  educationalAttainment: z.enum(EDUCATIONAL_ATTAINMENT),
  fieldOfSpecialization: z.enum(SPECIALIZATION),
  specializationOther: optionalText(100),
  yearsInService: z.enum(YEARS_IN_SERVICE),
  hasReadingTraining: z.boolean(),
  readingTrainings: z.array(z.enum(READING_TRAININGS)).default([]),
  hasEnglishTraining: z.boolean(),
  englishTrainings: z.array(z.enum(ENGLISH_TRAININGS)).default([]),
  highestTrainingLevel: z.enum(TRAINING_LEVELS),
});

export const schoolHeadProfileSchema = baseProfile
  .extend({
    position: z.enum(SH_POSITION),
  })
  .superRefine(refineProfileConditionals);

export const teacherProfileSchema = baseProfile
  .extend({
    position: z.enum(TEACHER_POSITION),
    currentGradeAssignment: z.enum(GRADE_LEVEL_TYPES).optional(),
    mostSubjectHandled: z.enum(SUBJECT),
  })
  .superRefine(refineProfileConditionals);

export type SchoolHeadProfileInput = z.infer<typeof schoolHeadProfileSchema>;
export type TeacherProfileInput = z.infer<typeof teacherProfileSchema>;
