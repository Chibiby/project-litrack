import "server-only";
import { prisma } from "@/lib/prisma";
import { revalidateDivisionSummary } from "@/lib/cache/revalidate";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { queryComplianceRows } from "@/lib/summary/queries/compliance";
import { planComplianceChanges, type StoredComplianceState } from "@/lib/compliance/plan";

export type ComplianceRecordOutcome = {
  todayKey: string;
  skipped: boolean;
  /** Schools checked (live and active). */
  checked: number;
  /** Schools seen for the first time. */
  created: number;
  /** Schools whose status changed (one event each). */
  changed: number;
};

const sameFlags = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((f, i) => f === b[i]);

/**
 * The daily compliance check behind the Full Compliance page. One run of the
 * division-wide compliance query, then the fewest writes that keep the state
 * table current: new schools in one `createMany`, unchanged ones in one
 * `updateMany`, and a single update only where a status or flag set changed.
 */
export async function recordComplianceChanges(
  todayKey: string = formatLocalDateKey(schoolToday())
): Promise<ComplianceRecordOutcome> {
  const [rows, schools, stateRows] = await Promise.all([
    queryComplianceRows(todayKey),
    prisma.school.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } }),
    prisma.schoolComplianceState.findMany({
      select: { schoolId: true, status: true, compliantSince: true, lastCheckedOn: true, flags: true },
    }),
  ]);
  const states: StoredComplianceState[] = stateRows;
  const plan = planComplianceChanges({
    rows,
    activeSchoolIds: new Set(schools.map((s) => s.id)),
    states,
    todayKey,
  });
  if (plan.skipped) {
    return { todayKey, skipped: true, checked: 0, created: 0, changed: 0 };
  }

  const stored = new Map(states.map((s) => [s.schoolId, s]));
  const creates = plan.upserts.filter((u) => !stored.has(u.schoolId));
  const touchOnly: string[] = [];
  const updates: StoredComplianceState[] = [];
  for (const u of plan.upserts) {
    const prev = stored.get(u.schoolId);
    if (!prev) continue;
    if (prev.status === u.status && sameFlags(prev.flags, u.flags)) touchOnly.push(u.schoolId);
    else updates.push(u);
  }

  await prisma.$transaction([
    prisma.schoolComplianceState.createMany({ data: creates, skipDuplicates: true }),
    prisma.schoolComplianceState.updateMany({
      where: { schoolId: { in: touchOnly } },
      data: { lastCheckedOn: todayKey },
    }),
    ...updates.map((u) =>
      prisma.schoolComplianceState.update({
        where: { schoolId: u.schoolId },
        data: { status: u.status, compliantSince: u.compliantSince, lastCheckedOn: u.lastCheckedOn, flags: u.flags },
      })
    ),
    prisma.schoolComplianceEvent.createMany({ data: plan.events }),
  ]);

  if (creates.length > 0 || plan.events.length > 0) revalidateDivisionSummary();
  return {
    todayKey,
    skipped: false,
    checked: plan.upserts.length,
    created: creates.length,
    changed: plan.events.length,
  };
}
