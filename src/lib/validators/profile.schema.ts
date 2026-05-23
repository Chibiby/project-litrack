import { z } from "zod";

const READING_TRAININGS = ["ARAL", "TEACHING_READING", "ELLN", "TEACEP", "NONE"] as const;
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

const baseProfile = z.object({
  contactNumber: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  designation: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  educationalAttainment: z.enum(EDUCATIONAL_ATTAINMENT),
  fieldOfSpecialization: z.enum(SPECIALIZATION),
  specializationOther: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  yearsInService: z.enum(YEARS_IN_SERVICE),
  hasReadingTraining: z.boolean(),
  readingTrainings: z.array(z.enum(READING_TRAININGS)).default([]),
  hasEnglishTraining: z.boolean(),
  englishTrainings: z.array(z.enum(ENGLISH_TRAININGS)).default([]),
  highestTrainingLevel: z.enum(TRAINING_LEVELS),
});

export const schoolHeadProfileSchema = baseProfile.extend({
  position: z.enum(SH_POSITION),
});

export const teacherProfileSchema = baseProfile.extend({
  position: z.enum(TEACHER_POSITION),
  currentGradeAssignment: z.enum(GRADE_LEVEL_TYPES).optional(),
  mostSubjectHandled: z.enum(SUBJECT),
});

export type SchoolHeadProfileInput = z.infer<typeof schoolHeadProfileSchema>;
export type TeacherProfileInput = z.infer<typeof teacherProfileSchema>;
