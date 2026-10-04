import type { RawCountRow } from "@/lib/summary/queries/population";
import type { RawAttendanceRow } from "@/lib/summary/queries/attendance";
import type { RawAralRow } from "@/lib/summary/queries/aral";
import type { RawComplianceRow } from "@/lib/summary/queries/compliance";
import type { RawTermRow } from "@/lib/summary/queries/end-of-term";
import type { RawProfilingRow } from "@/lib/summary/queries/profiling";
import type { RawReadingLevelRow } from "@/lib/summary/queries/reading-levels";
import type { DivisionSchool } from "@/lib/summary/scope-schools";
import type { SummaryFacetId } from "@/lib/summary/types";

/**
 * A small division for the summary fence tests: five live schools in two
 * districts plus one with no district, a demo school, and a deleted school
 * whose rows still come back from the (unscoped) SQL.
 *
 * Every school carries values no other school has (an age, a grade type, a
 * free-text designation, a subject name, a term, school-year labels), so a
 * test can tell whether one school's rows leaked into another scope.
 *
 * Raw rows are written as the SQL returns them, nulls included (every count is
 * `::int`, every date a `to_char` string), so a JSON round trip changes nothing.
 *
 * `divisionRaw(facet)` is what the new division-wide SQL returns;
 * `scopeReferenceRaw(facet, ids)` is what the per-scope SQL returned for those
 * schools alone (the "query run for that scope").
 */

type SchoolYear = { label: string; active: boolean };

type Profile = {
  /** Learner age only this school has. */
  age: string;
  /** Grade type only this school has (every school also has G3). */
  gt: string;
  /** Free-text designation only this school has. */
  designation: string;
  /** Subject name only this school has. */
  subject: string;
  /** The only term this school has grades in. */
  term: "FIRST" | "SECOND" | "THIRD";
  years: SchoolYear[];
  n: number;
};

export const DIVISION_SCHOOLS: DivisionSchool[] = [
  { id: "sch-alabel-ces", name: "Alabel Central ES", schoolIdCode: "130101", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: true, isDemo: false },
  { id: "sch-bagacay", name: "Bagacay ES", schoolIdCode: "130102", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: false, isDemo: false },
  { id: "sch-demo", name: "Demo Sample ES", schoolIdCode: "999901", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: true, isDemo: true },
  { id: "sch-glan-ces", name: "Glan Central ES", schoolIdCode: "130201", district: "Glan 1", division: "Sarangani", region: "XII", isActive: true, isDemo: false },
  { id: "sch-gumasa", name: "Gumasa ES", schoolIdCode: "130202", district: "Glan 1", division: "Sarangani", region: "XII", isActive: true, isDemo: false },
  { id: "sch-nodistrict", name: "Nodistrict ES", schoolIdCode: "130301", district: null, division: "Sarangani", region: "XII", isActive: true, isDemo: false },
];

/** Soft-deleted: not in the live list, but its rows are in the division raw. */
export const DELETED_SCHOOL = { id: "sch-deleted", name: "Deleted Old ES", schoolIdCode: "130999", district: "Glan 1" };

export const PROFILES: Record<string, Profile> = {
  "sch-alabel-ces": { age: "8", gt: "G2", designation: "Alabel Reading Coordinator", subject: "Alabel Sinugbuanon", term: "FIRST", n: 30,
    years: [{ label: "2026-2027", active: true }, { label: "2025-2026", active: false }] },
  "sch-bagacay": { age: "9", gt: "G1", designation: "Bagacay Feeding Focal", subject: "Bagacay Blaan", term: "FIRST", n: 12,
    years: [{ label: "2026-2027", active: true }] },
  "sch-demo": { age: "16", gt: "G7", designation: "Demo Sandbox Lead", subject: "Demo Robotics", term: "THIRD", n: 40,
    years: [{ label: "2026-2027", active: true }, { label: "2040-2041", active: true }] },
  "sch-glan-ces": { age: "11", gt: "G6", designation: "Glan Tboli Liaison", subject: "Glan Tboli Language", term: "SECOND", n: 25,
    years: [{ label: "2025-2026", active: true }, { label: "2031-2032", active: false }] },
  "sch-gumasa": { age: "12", gt: "G5", designation: "Gumasa Beach Warden", subject: "Gumasa Marine Science", term: "FIRST", n: 7,
    years: [{ label: "2025-2026", active: true }] },
  "sch-nodistrict": { age: "13", gt: "G4", designation: "Nodistrict Clerk Aide", subject: "Nodistrict Weaving", term: "FIRST", n: 5,
    years: [{ label: "2026-2027", active: true }] },
  "sch-deleted": { age: "17", gt: "G8", designation: "Deleted Archivist", subject: "Deleted Latin", term: "THIRD", n: 50,
    years: [{ label: "2026-2027", active: true }, { label: "2050-2051", active: false }] },
};

