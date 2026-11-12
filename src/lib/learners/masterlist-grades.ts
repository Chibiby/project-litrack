/**
 * Grade arithmetic for promotion and the enroll masterlist. Pure: no Prisma,
 * no `server-only`, so client components and tests can share it.
 */

/** Kinder through Grade 12, in order. FLOATING is not a grade a learner moves through. */
export const GRADE_SEQUENCE = [
  "KINDER",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
] as const;

export type EnrollmentOutcomeValue = "PROMOTED" | "RETAINED";

/** The grade after this one, or null for Grade 12 (graduates) and non-grades. */
export function nextGradeType(type: string): string | null {
  const i = GRADE_SEQUENCE.indexOf(type as (typeof GRADE_SEQUENCE)[number]);
  if (i === -1 || i === GRADE_SEQUENCE.length - 1) return null;
  return GRADE_SEQUENCE[i + 1];
}

/** The grade before this one, or null for Kinder and non-grades. */
export function previousGradeType(type: string): string | null {
  const i = GRADE_SEQUENCE.indexOf(type as (typeof GRADE_SEQUENCE)[number]);
  if (i <= 0) return null;
  return GRADE_SEQUENCE[i - 1];
}

/**
 * Where a learner goes next year: one grade up when promoted, the same grade
 * when retained. Null when there is nowhere to go (Grade 12 promoted, FLOATING).
 */
export function targetGradeType(fromType: string, outcome: EnrollmentOutcomeValue): string | null {
  if (outcome === "RETAINED") {
    return GRADE_SEQUENCE.includes(fromType as (typeof GRADE_SEQUENCE)[number]) ? fromType : null;
  }
  return nextGradeType(fromType);
}

/**
 * Which past (grade, outcome) pairs land in an advisory of `targetType`:
 * the grade below's promoted learners, and this grade's retained ones.
 * A Grade 5 advisory reads Grade 4 PROMOTED + Grade 5 RETAINED.
 */
export function masterlistSources(
  targetType: string
): { gradeType: string; outcome: EnrollmentOutcomeValue }[] {
  if (!GRADE_SEQUENCE.includes(targetType as (typeof GRADE_SEQUENCE)[number])) return [];
  const prev = previousGradeType(targetType);
  return [
    ...(prev ? [{ gradeType: prev, outcome: "PROMOTED" as const }] : []),
    { gradeType: targetType, outcome: "RETAINED" as const },
  ];
}

/** Shown when promotion is tried outside the active duration's last month. */
export const NOT_LAST_MONTH_MESSAGE = "Promotion opens in the last month of the school year.";
