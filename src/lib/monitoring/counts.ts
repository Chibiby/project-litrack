import type { DiscrepancyKind, DiscrepancySummary } from "@/lib/monitoring/discrepancy-kinds";
import type {
  TeacherTaskKind,
  TeacherTaskRow,
  TeacherTaskSummary,
} from "@/lib/teacher-tasks/types";

/**
 * The tasks a teacher owes as an ARAL teacher (tutor of ARAL learners). MOSY and
 * end-of-term sheets belong to the advisory class, so they are not here.
 */
export const ARAL_TASK_KINDS = ["ATTENDANCE", "READING_LEVEL", "ARAL_PROFILING"] as const satisfies readonly TeacherTaskKind[];

/** True when at least one ARAL task applies to the teacher — they tutor ARAL learners. */
export function isAralTeacherRow(row: TeacherTaskRow): boolean {
  return ARAL_TASK_KINDS.some((k) => row.tasks[k].state !== "NOT_APPLICABLE");
}

/** True when the teacher is behind on an ARAL task. */
export function hasPendingAralTask(row: TeacherTaskRow): boolean {
  return ARAL_TASK_KINDS.some((k) => row.tasks[k].state === "PENDING");
}

/**
 * The ARAL teachers only, each row narrowed to its ARAL tasks: `pendingKinds`
 * keeps ARAL kinds only, so filters and counts on the ARAL page read the same
 * way they do on Non-compliance.
 */
export function aralTeacherSummary(summary: TeacherTaskSummary): TeacherTaskSummary {
  const aralKinds: readonly TeacherTaskKind[] = ARAL_TASK_KINDS;
  const rows = summary.rows
    .filter(isAralTeacherRow)
    .map((row) => ({ ...row, pendingKinds: row.pendingKinds.filter((k) => aralKinds.includes(k)) }));
  const pendingByKind = { ...summary.pendingByKind };
  for (const k of Object.keys(pendingByKind) as TeacherTaskKind[]) {
    pendingByKind[k] = aralKinds.includes(k)
      ? rows.filter((r) => r.pendingKinds.includes(k)).length
      : 0;
  }
  return {
    ...summary,
    rows,
    teachersWithPending: rows.filter((r) => r.pendingKinds.length > 0).length,
    pendingByKind,
  };
}

export type MonitoringCounts = {
  teachers: number;
  teachersWithPending: number;
  aralTeachers: number;
  aralTeachersWithPending: number;
  pendingByKind: Record<TeacherTaskKind, number>;
  discrepancyTotal: number;
  discrepancyByKind: Record<DiscrepancyKind, number>;
};

/** The numbers the dashboard panel and the "Needs your attention" pop-up show. Pure. */
export function buildMonitoringCounts(
  tasks: TeacherTaskSummary,
  discrepancies: DiscrepancySummary
): MonitoringCounts {
  const aral = tasks.rows.filter(isAralTeacherRow);
  return {
    teachers: tasks.rows.length,
    teachersWithPending: tasks.teachersWithPending,
    aralTeachers: aral.length,
    aralTeachersWithPending: aral.filter(hasPendingAralTask).length,
    pendingByKind: tasks.pendingByKind,
    discrepancyTotal: discrepancies.total,
    discrepancyByKind: Object.fromEntries(
      discrepancies.groups.map((g) => [g.kind, g.count])
    ) as Record<DiscrepancyKind, number>,
  };
}