export const ALL_RAW_SCHOOL_IDS = Object.keys(PROFILES);

const p = (id: string) => PROFILES[id]!;
const gradeLevelId = (id: string) => `gl-${id}`;

// ---------------------------------------------------------------- per school

function learnerRows(id: string): RawCountRow[] {
  const { n, age, gt } = p(id);
  return [
    { school_id: id, gt: "G3", field: "population", bucket: "ALL", count: n },
    { school_id: id, gt, field: "population", bucket: "ALL", count: 2 },
    { school_id: id, gt: "G3", field: "age", bucket: "10", count: n - 3 },
    { school_id: id, gt: "G3", field: "age", bucket: age, count: 3 },
    { school_id: id, gt, field: "age", bucket: age, count: 2 },
    { school_id: id, gt: "G3", field: "gender", bucket: "FEMALE", count: Math.floor(n / 2) },
    { school_id: id, gt: "G3", field: "gender", bucket: "MALE", count: n - Math.floor(n / 2) },
    { school_id: id, gt: "G3", field: "englishProfile", bucket: null, count: 4 },
    { school_id: id, gt, field: "englishProfile", bucket: null, count: 2 },
    { school_id: id, gt: "G3", field: "filipinoProfile", bucket: "FRUSTRATION_HIGH_EMERGENT", count: 6 },
    { school_id: id, gt: "G3", field: "filipinoSubtype", bucket: "DECODING", count: 2 },
    { school_id: id, gt: "G3", field: "fourPs", bucket: "YES", count: 7 },
    { school_id: id, gt: null, field: "transport", bucket: "WALKING", count: 3 },
    { school_id: id, gt: null, field: "distance", bucket: null, count: 1 },
  ];
}

function readingBehaviorRows(id: string): RawCountRow[] {
  const { n, gt } = p(id);
  return [
    { school_id: id, gt: "G3", field: "population", bucket: "ALL", count: n },
    { school_id: id, gt, field: "population", bucket: "ALL", count: 2 },
    { school_id: id, gt: "G3", field: "wordRecognition", bucket: "NO_RECORD", count: 5 },
    { school_id: id, gt: "G3", field: "wordRecognition", bucket: "LEVEL_2", count: n - 5 },
    { school_id: id, gt, field: "comprehension", bucket: null, count: 2 },
  ];
}

function termGradeRows(id: string, labels: ReadonlySet<string>): RawTermRow[] {
  const { term, subject } = p(id);
  const out: RawTermRow[] = [];
  for (const { label } of p(id).years) {
    if (!labels.has(label)) continue;
    const base = { school_id: id, term, legacy_subject: null, label };
    out.push(
      { ...base, kind: "score", gt: "G3", legacy_area: "ENGLISH", subject_name: null, bucket: null, n: 20, total: 1640, n80: 14 },
      { ...base, kind: "score", gt: "G3", legacy_area: null, subject_name: subject, bucket: null, n: 10, total: 850, n80: 6 },
      { ...base, kind: "mark", gt: "G1", legacy_area: null, subject_name: "Reading", bucket: "ADVANCING", n: 9, total: 0, n80: 0 },
      { ...base, kind: "score", gt: "KINDER", legacy_area: "ENGLISH", subject_name: null, bucket: null, n: 3, total: 270, n80: 3 }
    );
  }
  return out;
}

function termLabelRows(id: string): RawTermRow[] {
  return p(id).years.map(({ label, active }) => ({
    kind: "label",
    school_id: id,
    gt: null,
    term: null,
    legacy_area: null,
    subject_name: null,
    legacy_subject: null,
    bucket: label,
    label,
    n: active ? 1 : 0,
    total: 0,
    n80: 0,
  }));
}

/** The labels the SQL fetches grades for when no label is requested: active in any of `ids`. */
function activeLabels(ids: readonly string[]): Set<string> {
  return new Set(ids.flatMap((id) => p(id).years.filter((y) => y.active).map((y) => y.label)));
}

function endOfTermRows(ids: readonly string[], requested: string | null): RawTermRow[] {
  const labels = requested !== null ? new Set([requested]) : activeLabels(ids);
  return ids.flatMap((id) => [...termLabelRows(id), ...termGradeRows(id, labels)]);
}

