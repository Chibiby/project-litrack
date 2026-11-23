import type { MonitoringCounts } from "@/lib/monitoring/counts";

/**
 * The Monitoring rows of the School Head's "Needs your attention" list — the
 * dashboard panel and the pop-up read the same rows, so they never disagree.
 * Pure: hrefs come pre-resolved (a Super Admin's `?schoolId=` included).
 */

export type MonitoringAttentionHrefs = {
  nonCompliance: string;
  aral: string;
  discrepancies: string;
};

export type MonitoringAttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  badge: string;
  tone: "amber";
};

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildMonitoringAttention(
  counts: MonitoringCounts,
  hrefs: MonitoringAttentionHrefs
): MonitoringAttentionItem[] {
  const items: MonitoringAttentionItem[] = [];
  const d = counts.discrepancyByKind;

  if (counts.teachersWithPending > 0) {
    items.push({
      id: "monitoring:teachers",
      label: "Teachers with pending tasks",
      detail: `${n(counts.teachersWithPending, "teacher has", "teachers have")} not finished MOSY, reading level, attendance, profiling or end-of-term work`,
      href: hrefs.nonCompliance,
      badge: `${counts.teachersWithPending} of ${counts.teachers}`,
      tone: "amber",
    });
  }

  if (counts.aralTeachersWithPending > 0) {
    items.push({
      id: "monitoring:aral",
      label: "ARAL tutors with pending tasks",
      detail: `${n(counts.aralTeachersWithPending, "ARAL tutor is", "ARAL tutors are")} behind on attendance, reading level or profiling`,
      href: hrefs.aral,
      badge: `${counts.aralTeachersWithPending} of ${counts.aralTeachers}`,
      tone: "amber",
    });
  }

  const unplaced = (d.NO_ADVISER ?? 0) + (d.NO_SECTION ?? 0);
  if (unplaced > 0) {
    const parts = [
      d.NO_ADVISER ? n(d.NO_ADVISER, "learner has no adviser", "learners have no adviser") : null,
      d.NO_SECTION ? n(d.NO_SECTION, "learner has no section", "learners have no section") : null,
    ].filter(Boolean);
    items.push({
      id: "monitoring:unplaced",
      label: "Learners with no adviser or section",
      detail: parts.join(", "),
      href: `${hrefs.discrepancies}#NO_ADVISER`,
      badge: n(unplaced, "issue", "issues"),
      tone: "amber",
    });
  }

  if ((d.ARAL_NO_TUTOR ?? 0) > 0) {
    items.push({
      id: "monitoring:aral-no-tutor",
      label: "ARAL learners with no ARAL tutor",
      detail: "Nobody is recording their ARAL attendance or reading level",
      href: `${hrefs.discrepancies}#ARAL_NO_TUTOR`,
      badge: n(d.ARAL_NO_TUTOR, "learner", "learners"),
      tone: "amber",
    });
  }

  const other = counts.discrepancyTotal - unplaced - (d.ARAL_NO_TUTOR ?? 0);
  if (other > 0) {
    items.push({
      id: "monitoring:discrepancies",
      label: "Other record discrepancies",
      detail: "Inactive advisers, mismatched sections or enrollments, sections without an adviser",
      href: hrefs.discrepancies,
      badge: n(other, "issue", "issues"),
      tone: "amber",
    });
  }

  return items;
}
