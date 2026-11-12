/**
 * Pure shaping for the Super Admin IP Learners page. No Prisma import: the
 * query module feeds `groupBy` rows in, tests feed plain objects in.
 *
 * Population: enrolled learners (an ACTIVE enrollment in an active school
 * year), the same population as the dashboard's enrolled figure, so the
 * shares here agree with every other "IP %" in the app.
 */
import { ETHNICITY_LABELS, GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { IP_ETHNICITIES, ipKindsOf, type IpEthnicity } from "@/lib/ip/ethnicity";
import { formatPercent } from "@/lib/dashboard/ip-metrics";

/** One IP `groupBy` row: every column the page breaks down by, plus a count. */
export type IpOverviewRow = {
  schoolId: string;
  gradeLevelId: string;
  gender: string | null;
  isAralLearner: boolean;
  ethnicity: string | null;
  secondaryEthnicity: string | null;
  _count: { _all: number };
};

export type IpOverviewSchool = { id: string; name: string; district: string | null };

export type IpSchoolRow = {
  schoolId: string;
  name: string;
  district: string;
  ipLearners: number;
  enrolled: number;
  ipPercent: string;
};

export type IpDistrictRow = {
  district: string;
  schoolsWithIp: number;
  ipLearners: number;
  enrolled: number;
  ipPercent: string;
};

export type IpOverview = {
  ipLearners: number;
  enrolled: number;
  ipPercent: string;
  /** Largest first; a learner with two IP groups counts in both. */
  groups: { key: IpEthnicity; name: string; count: number; share: string }[];
  /** Teaching order, then Floating, then Unassigned; only grades with IP learners. */
  byGrade: { grade: string; label: string; count: number }[];
  bySex: { male: number; female: number; unrecorded: number };
  inAral: number;
  schoolsWithIp: number;
  schoolsInScope: number;
  /** Districts with at least one IP learner, most IP learners first. */
  districts: IpDistrictRow[];
  /** Schools with at least one IP learner, most IP learners first. */
  schools: IpSchoolRow[];
};

export const NO_DISTRICT = "No district";

export function shapeIpOverview(input: {
  schools: readonly IpOverviewSchool[];
  enrolledBySchool: readonly { schoolId: string; _count: { _all: number } }[];
  ipRows: readonly IpOverviewRow[];
  /** gradeLevelId → grade type, for the ids that appear in `ipRows`. */
  gradeTypeById: ReadonlyMap<string, string>;
  /** Grade types in teaching order; anything else sorts after them. */
  gradeOrder: readonly string[];
}): IpOverview {
  const schoolById = new Map(input.schools.map((s) => [s.id, s]));
  const enrolledBy = new Map<string, number>();
  for (const r of input.enrolledBySchool) {
    if (schoolById.has(r.schoolId)) enrolledBy.set(r.schoolId, r._count._all);
  }

  let ipLearners = 0;
  let inAral = 0;
  const bySex = { male: 0, female: 0, unrecorded: 0 };
  const byKind = new Map<IpEthnicity, number>();
  const byGrade = new Map<string, number>();
  const ipBySchool = new Map<string, number>();

  for (const row of input.ipRows) {
    if (!schoolById.has(row.schoolId)) continue;
    const kinds = ipKindsOf(row.ethnicity, row.secondaryEthnicity);
    if (kinds.length === 0) continue;
    const n = row._count._all;
    ipLearners += n;
    if (row.isAralLearner) inAral += n;
    if (row.gender === "MALE") bySex.male += n;
    else if (row.gender === "FEMALE") bySex.female += n;
    else bySex.unrecorded += n;
    for (const k of kinds) byKind.set(k, (byKind.get(k) ?? 0) + n);
    const grade = input.gradeTypeById.get(row.gradeLevelId) ?? "UNASSIGNED";
    byGrade.set(grade, (byGrade.get(grade) ?? 0) + n);
    ipBySchool.set(row.schoolId, (ipBySchool.get(row.schoolId) ?? 0) + n);
  }

  const enrolled = [...enrolledBy.values()].reduce((a, b) => a + b, 0);
  const kindTotal = [...byKind.values()].reduce((a, b) => a + b, 0);

  const schools: IpSchoolRow[] = [...ipBySchool.entries()]
    .map(([schoolId, ip]) => {
      const s = schoolById.get(schoolId)!;
      const total = enrolledBy.get(schoolId) ?? 0;
      return {
        schoolId,
        name: s.name,
        district: s.district?.trim() || NO_DISTRICT,
        ipLearners: ip,
        enrolled: total,
        ipPercent: formatPercent(ip, total),
      };
    })
    .sort((a, b) => b.ipLearners - a.ipLearners || a.name.localeCompare(b.name));

  const districtEnrolled = new Map<string, number>();
  for (const s of input.schools) {
    const d = s.district?.trim() || NO_DISTRICT;
    districtEnrolled.set(d, (districtEnrolled.get(d) ?? 0) + (enrolledBy.get(s.id) ?? 0));
  }
  const districtIp = new Map<string, { ip: number; schools: number }>();
  for (const s of schools) {
    const cur = districtIp.get(s.district) ?? { ip: 0, schools: 0 };
    districtIp.set(s.district, { ip: cur.ip + s.ipLearners, schools: cur.schools + 1 });
  }
  const districts: IpDistrictRow[] = [...districtIp.entries()]
    .map(([district, v]) => {
      const total = districtEnrolled.get(district) ?? 0;
      return {
        district,
        schoolsWithIp: v.schools,
        ipLearners: v.ip,
        enrolled: total,
        ipPercent: formatPercent(v.ip, total),
      };
    })
    .sort((a, b) => b.ipLearners - a.ipLearners || a.district.localeCompare(b.district));

  const order = [...input.gradeOrder, "FLOATING", "UNASSIGNED"];
  const rank = (g: string) => {
    const i = order.indexOf(g);
    return i === -1 ? order.length : i;
  };

  return {
    ipLearners,
    enrolled,
    ipPercent: formatPercent(ipLearners, enrolled),
    groups: IP_ETHNICITIES.flatMap((key) => {
      const count = byKind.get(key) ?? 0;
      return count > 0
        ? [{ key, name: ETHNICITY_LABELS[key], count, share: formatPercent(count, kindTotal) }]
        : [];
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    byGrade: [...byGrade.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([grade, count]) => ({
        grade,
        label:
          grade === "UNASSIGNED"
            ? "Unassigned"
            : ((GRADE_LEVEL_LABELS as Record<string, string>)[grade] ?? grade),
        count,
      })),
    bySex,
    inAral,
    schoolsWithIp: schools.length,
    schoolsInScope: input.schools.length,
    districts,
    schools,
  };
}