function attendanceRows(id: string): RawAttendanceRow[] {
  const { n } = p(id);
  const gl = gradeLevelId(id);
  if (id === "sch-bagacay") return []; // no ARAL learners
  const rows: RawAttendanceRow[] = [
    { kind: "roster", school_id: id, grade_level_id: gl, gt: "G3", week: null, n },
  ];
  if (id === "sch-nodistrict") return rows; // ARAL learners, nothing recorded
  rows.push({ kind: "marks", school_id: id, grade_level_id: null, gt: null, week: null, n: n * 4 });
  if (id === "sch-gumasa") return rows; // recorded, nobody present
  rows.push(
    { kind: "present", school_id: id, grade_level_id: gl, gt: null, week: "2026-09-07", n: n * 3 },
    { kind: "present", school_id: id, grade_level_id: gl, gt: null, week: "2026-09-14", n: n * 4 }
  );
  return rows;
}

/** `AttendanceDayMeta` is keyed by grade level: the SQL returns it with no school. */
function holidayRows(id: string): RawAttendanceRow[] {
  const weeks = id === "sch-glan-ces" ? ["2026-09-07", "2026-09-14"] : id === "sch-alabel-ces" ? ["2026-09-07"] : [];
  return weeks.map((week) => ({
    kind: "holiday" as const,
    school_id: null,
    grade_level_id: gradeLevelId(id),
    gt: null,
    week,
    n: 1,
  }));
}

function readingLevelRows(id: string): RawReadingLevelRow[] {
  const { n, gt } = p(id);
  return [
    { kind: "population", school_id: id, gt: "G3", month: null, lang: null, prev: null, val: null, n },
    { kind: "population", school_id: id, gt, month: null, lang: null, prev: null, val: null, n: 2 },
    { kind: "dist", school_id: id, gt: "G3", month: "2026-09", lang: "FILIPINO", prev: null, val: "DEVELOPING", n: 8 },
    { kind: "dist", school_id: id, gt, month: "2026-09", lang: "FILIPINO", prev: null, val: null, n: 1 },
    { kind: "move", school_id: id, gt: "G3", month: "2026-09", lang: "FILIPINO", prev: "EMERGING", val: "DEVELOPING", n: 3 },
  ];
}

function complianceRow(id: string, i: number): RawComplianceRow {
  const { n } = p(id);
  return {
    school_id: id,
    live: i === 1 ? 0 : n + 2,
    non_archived: i === 1 ? 0 : n,
    pending: i % 2,
    grades_no_adviser: i === 3 ? 2 : 0,
    aral: i === 4 ? 0 : n - 1,
    incomplete: i,
    enrollments: n,
    drift: i === 2 ? 1 : 0,
    last_attendance: i === 4 ? null : "2026-09-25",
    reading: i === 5 ? 0 : 3,
    last_week: i,
    has_admin: i % 3 !== 0,
  };
}

function profilingRows(id: string): RawProfilingRow[] {
  const { designation, n } = p(id);
  return [
    { school_id: id, who: "TEACHER", field: "accounts", bucket: "ALL", count: n },
    { school_id: id, who: "TEACHER", field: "population", bucket: "ALL", count: n - 1 },
    { school_id: id, who: "TEACHER", field: "designation", bucket: designation, count: 1 },
    { school_id: id, who: "TEACHER", field: "designation", bucket: "Teacher", count: n - 2 },
    { school_id: id, who: "TEACHER", field: "position", bucket: "TEACHER_I", count: n - 1 },
    { school_id: id, who: "TEACHER", field: "years", bucket: String(n % 30), count: n - 1 },
    { school_id: id, who: "SCHOOL_HEAD", field: "accounts", bucket: "ALL", count: 1 },
    { school_id: id, who: "SCHOOL_HEAD", field: "designation", bucket: null, count: 1 },
  ];
}

function aralRows(id: string): RawAralRow[] {
  const { n, gt, designation } = p(id);
  return [
    { school_id: id, field: "grade", bucket: "G3", employment_type: null, designation: null, count: n },
    { school_id: id, field: "grade", bucket: gt, employment_type: null, designation: null, count: 2 },
    { school_id: id, field: "tutor", bucket: null, employment_type: null, designation, count: 2 },
    { school_id: id, field: "tutor", bucket: null, employment_type: "NON_DEPED", designation: null, count: 1 },
  ];
}

// ------------------------------------------------------------- whole queries

type AnyRaw = { school_id: string | null; [column: string]: unknown };

function rowsFor(facet: SummaryFacetId, ids: readonly string[]): AnyRaw[] {
  switch (facet) {
    case "learners":
      return ids.flatMap(learnerRows);
    case "reading-behavior":
      return ids.flatMap(readingBehaviorRows);
    case "end-of-term":
      return endOfTermRows(ids, null);
    case "attendance":
      return ids.flatMap(attendanceRows);
    case "reading-levels":
      return ids.flatMap(readingLevelRows);
    case "compliance":
      return ids.map((id) => complianceRow(id, ALL_RAW_SCHOOL_IDS.indexOf(id)));
    case "profiling":
      return ids.flatMap(profilingRows);
    case "aral":
      return ids.flatMap(aralRows);
  }
}

