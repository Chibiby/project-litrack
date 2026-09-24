import type { SummaryScope } from "@/lib/auth/admin-scope";
import type { ReportBlock, ReportTable } from "@/lib/reports/render";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { SUMMARY_LEVELS } from "@/lib/summary/types";
import type { FacetResult, ScopeSchool, SummaryLevel, SummarySection } from "@/lib/summary/types";

/**
 * Turning a facet result into the Reports hub's `ReportTable`, so the existing
 * Excel (Print / Records) and PDF renderers draw it (spec 3.6, Export).
 *
 * Long format — one row per (row, grade, bucket) — so any facet at any level
 * fits the same six columns, prints on A4, and sorts cleanly as Records.
 */

const LEVEL_COLUMN: Record<SummaryLevel, string> = {
  overall: "Scope",
  district: "District",
  school: "School",
};

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function distinct(values: readonly (string | null)[]): string[] {
  return [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))].sort();
}

/** "Alabel 1 and Alabel 2 districts (31 schools)", "Division-wide (339 schools)". */
export function scopeLabel(scope: SummaryScope, schools: readonly ScopeSchool[]): string {
  const count = `${schools.length} ${schools.length === 1 ? "school" : "schools"}`;
  if (scope.kind === "all") return `Division-wide (${count})`;
  if (scope.kind === "school") return schools[0]?.name ?? "School";
  const names = [...scope.districts].sort();
  return `${joinWords(names)} ${names.length === 1 ? "district" : "districts"} (${count})`;
}

/**
 * The report header for a multi-school scope. A single-school scope uses the
 * school's own `loadReportFrame` instead (the action decides).
 */
export function frameForScope(
  scope: SummaryScope,
  schools: readonly ScopeSchool[],
  opts: { schoolYearLabel: string; preparedBy: string }
): ReportFrame {
  const districts =
    scope.kind === "districts" ? [...scope.districts].sort() : distinct(schools.map((s) => s.district));
  return {
    schoolName: scopeLabel(scope, schools),
    schoolIdCode: "",
    region: distinct(schools.map((s) => s.region)).join("; "),
    division: distinct(schools.map((s) => s.division)).join("; "),
    district: scope.kind === "all" ? "" : districts.join(", "),
    address: "",
    schoolYearLabel: opts.schoolYearLabel,
    schoolHeadName: "",
    preparedBy: opts.preparedBy,
  };
}

function sectionBlock(section: SummarySection, level: SummaryLevel): ReportBlock {
  const withMean = section.kind === "average";
  const columns = [
    { header: LEVEL_COLUMN[level], width: 30 },
    ...(section.byGrade ? [{ header: "Grade", width: 12 }] : []),
    { header: "Category", width: 36 },
    { header: "Count", width: 9 },
    { header: "Base", width: 9 },
    { header: "%", width: 8 },
    ...(withMean ? [{ header: "Average", width: 9 }] : []),
  ];
  const rows: (string | number | null)[][] = [];
  for (const group of section.table.groups) {
    const gradeLabels = group.gradeType ? section.gradeBucketLabels?.[group.gradeType] : undefined;
    for (const bucket of section.buckets) {
      const cell = group.cells[bucket.id];
      if (!cell) continue;
      rows.push([
        group.label,
        ...(section.byGrade ? [group.gradeLabel ?? ""] : []),
        gradeLabels?.[bucket.id] ?? bucket.label,
        cell.count,
        cell.base,
        cell.pct,
        ...(withMean ? [cell.mean ?? null] : []),
      ]);
    }
  }
  return {
    heading: section.title,
    columns,
    rows,
    note: [section.baseLabel, section.note].filter(Boolean).join(". "),
  };
}

/** A facet result as a report table. Every facet's `toReportTable`. */
export function summaryReportTable(result: FacetResult, frame: ReportFrame): ReportTable {
  const level = (SUMMARY_LEVELS as readonly string[]).includes(result.level) ? result.level : "overall";
  const blocks: ReportBlock[] = result.sections.map((s) => sectionBlock(s, level));
  for (const list of result.lists) {
    blocks.push({
      heading: list.title,
      columns: list.columns.map((header) => ({ header, width: header === "School" ? 36 : 18 })),
      rows: list.rows,
      note: list.note,
    });
  }
  return {
    title: `${result.title} summary`,
    summary: [
      `${result.schoolCount} ${result.schoolCount === 1 ? "school" : "schools"}. Percentages are rounded to one decimal; a blank % means there was nothing to count.`,
      ...result.notes,
      ...result.gaps.map((g) => `Not available: ${g}`),
    ],
    reportingPeriod: result.subtitle,
    gradeSection: { label: frame.schoolName || "All schools" },
    columns: [],
    rows: [],
    blocks,
    frame,
  };
}
