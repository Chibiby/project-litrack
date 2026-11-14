/**
 * What removing a teacher does to their advisory, in the words the School Head
 * will see afterwards — so the Remove confirmation says it before the click,
 * not after. Null when they advise nothing and hold no learners.
 *
 * Pure, so the copy is tested without rendering the client table it lives in.
 */
export function removalAdvisoryNote(row: {
  assignments: { gradeName: string; sectionName: string }[];
  learnerCount: number;
}): string | null {
  const sections = row.assignments
    .map((a) => `${a.gradeName} · ${a.sectionName}`)
    .join(", ");
  const parts: string[] = [];
  if (sections) parts.push(`${sections} will become Unassigned.`);
  if (row.learnerCount > 0) {
    parts.push(
      `${row.learnerCount} learner(s) will have no adviser until you assign one to their section.`
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The toast after a School Head deactivates a teacher. Says where the ARAL
 * learners went, and how many still need a tutor picked by hand.
 */
export function deactivatedToast(res: unknown): string {
  const data =
    res && typeof res === "object" && (res as { ok?: unknown }).ok === true
      ? ((res as { data?: { aralMoved?: number; aralKept?: number } }).data ?? {})
      : {};
  const moved = data.aralMoved ?? 0;
  const kept = data.aralKept ?? 0;
  const parts = ["Teacher deactivated."];
  if (moved > 0) {
    parts.push(`${moved} ARAL learner${moved === 1 ? "" : "s"} moved to their adviser.`);
  }
  if (kept > 0) {
    parts.push(
      `${kept} ARAL learner${kept === 1 ? " has" : "s have"} no adviser to take over. Assign an ARAL teacher on the Learners page.`
    );
  }
  return parts.length === 1 ? "Teacher deactivated" : parts.join(" ");
}