/** Rows with no school the SQL could still emit (a learner or account with no school); must be dropped. */
function orphanRows(facet: SummaryFacetId): AnyRaw[] {
  const nul = null as unknown as string;
  switch (facet) {
    case "learners":
    case "reading-behavior":
      return [{ school_id: nul, gt: "G9", field: "population", bucket: "ALL", count: 99 } as RawCountRow];
    case "end-of-term":
      return [
        { kind: "label", school_id: null, gt: null, term: null, legacy_area: null, subject_name: null, legacy_subject: null, bucket: "2060-2061", label: "2060-2061", n: 50, total: 0, n80: 0 },
      ] satisfies RawTermRow[];
    case "attendance":
      return [
        { kind: "marks", school_id: null, grade_level_id: null, gt: null, week: null, n: 77 },
        // A holiday for a grade no kept roster has: dropped too.
        { kind: "holiday", school_id: null, grade_level_id: "gl-orphan", gt: null, week: "2026-09-07", n: 5 },
      ] satisfies RawAttendanceRow[];
    case "reading-levels":
      return [{ kind: "population", school_id: nul, gt: "G9", month: null, lang: null, prev: null, val: null, n: 99 } as RawReadingLevelRow];
    case "compliance":
      return [];
    case "profiling":
      return [{ school_id: nul, who: "TEACHER", field: "designation", bucket: "Orphan Designation", count: 9 } as RawProfilingRow];
    case "aral":
      return [{ school_id: nul, field: "grade", bucket: "G9", employment_type: null, designation: null, count: 9 } as RawAralRow];
  }
}

/** What the division-wide SQL returns: every school (deleted included), holidays, orphans. */
export function divisionRaw(facet: SummaryFacetId, requestedLabel: string | null = null): AnyRaw[] {
  const rows =
    facet === "end-of-term" ? endOfTermRows(ALL_RAW_SCHOOL_IDS, requestedLabel) : rowsFor(facet, ALL_RAW_SCHOOL_IDS);
  const holidays = facet === "attendance" ? ALL_RAW_SCHOOL_IDS.flatMap(holidayRows) : [];
  return [...rows, ...holidays, ...orphanRows(facet)];
}

/** What the old per-scope SQL returned for exactly these schools. */
export function scopeReferenceRaw(
  facet: SummaryFacetId,
  ids: readonly string[],
  requestedLabel: string | null = null
): AnyRaw[] {
  if (facet === "end-of-term") return endOfTermRows(ids, requestedLabel);
  const rows = rowsFor(facet, ids);
  if (facet !== "attendance") return rows;
  // Holidays only for grade levels in the scope's `pop`, i.e. its roster rows.
  const rostered = new Set(
    (rows as RawAttendanceRow[]).filter((r) => r.kind === "roster").map((r) => r.grade_level_id)
  );
  return [...rows, ...ids.flatMap(holidayRows).filter((h) => rostered.has(h.grade_level_id))];
}

/**
 * The old SQL's default school-year label for these schools:
 * `ORDER BY COUNT(*) DESC, sy."label" DESC LIMIT 1` over their active rows.
 */
export function oldDefaultLabel(ids: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) {
    for (const y of p(id).years) if (y.active) counts.set(y.label, (counts.get(y.label) ?? 0) + 1);
  }
  const ranked = [...counts].sort(([la, a], [lb, b]) => b - a || (la < lb ? 1 : la > lb ? -1 : 0));
  return ranked[0]?.[0] ?? null;
}

/** The old SQL's picker options: DISTINCT labels of these schools, `sort().reverse()`. */
export function oldLabelOptions(ids: readonly string[]): string[] {
  return [...new Set(ids.flatMap((id) => p(id).years.map((y) => y.label)))].sort().reverse();
}

/**
 * Strings only one school's rows carry: id, name, school ID code, district,
 * designation, subject, school-year labels. A leak test looks for the ones
 * that belong only to out-of-scope schools.
 */
export function schoolTokens(id: string): string[] {
  const s = DIVISION_SCHOOLS.find((x) => x.id === id) ?? DELETED_SCHOOL;
  const prof = p(id);
  return [
    s.id,
    s.name,
    s.schoolIdCode,
    ...(s.district ? [s.district] : []),
    prof.designation,
    prof.subject,
    ...prof.years.map((y) => y.label),
  ];
}
