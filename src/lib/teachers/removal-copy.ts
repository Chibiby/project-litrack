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
