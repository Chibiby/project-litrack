import { REMOVAL_WINDOW_DAYS, removalExpiresAt } from "@/lib/learners/removal";
import { formatSchoolDate } from "@/lib/format-datetime";

export type ArchiveTarget = {
  ids: string[];
  /** Set when exactly one learner is being removed. */
  name: string | null;
  /** How many of them are in ARAL. */
  aralCount: number;
};

/** Shared by every Remove confirm so the answer reads "Yes, remove" / "No". */
export const REMOVE_CANCEL_LABEL = "No";

const learnerCount = (n: number) => `${n} learner${n === 1 ? "" : "s"}`;

export function archiveConfirmTitle(t: ArchiveTarget): string {
  return t.name ? `Remove ${t.name}?` : `Remove ${learnerCount(t.ids.length)}?`;
}

export function archiveConfirmLabel(_t?: ArchiveTarget): string {
  return "Yes, remove";
}

// Removing leaves isAralLearner and the tutor untouched, but the ARAL weekly
// grids only list learners who are not removed, so they drop out of the grids until restored.
export function archiveConfirmDescription(t: ArchiveTarget): string {
  const who = t.name ?? (t.ids.length === 1 ? "The learner" : "They");
  const base = `${who} will move to Removed. You can restore them from Removed for ${REMOVAL_WINDOW_DAYS} days; after that they are deleted from your school's lists and only your division or district office can restore them.`;
  if (t.aralCount === 0) return base;
  const aral =
    t.ids.length === 1
      ? "This learner leaves the ARAL weekly grids while removed. Their ARAL enrollment and tutor are kept."
      : `${t.aralCount === t.ids.length ? "All of them are" : `${t.aralCount} of them ${t.aralCount === 1 ? "is" : "are"}`} in ARAL and leave the ARAL weekly grids while removed. Their ARAL enrollment and tutor are kept.`;
  return `${base} ${aral}`;
}

/** Shown on each row of the Removed view: when the learner is deleted for good from school lists. */
export function removalDeletionLabel(removedAt: string | Date): string {
  return `Deletes ${formatSchoolDate(removalExpiresAt(new Date(removedAt)))}`;
}
