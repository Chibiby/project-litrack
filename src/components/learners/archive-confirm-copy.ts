export type ArchiveTarget = {
  ids: string[];
  /** Set when exactly one learner is being archived. */
  name: string | null;
  /** How many of them are in ARAL. */
  aralCount: number;
};

const learnerCount = (n: number) => `${n} learner${n === 1 ? "" : "s"}`;

export function archiveConfirmTitle(t: ArchiveTarget): string {
  return t.name ? `Archive ${t.name}?` : `Archive ${learnerCount(t.ids.length)}?`;
}

export function archiveConfirmLabel(t: ArchiveTarget): string {
  return t.name ? "Archive learner" : `Archive ${learnerCount(t.ids.length)}`;
}

// Archiving leaves isAralLearner and the tutor untouched, but the ARAL weekly
// grids only list unarchived learners, so they drop out of the grids until restored.
export function archiveConfirmDescription(t: ArchiveTarget): string {
  const who = t.name ?? (t.ids.length === 1 ? "The learner" : "They");
  const base = `${who} will be hidden from active lists and can be restored from Archived Learners.`;
  if (t.aralCount === 0) return base;
  const aral =
    t.ids.length === 1
      ? "This learner leaves the ARAL weekly grids while archived. Their ARAL enrollment and tutor are kept."
      : `${t.aralCount === t.ids.length ? "All of them are" : `${t.aralCount} of them ${t.aralCount === 1 ? "is" : "are"}`} in ARAL and leave the ARAL weekly grids while archived. Their ARAL enrollment and tutor are kept.`;
  return `${base} ${aral}`;
}
