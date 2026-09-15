/**
 * Pure shaping for the IP-learner and learners-per-adviser dashboard metrics.
 * No Prisma import: the aggregates module feeds `groupBy` rows in, tests feed
 * plain objects in.
 */
import { ETHNICITY_LABELS } from "@/lib/constants/enum-labels";
import { IP_ETHNICITIES, ipKindsOf, type IpEthnicity } from "@/lib/ip/ethnicity";

export const EMPTY_METRIC = "—";

/** numerator / denominator, or null when the denominator is zero. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** One-decimal average, "—" when undefined. */
export function formatAverage(numerator: number, denominator: number): string {
  const r = safeRatio(numerator, denominator);
  return r === null ? EMPTY_METRIC : r.toFixed(1);
}

/** One-decimal percent ("12.5%"), "—" when the total is zero. */
export function formatPercent(part: number, total: number): string {
  const r = safeRatio(part, total);
  return r === null ? EMPTY_METRIC : `${(r * 100).toFixed(1)}%`;
}

/** A `groupBy` row carrying both ethnicity slots and a count. */
export type EthnicityGroupRow = {
  ethnicity: string | null;
  secondaryEthnicity: string | null;
  _count: { _all: number };
};

/**
 * IP learner total and per-kind slice counts. A learner counts once toward the
 * total, and once per distinct IP ethnicity toward the slices.
 */
export function summarizeIpRows(rows: readonly EthnicityGroupRow[]): {
  ipCount: number;
  kinds: { key: IpEthnicity; name: string; value: number }[];
} {
  const byKind = new Map<IpEthnicity, number>();
  let ipCount = 0;
  for (const row of rows) {
    const kinds = ipKindsOf(row.ethnicity, row.secondaryEthnicity);
    if (kinds.length === 0) continue;
    ipCount += row._count._all;
    for (const k of kinds) byKind.set(k, (byKind.get(k) ?? 0) + row._count._all);
  }
  return {
    ipCount,
    kinds: IP_ETHNICITIES.map((key) => ({
      key,
      name: ETHNICITY_LABELS[key],
      value: byKind.get(key) ?? 0,
    })).filter((k) => k.value > 0),
  };
}

export type SchoolRow = { id: string; name: string };

export type AdminSchoolIpRow = {
  schoolId: string;
  name: string;
  totalLearners: number;
  ipLearners: number;
  ipPercent: string;
  activeTeachers: number;
  learnersPerTeacher: string;
};

/**
 * Joins per-school `groupBy` results into the admin table rows and the
 * national figures. Schools with no rows still appear, with zeros and "—".
 */
export function shapeAdminIpMetrics(input: {
  schools: readonly SchoolRow[];
  learnerTotals: readonly { schoolId: string; _count: { _all: number } }[];
  ipRows: readonly (EthnicityGroupRow & { schoolId: string })[];
  teacherTotals: readonly { schoolId: string | null; _count: { _all: number } }[];
}) {
  const known = new Set(input.schools.map((s) => s.id));
  const totals = new Map(input.learnerTotals.map((r) => [r.schoolId, r._count._all]));
  const teachers = new Map<string, number>();
  for (const r of input.teacherTotals) {
    if (r.schoolId) teachers.set(r.schoolId, r._count._all);
  }
  const ipBySchool = new Map<string, EthnicityGroupRow[]>();
  const nationalIpRows: EthnicityGroupRow[] = [];
  for (const r of input.ipRows) {
    if (!known.has(r.schoolId)) continue;
    const list = ipBySchool.get(r.schoolId) ?? [];
    list.push(r);
    ipBySchool.set(r.schoolId, list);
    nationalIpRows.push(r);
  }

  let totalLearners = 0;
  let totalTeachers = 0;
  const rows: AdminSchoolIpRow[] = input.schools.map((s) => {
    const learners = totals.get(s.id) ?? 0;
    const teach = teachers.get(s.id) ?? 0;
    const ip = summarizeIpRows(ipBySchool.get(s.id) ?? []).ipCount;
    totalLearners += learners;
    totalTeachers += teach;
    return {
      schoolId: s.id,
      name: s.name,
      totalLearners: learners,
      ipLearners: ip,
      ipPercent: formatPercent(ip, learners),
      activeTeachers: teach,
      learnersPerTeacher: formatAverage(learners, teach),
    };
  });

  const national = summarizeIpRows(nationalIpRows);
  return {
    schools: rows,
    national: {
      totalLearners,
      activeTeachers: totalTeachers,
      learnersPerTeacher: formatAverage(totalLearners, totalTeachers),
      ipLearners: national.ipCount,
      ipPercent: formatPercent(national.ipCount, totalLearners),
    },
    ipKinds: national.kinds.map(({ name, value }) => ({ name, value })),
  };
}

