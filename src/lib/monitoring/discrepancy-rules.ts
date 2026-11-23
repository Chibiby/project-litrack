import {
  DISCREPANCY_KINDS,
  DISCREPANCY_LIST_LIMIT,
  type DiscrepancyItem,
  type DiscrepancyKind,
  type DiscrepancySummary,
} from "@/lib/monitoring/discrepancy-kinds";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

/**
 * Monitoring > Discrepancies — the pure rules. Facts in, groups out; no I/O,
 * so every rule is unit-tested on plain objects.
 */

export type PersonFact = { name: string; active: boolean } | null;

export type LearnerFact = {
  id: string;
  name: string;
  gradeLevelId: string;
  gradeLabel: string;
  /** Live section only; null when the learner has none or it was removed. */
  sectionId: string | null;
  sectionName: string | null;
  sectionGradeLevelId: string | null;
  sectionAdviserId: string | null;
  teacherId: string | null;
  teacher: PersonFact;
  isAralLearner: boolean;
  aralTeacherId: string | null;
  aralTeacher: PersonFact;
};

export type SectionFact = {
  id: string;
  name: string;
  gradeLabel: string;
  adviser: PersonFact;
};

export type EnrollmentFact = { learnerId: string; gradeLevelId: string; sectionId: string | null };

/**
 * One tutor's Weekly Attendance for one grade in one finished week: how many
 * distinct days they recorded for that grade's ARAL learners, and how many
 * days of that week were open for recording (`openAralDays`).
 */
export type AralWeekFact = {
  tutorId: string;
  tutorName: string;
  gradeLevelId: string;
  gradeLabel: string;
  /** Monday, local `YYYY-MM-DD`. */
  weekStartKey: string;
  recordedDays: number;
  openDays: number;
};

export type DiscrepancyFacts = {
  hasActiveYear: boolean;
  learners: LearnerFact[];
  sections: SectionFact[];
  enrollments: EnrollmentFact[];
  /** Finished weeks of the active school year; absent means none. */
  aralWeeks?: AralWeekFact[];
};

/** Weekly Attendance needs at least this many recorded days a week. */
export const ARAL_MIN_DAYS_PER_WEEK = 2;

/**
 * Days of the week starting `weekStartKey` (a Monday) on which a tutor could
 * record Weekly Attendance: Monday to Thursday (Friday is locked in the grid),
 * minus the grade's holidays and any day before the school year started.
 */
export function openAralDays(
  weekStartKey: string,
  ctx: { yearStartKey: string; holidayKeys: ReadonlySet<string> }
): number {
  const monday = parseLocalDateKey(weekStartKey);
  let open = 0;
  for (let i = 0; i < 4; i++) {
    const key = formatLocalDateKey(addDays(monday, i));
    if (key >= ctx.yearStartKey && !ctx.holidayKeys.has(key)) open++;
  }
  return open;
}

function weekLabel(weekStartKey: string): string {
  return `Week of ${parseLocalDateKey(weekStartKey).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function placement(l: LearnerFact): string {
  return l.sectionName ? `${l.gradeLabel} · ${l.sectionName}` : l.gradeLabel;
}

/** Which discrepancy kinds one learner has. Pure; order follows `DISCREPANCY_KINDS`. */
export function learnerDiscrepancies(
  l: LearnerFact,
  ctx: { hasActiveYear: boolean; enrollment: EnrollmentFact | undefined }
): DiscrepancyKind[] {
  const out: DiscrepancyKind[] = [];
  if (!l.teacherId) out.push("NO_ADVISER");
  if (!l.sectionId) out.push("NO_SECTION");
  if (l.teacherId && l.teacher && !l.teacher.active) out.push("INACTIVE_ADVISER");
  if (l.teacherId && l.sectionAdviserId && l.sectionAdviserId !== l.teacherId) {
    out.push("ADVISER_MISMATCH");
  }
  if (l.sectionGradeLevelId && l.sectionGradeLevelId !== l.gradeLevelId) {
    out.push("SECTION_GRADE_MISMATCH");
  }
  if (l.isAralLearner && (!l.aralTeacherId || !l.aralTeacher || !l.aralTeacher.active)) {
    out.push("ARAL_NO_TUTOR");
  }
  if (ctx.hasActiveYear) {
    if (!ctx.enrollment) out.push("NO_ENROLLMENT");
    else if (
      ctx.enrollment.gradeLevelId !== l.gradeLevelId ||
      (ctx.enrollment.sectionId ?? null) !== (l.sectionId ?? null)
    ) {
      out.push("ENROLLMENT_MISMATCH");
    }
  }
  return out;
}

function learnerItem(l: LearnerFact, kind: DiscrepancyKind): DiscrepancyItem {
  const who = kind === "ARAL_NO_TUTOR" ? l.aralTeacher : l.teacher;
  return { id: l.id, name: l.name, placement: placement(l), teacher: who?.name ?? null };
}

export function classifyDiscrepancies(facts: DiscrepancyFacts): DiscrepancySummary {
  const byLearner = new Map(facts.enrollments.map((e) => [e.learnerId, e]));
  const buckets = new Map<DiscrepancyKind, DiscrepancyItem[]>(
    DISCREPANCY_KINDS.map((k) => [k, []])
  );

  for (const l of facts.learners) {
    for (const kind of learnerDiscrepancies(l, {
      hasActiveYear: facts.hasActiveYear,
      enrollment: byLearner.get(l.id),
    })) {
      buckets.get(kind)!.push(learnerItem(l, kind));
    }
  }
  for (const s of facts.sections) {
    if (!s.adviser || !s.adviser.active) {
      buckets.get("SECTION_NO_ADVISER")!.push({
        id: s.id,
        name: s.name,
        placement: s.gradeLabel,
        teacher: s.adviser?.name ?? null,
      });
    }
  }

  // Exactly 1 day: a week with none is a missing week, which Teacher Tasks
  // already shows. Newest week first, then grade, then tutor.
  const thinWeeks = (facts.aralWeeks ?? [])
    .filter((w) => w.recordedDays === 1 && w.openDays >= ARAL_MIN_DAYS_PER_WEEK)
    .sort(
      (a, b) =>
        b.weekStartKey.localeCompare(a.weekStartKey) ||
        a.gradeLabel.localeCompare(b.gradeLabel) ||
        a.tutorName.localeCompare(b.tutorName)
    );
  for (const w of thinWeeks) {
    buckets.get("ARAL_WEEK_ONE_DAY")!.push({
      id: `${w.tutorId}|${w.gradeLevelId}|${w.weekStartKey}`,
      name: weekLabel(w.weekStartKey),
      placement: w.gradeLabel,
      teacher: w.tutorName,
    });
  }

  const groups = DISCREPANCY_KINDS.map((kind) => {
    const items = buckets.get(kind)!;
    return { kind, count: items.length, items: items.slice(0, DISCREPANCY_LIST_LIMIT) };
  });
  return {
    groups,
    total: groups.reduce((n, g) => n + g.count, 0),
    hasActiveYear: facts.hasActiveYear,
  };
}
