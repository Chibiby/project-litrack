import type { ComplianceBaseStatus } from "@prisma/client";
import { complianceFacts, type RawComplianceRow } from "@/lib/summary/queries/compliance";
import { baseStatusOf } from "@/lib/summary/shape/full-compliance";

/**
 * What the daily compliance check writes, worked out in pure code
 * (docs/superpowers/specs/2026-11-24-full-compliance-design.md, "History").
 *
 * - A school with no stored state gets one, with no event: tracking begins
 *   today, so its streak starts today and it never reads as "newly" compliant
 *   just because the log is new.
 * - A school whose status did not change only moves `lastCheckedOn` (and its
 *   flags, which can change within one status).
 * - A changed status writes one event. `compliantSince` becomes today on
 *   entering COMPLIANT and null on leaving it.
 * - A second run on the same day writes nothing.
 */

export type StoredComplianceState = {
  schoolId: string;
  status: ComplianceBaseStatus;
  compliantSince: string | null;
  lastCheckedOn: string;
  flags: string[];
};

export type ComplianceEventInput = {
  schoolId: string;
  dateKey: string;
  fromStatus: ComplianceBaseStatus | null;
  toStatus: ComplianceBaseStatus;
  flags: string[];
};

export type CompliancePlan = {
  skipped: boolean;
  upserts: StoredComplianceState[];
  events: ComplianceEventInput[];
};

export function planComplianceChanges(args: {
  rows: readonly RawComplianceRow[];
  /** Live, active schools. Rows for any other school are ignored. */
  activeSchoolIds: ReadonlySet<string>;
  states: readonly StoredComplianceState[];
  todayKey: string;
}): CompliancePlan {
  const { todayKey } = args;
  const rows = args.rows.filter((r) => args.activeSchoolIds.has(r.school_id));
  const stored = new Map(args.states.map((s) => [s.schoolId, s]));

  if (rows.length > 0 && rows.every((r) => stored.get(r.school_id)?.lastCheckedOn === todayKey)) {
    return { skipped: true, upserts: [], events: [] };
  }

  const upserts: StoredComplianceState[] = [];
  const events: ComplianceEventInput[] = [];
  for (const r of rows) {
    const { base, flags } = baseStatusOf(complianceFacts(r, todayKey), r.sy_start !== null, todayKey);
    const prev = stored.get(r.school_id);
    if (!prev) {
      upserts.push({
        schoolId: r.school_id,
        status: base,
        compliantSince: base === "COMPLIANT" ? todayKey : null,
        lastCheckedOn: todayKey,
        flags,
      });
      continue;
    }
    if (prev.status === base) {
      upserts.push({ ...prev, lastCheckedOn: todayKey, flags });
      continue;
    }
    upserts.push({
      schoolId: r.school_id,
      status: base,
      compliantSince: base === "COMPLIANT" ? todayKey : null,
      lastCheckedOn: todayKey,
      flags,
    });
    events.push({ schoolId: r.school_id, dateKey: todayKey, fromStatus: prev.status, toStatus: base, flags });
  }
  return { skipped: false, upserts, events };
}