/**
 * Schools with at least one IP learner, sorted by count desc (name asc on a
 * tie), capped at `n`. Zero-IP schools are excluded rather than trailing
 * with "0" rows the dashboard has no use for.
 */
export function topSchoolsWithIp(
  rows: readonly AdminSchoolIpRow[],
  n: number
): AdminSchoolIpRow[] {
  return rows
    .filter((r) => r.ipLearners > 0)
    .sort((a, b) => b.ipLearners - a.ipLearners || a.name.localeCompare(b.name))
    .slice(0, n);
}

/**
 * Top `n` IP-kind slices by count, with the remainder folded into a single
 * "Others" slice (omitted when there is no remainder).
 */
export function collapseKindsToOthers(
  kinds: readonly { name: string; value: number }[],
  n: number
): { name: string; value: number }[] {
  const sorted = [...kinds].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  if (rest.length === 0) return top;
  const othersTotal = rest.reduce((sum, k) => sum + k.value, 0);
  return [...top, { name: "Others", value: othersTotal }];
}

export type SectionIpRow = {
  key: string;
  grade: string;
  section: string;
  totalLearners: number;
  ipLearners: number;
  ipPercent: string;
};

/** Shapes the School Head IP card: school totals, grade/section table, pie. */
export function shapeSchoolIpMetrics(input: {
  grades: readonly { id: string; type: string }[];
  sections: readonly { id: string; name: string }[];
  gradeLabels: Readonly<Record<string, string>>;
  totals: readonly {
    gradeLevelId: string;
    sectionId: string | null;
    _count: { _all: number };
  }[];
  ipRows: readonly (EthnicityGroupRow & {
    gradeLevelId: string;
    sectionId: string | null;
  })[];
  activeTeachers: number;
}) {
  const gradeOrder = new Map(input.grades.map((g, i) => [g.id, i]));
  const gradeName = new Map(
    input.grades.map((g) => [g.id, input.gradeLabels[g.type] ?? g.type])
  );
  const sectionName = new Map(input.sections.map((s) => [s.id, s.name]));
  const keyOf = (g: string, s: string | null) => `${g}:${s ?? ""}`;

  const ipByKey = new Map<string, EthnicityGroupRow[]>();
  for (const r of input.ipRows) {
    const k = keyOf(r.gradeLevelId, r.sectionId);
    const list = ipByKey.get(k) ?? [];
    list.push(r);
    ipByKey.set(k, list);
  }

  let totalLearners = 0;
  const rows: SectionIpRow[] = input.totals.map((t) => {
    const k = keyOf(t.gradeLevelId, t.sectionId);
    const ip = summarizeIpRows(ipByKey.get(k) ?? []).ipCount;
    totalLearners += t._count._all;
    return {
      key: k,
      grade: gradeName.get(t.gradeLevelId) ?? "Unknown grade",
      section: t.sectionId ? (sectionName.get(t.sectionId) ?? "Unknown section") : "No section",
      totalLearners: t._count._all,
      ipLearners: ip,
      ipPercent: formatPercent(ip, t._count._all),
    };
  });
  rows.sort((a, b) => {
    const ga = gradeOrder.get(a.key.split(":")[0]!) ?? Number.MAX_SAFE_INTEGER;
    const gb = gradeOrder.get(b.key.split(":")[0]!) ?? Number.MAX_SAFE_INTEGER;
    return ga - gb || a.section.localeCompare(b.section);
  });

  const summary = summarizeIpRows(input.ipRows);
  return {
    totalLearners,
    ipLearners: summary.ipCount,
    ipPercent: formatPercent(summary.ipCount, totalLearners),
    rows,
    ipKinds: summary.kinds.map(({ name, value }) => ({ name, value })),
    activeTeachers: input.activeTeachers,
    learnersPerTeacher: formatAverage(totalLearners, input.activeTeachers),
  };
}
