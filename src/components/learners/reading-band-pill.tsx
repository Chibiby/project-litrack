import { cn } from "@/lib/utils";
import { readingProfileLabelsForGradeType } from "@/lib/constants/enum-labels";

/**
 * The four DepEd reading bands, rendered as the roster's soft tinted pills.
 *
 * DEVIATION FROM THE COMP — deliberate, and the only one on this surface.
 * The supplied comp tints "High Emergent" green and "Grade-level Ready" blue,
 * which puts the warmest colour on the second-weakest band and breaks the ramp.
 * On a reading-remediation product the level column is scanned precisely to
 * find learners who are behind, so a green pill on a struggling reader
 * misreports the thing the page exists to surface.
 *
 * The pill treatment the comp specifies is kept exactly — soft tint, full
 * radius, small semibold label. Only the hue assignment is ordered, weakest to
 * strongest: rose, amber, blue, emerald. To go back to the comp's literal
 * colours, this map is the only place to edit.
 */
const BAND_TONE: Record<string, string> = {
  NON_DECODER_LOW_EMERGENT:
    "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200",
  FRUSTRATION_HIGH_EMERGENT:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  INSTRUCTIONAL_DEVELOPING:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
  INDEPENDENT_GRADE_READY:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
};

const PILL_BASE =
  "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold";

/** Neutral fallback for an unrecognised band, so the cell never renders bare. */
const UNKNOWN_TONE = "bg-muted text-muted-foreground";

export function ReadingBandPill({
  profile,
  gradeType,
  className,
}: {
  profile: string;
  gradeType: string | null | undefined;
  className?: string;
}) {
  const labels = readingProfileLabelsForGradeType(gradeType);
  const label = labels[profile as keyof typeof labels] ?? profile;

  return (
    <span
      className={cn(PILL_BASE, BAND_TONE[profile] ?? UNKNOWN_TONE, className)}
    >
      {label}
    </span>
  );
}

/**
 * ARAL STATUS column — whether the learner has a saved AralProfile row.
 * Presence is the good state, so it carries the only colour; absence stays
 * neutral rather than reading as an error the teacher has done something wrong.
 */
export function AralProfilePill({ hasProfile }: { hasProfile: boolean }) {
  return (
    <span
      className={cn(
        PILL_BASE,
        hasProfile
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
          : "bg-muted text-muted-foreground"
      )}
    >
      {hasProfile ? "With Profile" : "No Profile"}
    </span>
  );
}

/** The violet ARAL designation chip that sits beside the learner's name. */
export function AralChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-violet-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-soft-foreground">
      ARAL
    </span>
  );
}
