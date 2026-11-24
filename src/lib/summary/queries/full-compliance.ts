import "server-only";
import { formatSchoolDate } from "@/lib/format-datetime";
import type { ComplianceBaseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import type { ScopedRaw } from "@/lib/summary/scoped-raw";
import {
  complianceFacts,
  queryComplianceRows,
  type RawComplianceRow,
} from "@/lib/summary/queries/compliance";
import { COMPLIANCE_FLAG_LABELS, type ComplianceFlag } from "@/lib/summary/shape/compliance";
import {
  COMPLIANT_STATUSES,
  FULL_COMPLIANCE_STATUSES,
  FULL_COMPLIANCE_STATUS_DEFINITIONS,
  FULL_COMPLIANCE_STATUS_LABELS,
  baseStatusOf,
  daysBetweenKeys,
  displayStatus,
  streakDays,
} from "@/lib/summary/shape/full-compliance";
import { NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";
import type {
  FacetResult,
  FullComplianceSchool,
  FullComplianceView,
  ScopeSchool,
  SummaryLevel,
  SummaryList,
} from "@/lib/summary/types";

/**
 * Facet `full-compliance`: the other side of Non-compliance. The same SQL and
 * the same flags, plus each school's stored state (`compliantSince`) and its
 * last 90 days of status changes, merged into the raw rows BEFORE `scopeRaw`
 * so the scope fence covers them too.
 */

export type RawComplianceEvent = {
  dateKey: string;
  from: ComplianceBaseStatus | null;
  to: ComplianceBaseStatus;
  flags: string[];
};

export type RawFullComplianceRow = RawComplianceRow & {
  compliant_since: string | null;
  /** Local day this school's tracking began (its state row's creation), or null before the first check. */
  tracking_since: string | null;
  /** The last 90 days of changes, newest first. */
  events: RawComplianceEvent[];
};

export const HISTORY_DAYS = 90;
/** "Recently achieved" and "Lost compliance" look back this many days, today included. */
export const RECENT_DAYS = 7;
export const LEADERBOARD_SIZE = 10;

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export async function queryFullComplianceRows(todayKey: string): Promise<RawFullComplianceRow[]> {
  const [rows, states, events] = await Promise.all([
    queryComplianceRows(todayKey),
    prisma.schoolComplianceState.findMany({
      select: { schoolId: true, compliantSince: true, createdAt: true },
    }),
    prisma.schoolComplianceEvent.findMany({
      where: { dateKey: { gte: shiftKey(todayKey, -(HISTORY_DAYS - 1)) } },
      select: { schoolId: true, dateKey: true, fromStatus: true, toStatus: true, flags: true },
      orderBy: [{ dateKey: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const stateBySchool = new Map(states.map((s) => [s.schoolId, s]));
  const eventsBySchool = new Map<string, RawComplianceEvent[]>();
  for (const e of events) {
    const list = eventsBySchool.get(e.schoolId) ?? [];
    list.push({ dateKey: e.dateKey, from: e.fromStatus, to: e.toStatus, flags: e.flags });
    eventsBySchool.set(e.schoolId, list);
  }
  return rows.map((r) => {
    const state = stateBySchool.get(r.school_id);
    return {
      ...r,
      compliant_since: state?.compliantSince ?? null,
      tracking_since: state ? formatLocalDateKey(schoolToday(state.createdAt)) : null,
      events: eventsBySchool.get(r.school_id) ?? [],
    };
  });
}

const flagLabels = (flags: readonly string[]) =>
  flags.map((f) => COMPLIANCE_FLAG_LABELS[f as ComplianceFlag] ?? f);

export function shapeFullCompliance(args: {
  raw: ScopedRaw<RawFullComplianceRow>;
  /** Active schools in scope only. */
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  todayKey: string;
  computedAt: string;
}): FacetResult {
  const { schools, level, todayKey, computedAt } = args;
  const bySchool = new Map(args.raw.map((r) => [r.school_id, r]));
  const trackingKeys = args.raw.map((r) => r.tracking_since).filter((k): k is string => k !== null);
  const trackingSince = trackingKeys.length > 0 ? trackingKeys.reduce((a, b) => (a < b ? a : b)) : null;
  const recentFloor = shiftKey(todayKey, -(RECENT_DAYS - 1));

  const directory: FullComplianceSchool[] = [];
  for (const s of schools) {
    const r = bySchool.get(s.id);
    if (!r) continue;
    const facts = complianceFacts(r, todayKey);
    const { base, flags } = baseStatusOf(facts, r.sy_start !== null, todayKey);
    const status = displayStatus({
      base,
      compliantSince: r.compliant_since,
      trackingStart: trackingSince,
      facts,
      todayKey,
    });
    directory.push({
      schoolId: s.id,
      name: s.name,
      schoolIdCode: s.schoolIdCode,
      district: s.district ?? NO_DISTRICT_LABEL,
      status,
      flags: flagLabels(flags),
      streak: COMPLIANT_STATUSES.has(status) ? streakDays(r.compliant_since, todayKey) : null,
      history: r.events.map((e) => ({ dateKey: e.dateKey, from: e.from, to: e.to, flags: flagLabels(e.flags) })),
    });
  }
  const rank = (s: FullComplianceSchool) => FULL_COMPLIANCE_STATUSES.indexOf(s.status);
  directory.sort(
    (a, b) => rank(a) - rank(b) || (b.streak ?? -1) - (a.streak ?? -1) || a.name.localeCompare(b.name)
  );

  const isCompliant = (s: FullComplianceSchool) => COMPLIANT_STATUSES.has(s.status);
  const compliant = directory.filter(isCompliant);
  const total = directory.length;

  const byDistrict = new Map<string, { compliant: number; total: number }>();
  for (const s of directory) {
    const d = byDistrict.get(s.district) ?? { compliant: 0, total: 0 };
    d.total += 1;
    if (isCompliant(s)) d.compliant += 1;
    byDistrict.set(s.district, d);
  }
  const ranking = [...byDistrict]
    .map(([district, d]) => ({ district, ...d, pct: d.total ? Math.round((d.compliant / d.total) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total || a.district.localeCompare(b.district));

  // Events are newest first, so the first match per school is its latest.
  const recent: FullComplianceView["recent"] = [];
  const lost: FullComplianceView["lost"] = [];
  for (const s of directory) {
    const latest = s.history.find((e) => e.dateKey >= recentFloor);
    if (!latest) continue;
    if (latest.to === "COMPLIANT" && isCompliant(s)) recent.push({ school: s, dateKey: latest.dateKey });
    if (latest.from === "COMPLIANT" && latest.to === "NON_COMPLIANT" && s.status === "NON_COMPLIANT") {
      lost.push({ school: s, dateKey: latest.dateKey, flags: latest.flags });
    }
  }
  const byDateDesc = (a: { dateKey: string }, b: { dateKey: string }) => b.dateKey.localeCompare(a.dateKey);
  recent.sort(byDateDesc);
  lost.sort(byDateDesc);

  const withStreak = compliant.filter((s) => s.streak !== null);
  const leaderboard = [...withStreak]
    .sort((a, b) => b.streak! - a.streak! || a.name.localeCompare(b.name))
    .slice(0, LEADERBOARD_SIZE);
  const recognition = directory
    .filter((s) => s.status === "CONSISTENT")
    .sort((a, b) => (b.streak ?? 0) - (a.streak ?? 0) || a.name.localeCompare(b.name));

  const view: FullComplianceView = {
    cards: {
      total,
      compliant: compliant.length,
      consistent: recognition.length,
      ratePct: total ? Math.round((compliant.length / total) * 1000) / 10 : 0,
    },
    ranking,
    recent,
    lost,
    leaderboard,
    recognition,
    directory,
    trackingSince,
    todayKey,
  };

  const exportList: SummaryList = {
    id: "fullCompliance",
    title: "School compliance directory",
    note: "Status, streak and open flags for every active school in scope.",
    columns: ["School", "School ID", "District", "Status", "Streak (days)", "Flags"],
    rows: [...directory]
      .sort((a, b) => a.district.localeCompare(b.district) || a.name.localeCompare(b.name))
      .map((s) => [s.name, s.schoolIdCode, s.district, FULL_COMPLIANCE_STATUS_LABELS[s.status], s.streak, s.flags.join(", ")]),
  };
  const recognitionList: SummaryList = {
    id: "recognition",
    title: "Recognition: consistently compliant schools",
    note: FULL_COMPLIANCE_STATUS_DEFINITIONS.CONSISTENT,
    columns: ["School", "School ID", "District", "Streak (days)"],
    rows: recognition.map((s) => [s.name, s.schoolIdCode, s.district, s.streak]),
  };

  return {
    facetId: "full-compliance",
    title: "Full compliance",
    subtitle: "Active schools: complete, up to date and with no discrepancies",
    level,
    params: { level, today: todayKey },
    schoolCount: total,
    notes: [
      "A school is compliant when it has no flag on the Non-compliance page.",
      trackingSince
        ? `Streaks are counted from the daily check, which began on ${formatSchoolDate(`${trackingSince}T12:00:00+08:00`)}.`
        : "Streaks start with the first daily check, run each night at 00:05.",
    ],
    gaps: [],
    sections: [],
    lists: [recognitionList],
    exportList,
    fullCompliance: view,
    computedAt,
  };
}

/** For tests and callers that want the day difference with the same calendar rules. */
export { daysBetweenKeys };
