/**
 * Shared reading-level policy: which languages and `ReadingProfile` values
 * apply to a given grade, and what "complete" means for a
 * `ReadingLevelRecord`. See docs/reading-policy-spec.md section 3.
 *
 * Framework-agnostic — no `server-only`, no runtime Prisma import — so it can
 * be imported from client components (`learner-form.tsx`,
 * `aral-monthly-reading-level-grid-form.tsx`) as well as server actions.
 *
 * Binding on every consumer: the `gradeType` passed in must come from an
 * authorized placement (`AdvisoryPlacement.gradeType` from
 * `getAdvisoryPlacements`) or a DB-loaded learner/grade row — never a
 * client-submitted `gradeLevelId`/`gradeType` form field.
 */
import type { Prisma } from "@prisma/client";
import {
  EARLY_RUBRIC_LABELS,
  READING_PROFILE_LABELS_SHS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";

export type ReadingLanguage = "ENGLISH" | "FILIPINO";

/** Kinder letter/word rubric (docs/reading-policy-spec.md section 2a). */
export const EARLY_RUBRIC_VALUES = [
  "CANNOT_NAME_SOUND_LETTERS",
  "LETTER_LEVEL",
  "CV_BLENDING",
  "CVC_BLENDING",
] as const;

/** Grade 11/Grade 12 restricted view of the original four (section 2b). */
export const SHS_ALLOWED_VALUES = [
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
] as const;

/** The original four members, offered unrestricted (G1-G10 and FLOATING; Kinder is early-rubric-only). */
export const STANDARD_VALUES = [
  "NON_DECODER_LOW_EMERGENT",
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
] as const;

const EARLY_RUBRIC_GRADE_TYPES = new Set(["KINDER"]);
const ENGLISH_EXCLUDED_GRADE_TYPES = new Set(["G1", "G2"]);
const SHS_GRADE_TYPES = new Set(["G11", "G12"]);

/**
 * Kinder = both languages; Grade 1/Grade 2 = Filipino only; every other grade
 * (G3-G10, G11/G12, FLOATING) = both, unchanged.
 */
export function languagesForGrade(gradeType: string): ReadingLanguage[] {
  if (ENGLISH_EXCLUDED_GRADE_TYPES.has(gradeType)) {
    return ["FILIPINO"];
  }
  return ["ENGLISH", "FILIPINO"];
}

/**
 * Kinder -> the letter/word rubric; G11/G12 -> the restricted SHS
 * three; everything else (G1-G10, FLOATING) -> the original four. G1/G2 share
 * G3's levels and labels but stay Filipino-only (languagesForGrade).
 */
export function allowedReadingValuesForGrade(gradeType: string): readonly string[] {
  if (EARLY_RUBRIC_GRADE_TYPES.has(gradeType)) {
    return EARLY_RUBRIC_VALUES;
  }
  if (SHS_GRADE_TYPES.has(gradeType)) {
    return SHS_ALLOWED_VALUES;
  }
  return STANDARD_VALUES;
}

export function isReadingValueAllowedForGrade(value: string, gradeType: string): boolean {
  return allowedReadingValuesForGrade(gradeType).includes(value);
}

/**
 * The single source for "what does the radio group / band picker show for
 * this grade" — values x labels, in rubric order. Supersedes the ad hoc
 * `toOptions(readingProfileLabelsForGradeType(...))` call in
 * `learner-form.tsx` and the hardcoded `PROFILE_ORDER` in
 * `aral-monthly-reading-level-grid-form.tsx`.
 */
export function readingProfileOptionsForGrade(
  gradeType: string
): { value: string; label: string }[] {
  const values = allowedReadingValuesForGrade(gradeType);
  const labels: Record<string, string> = EARLY_RUBRIC_GRADE_TYPES.has(gradeType)
    ? EARLY_RUBRIC_LABELS
    : SHS_GRADE_TYPES.has(gradeType)
      ? READING_PROFILE_LABELS_SHS
      : readingProfileLabelsForGradeType(gradeType);
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

/**
 * Completeness for ONE record, grade-aware: English is only required when
 * `languagesForGrade(gradeType)` includes it. `writingLevel` and `notes` are
 * excluded on purpose — same rule `COMPLETE_ASSESSMENT_WHERE` already
 * documents.
 */
export type ReadingRecordLike = {
  englishProfile: string | null;
  filipinoProfile: string | null;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
};

export function isReadingRecordComplete(
  record: ReadingRecordLike,
  gradeType: string
): boolean {
  if (languagesForGrade(gradeType).includes("ENGLISH") && record.englishProfile == null) {
    return false;
  }
  return (
    record.filipinoProfile != null &&
    record.wordRecognitionLevel != null &&
    record.readingComprehensionLevel != null
  );
}

/**
 * Prisma predicate builder for a SET of grades that may mix language
 * policies (a teacher advising both a G2 and a G5 section, or the
 * admin-wide chart). Partitions the grade ids by `languagesForGrade` and
 * OR's the two shapes — no raw SQL, fully typed, and each shape stays
 * legible on its own.
 */
export function completeAssessmentWhereForGrades(
  grades: { id: string; type: string }[]
): Prisma.ReadingLevelRecordWhereInput {
  const bothLanguageGradeIds: string[] = [];
  const filipinoOnlyGradeIds: string[] = [];
  for (const grade of grades) {
    if (languagesForGrade(grade.type).includes("ENGLISH")) {
      bothLanguageGradeIds.push(grade.id);
    } else {
      filipinoOnlyGradeIds.push(grade.id);
    }
  }

  const shapes: Prisma.ReadingLevelRecordWhereInput[] = [];
  if (bothLanguageGradeIds.length > 0) {
    shapes.push({
      learner: { gradeLevelId: { in: bothLanguageGradeIds } },
      englishProfile: { not: null },
      filipinoProfile: { not: null },
      wordRecognitionLevel: { not: null },
      readingComprehensionLevel: { not: null },
    });
  }
  if (filipinoOnlyGradeIds.length > 0) {
    shapes.push({
      learner: { gradeLevelId: { in: filipinoOnlyGradeIds } },
      filipinoProfile: { not: null },
      wordRecognitionLevel: { not: null },
      readingComprehensionLevel: { not: null },
    });
  }

  if (shapes.length === 0) {
    // No grades in scope: match nothing rather than accidentally matching
    // everything (an empty `OR: []` would evaluate to `false` in Prisma
    // anyway, but this is the explicit, intention-revealing shape).
    return { id: "" };
  }
  if (shapes.length === 1) {
    return shapes[0];
  }
  return { OR: shapes };
}
