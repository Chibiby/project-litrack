/**
 * How much of a teacher's profile is filled in, for the Settings summary tile.
 *
 * Pure on purpose (no Prisma, no React): it takes the same values the profile
 * form is seeded with, so the page and a unit test can call it alike.
 *
 * Counted: every field a teacher can change from Settings. Designation,
 * position and the teaching assignment are left out because Settings shows them
 * read-only; a score the teacher cannot raise would only nag. A conditional
 * field counts only while it applies (the "specify" line for Others, the
 * training lists after a Yes, years in service unless saved as N/A).
 */
export type ProfileCompletionInput = {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  contactNumber?: string | null;
  gender?: string | null;
  ethnicity?: string | null;
  ethnicityOther?: string | null;
  educationalAttainment?: string | null;
  fieldOfSpecialization?: string | null;
  specializationOther?: string | null;
  /** `null` is a saved N/A and does not apply; `undefined` means never answered. */
  yearsInService?: number | string | null;
  hasReadingTraining?: boolean | null;
  readingTrainings?: readonly string[] | null;
  hasEnglishTraining?: boolean | null;
  englishTrainings?: readonly string[] | null;
  highestTrainingLevel?: string | null;
};

export type ProfileCompletion = {
  /** 0–100, rounded down so 100 always means every counted field is filled. */
  percent: number;
  filled: number;
  total: number;
};

function hasText(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim().length > 0;
}

export function computeProfileCompletion(input: ProfileCompletionInput): ProfileCompletion {
  const checks: boolean[] = [
    hasText(input.firstName),
    hasText(input.middleName),
    hasText(input.lastName),
    hasText(input.contactNumber),
    hasText(input.gender),
    hasText(input.ethnicity),
    hasText(input.educationalAttainment),
    hasText(input.fieldOfSpecialization),
    input.hasReadingTraining === true || input.hasReadingTraining === false,
    input.hasEnglishTraining === true || input.hasEnglishTraining === false,
    hasText(input.highestTrainingLevel),
  ];

  if (input.ethnicity === "OTHER") checks.push(hasText(input.ethnicityOther));
  if (input.fieldOfSpecialization === "OTHERS") checks.push(hasText(input.specializationOther));
  if (input.yearsInService !== null) checks.push(hasText(input.yearsInService));
  if (input.hasReadingTraining === true) checks.push((input.readingTrainings ?? []).length > 0);
  if (input.hasEnglishTraining === true) checks.push((input.englishTrainings ?? []).length > 0);

  const total = checks.length;
  const filled = checks.filter(Boolean).length;
  return { percent: Math.floor((filled / total) * 100), filled, total };
}

/** Encouraging line under the completion ring, by band. */
export function profileCompletionMessage(percent: number): string {
  if (percent >= 100) return "All set!";
  if (percent >= 75) return "Keep going! You're almost there.";
  if (percent >= 40) return "Good progress! A few more details to add.";
  return "Let's get started. Every detail helps.";
}
