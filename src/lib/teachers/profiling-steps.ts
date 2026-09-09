/**
 * Which steps the teacher profiling wizard shows, and how to walk them.
 *
 * A Non-DepEd ARAL Volunteer advises no section, so the Teaching Assignment
 * step is not theirs to answer — but every other step is, and the fields on
 * them are the same fields. So the step LIST is filtered while the step
 * NUMBERING is not: `step` stays a canonical index into
 * {@link TEACHER_PROFILING_STEPS} for everyone, and only the rail and the
 * Continue / Back walk skip what is hidden.
 *
 * That is the whole reason this module exists. `STEP_FIELDS`, `stepOfField`
 * and the per-step validation in the form are all keyed by canonical index; a
 * volunteer-specific renumbering would silently point them at the wrong step —
 * validating Teaching Assignment fields on the Training step, and jumping the
 * error summary to a step that is not on screen.
 *
 * Pure and React-free so the walk can be tested without rendering the wizard.
 */

export type TeacherStepId =
  | "respondent"
  | "professional"
  | "assignment"
  | "training"
  | "review";

export type TeacherStepDef = {
  id: TeacherStepId;
  /** Short label for the stepper rail. */
  shortLabel: string;
  /** Full section title shown on the card. */
  title: string;
};

/** Every step, in canonical order. Index here is the wizard's `step` value. */
export const TEACHER_PROFILING_STEPS: readonly TeacherStepDef[] = [
  { id: "respondent", shortLabel: "Respondent", title: "Respondent Information" },
  { id: "professional", shortLabel: "Background", title: "Professional Background" },
  { id: "assignment", shortLabel: "Assignment", title: "Teaching Assignment" },
  { id: "training", shortLabel: "Training", title: "Training & Professional Development" },
  { id: "review", shortLabel: "Review", title: "Review & Submit" },
] as const;

/** Steps a self-declared ARAL volunteer never answers. */
const VOLUNTEER_HIDDEN_STEPS: readonly TeacherStepId[] = ["assignment"] as const;

/** Canonical indexes this person actually sees, in order. */
export function visibleTeacherStepIndexes(isAralVolunteer: boolean): number[] {
  const indexes: number[] = [];
  TEACHER_PROFILING_STEPS.forEach((step, index) => {
    if (isAralVolunteer && VOLUNTEER_HIDDEN_STEPS.includes(step.id)) return;
    indexes.push(index);
  });
  return indexes;
}

/** The step definitions to hand the wizard chrome. */
export function visibleTeacherSteps(isAralVolunteer: boolean): TeacherStepDef[] {
  return visibleTeacherStepIndexes(isAralVolunteer).map(
    (index) => TEACHER_PROFILING_STEPS[index]
  );
}

/**
 * Where a canonical step sits in the visible rail — what the chrome's
 * `currentStep` wants.
 *
 * Falls back to 0 for a step this person never sees. A -1 would light no step
 * at all and read as a broken progress bar; the first step is a wrong but
 * legible answer to a question that should never be asked.
 */
export function visiblePositionOf(step: number, isAralVolunteer: boolean): number {
  const position = visibleTeacherStepIndexes(isAralVolunteer).indexOf(step);
  return position < 0 ? 0 : position;
}

/** The next visible step, or the same one when already at the end. */
export function nextTeacherStep(step: number, isAralVolunteer: boolean): number {
  const visible = visibleTeacherStepIndexes(isAralVolunteer);
  const position = visible.indexOf(step);
  if (position < 0 || position === visible.length - 1) return step;
  return visible[position + 1];
}

/** The previous visible step, or the same one when already at the start. */
export function previousTeacherStep(step: number, isAralVolunteer: boolean): number {
  const visible = visibleTeacherStepIndexes(isAralVolunteer);
  const position = visible.indexOf(step);
  if (position <= 0) return step;
  return visible[position - 1];
}

/** True on the review step — where Continue becomes Save. */
export function isLastTeacherStep(step: number, isAralVolunteer: boolean): boolean {
  const visible = visibleTeacherStepIndexes(isAralVolunteer);
  return visible.length > 0 && visible[visible.length - 1] === step;
}
