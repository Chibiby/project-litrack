import type { SummaryScope } from "@/lib/auth/admin-scope";
import type { ReportBlock, ReportTable } from "@/lib/reports/render";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { SUMMARY_LEVELS } from "@/lib/summary/types";
import type { FacetResult, ScopeSchool, SummaryLevel, SummaryList, SummarySection } from "@/lib/summary/types";

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

/**
 * Non-compliance's `toReportTable`. When the result carries an `exportList`
 * (school level) it replaces the Category/Count block, so each flagged school
 * prints once with its Remarks; otherwise it is the default table.
 */
export function complianceReportTable(result: FacetResult, frame: ReportFrame): ReportTable {
  const list = result.exportList;
  if (!list) return summaryReportTable(result, frame);
  const table = summaryReportTable(
    { ...result, sections: result.sections.filter((s) => s.id !== "flags") },
    frame
  );
  const block: ReportBlock = {
    heading: list.title,
    columns: list.columns.map((header) => ({
      header,
      width: header === "School" ? 36 : header === "Remarks" ? 60 : header === "Non-compliance" ? 30 : 18,
    })),
    rows: list.rows,
    note: list.note,
    wrap: true,
  };
  return { ...table, blocks: [block, ...(table.blocks ?? [])] };
}

const MAX_PDF_PART_COLUMNS = 14;

/**
 * PDF-only split of a wide export list: one "Overall" part (lead + overall
 * columns), then parts of whole grade groups, each led by the name column and
 * at most MAX_PDF_PART_COLUMNS wide. Empty when the list is narrow or has no
 * grade groups.
 */
function pdfPartsFor(list: SummaryList): { pdfParts?: { heading?: string; columns: number[] }[] } {
  const groups = list.groups;
  if (list.columns.length <= MAX_PDF_PART_COLUMNS || !groups || groups.length === 0) return {};
  const firstGrade = Math.min(...groups.map((g) => g.start));
  const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);
  const parts: { heading?: string; columns: number[] }[] = [
    { heading: "Overall", columns: range(0, firstGrade) },
  ];
  let current: typeof groups = [];
  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!.label;
    const last = current[current.length - 1]!.label;
    parts.push({
      heading: current.length === 1 ? first : `${first} to ${last}`,
      columns: [0, ...current.flatMap((g) => range(g.start, g.count))],
    });
    current = [];
  };
  for (const g of groups) {
    const used = 1 + current.reduce((n, x) => n + x.count, 0);
    if (current.length > 0 && used + g.count > MAX_PDF_PART_COLUMNS) flush();
    current.push(g);
  }
  flush();
  return { pdfParts: parts };
}

/**
 * ARAL teachers' export blocks. Each grade group in the list is three columns
 * (ARAL teachers, DepEd, Non-DepEd), after the lead columns and the overall
 * figures.
 *
 * - PDF: the overall figures, then one ARAL-teacher total per grade level.
 * - Excel: four sheets — Overall, Total per grade level, DepEd, Non-DepEd.
 */
function aralTeacherBlocks(list: SummaryList, level: SummaryLevel, boldLast: boolean): ReportBlock[] | null {
  const groups = list.groups;
  if (!groups || groups.length === 0) return null;
  const leadCount = level === "school" ? 3 : 1;
  const firstGrade = Math.min(...groups.map((g) => g.start));
  const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);
  const width = (header: string, i: number) => (i === 0 ? 36 : header === "District" ? 18 : 11);
  const bold = boldLast ? { boldRowIndices: [list.rows.length - 1] } : {};

  const pick = (
    cols: number[],
    headers: string[],
    extra: Partial<ReportBlock>
  ): ReportBlock => ({
    columns: headers.map((header, i) => ({ header, width: width(header, i) })),
    rows: list.rows.map((row) => cols.map((c) => row[c] ?? null)),
    freezeColumns: 1,
    ...bold,
    ...extra,
  });

  const lead = range(0, leadCount);
  const leadHeaders = lead.map((c) => list.columns[c]!);
  const perGrade = (offset: number, sheetName: string, heading: string): ReportBlock =>
    pick(
      [...lead, ...groups.map((g) => g.start + offset)],
      [...leadHeaders, ...groups.map((g) => g.label)],
      { heading, sheetName, formats: ["excel"] }
    );

  const overallCols = range(0, firstGrade);
  const overall = pick(overallCols, overallCols.map((c) => list.columns[c]!), {
    heading: "Overall",
    sheetName: "Overall",
    note: list.note,
  });

  // PDF: the name column and one total per grade, split into readable parts.
  const pdfGradeCols = [0, ...groups.map((g) => g.start)];
  const pdfGrades = pick(pdfGradeCols, [list.columns[0]!, ...groups.map((g) => g.label)], {
    heading: "ARAL teachers per grade level",
    formats: ["pdf"],
  });
  if (pdfGradeCols.length > MAX_PDF_PART_COLUMNS) {
    const parts: { heading?: string; columns: number[] }[] = [];
    const per = MAX_PDF_PART_COLUMNS - 1;
    for (let i = 0; i < groups.length; i += per) {
      const slice = groups.slice(i, i + per);
      parts.push({
        heading: slice.length === 1 ? slice[0]!.label : `${slice[0]!.label} to ${slice[slice.length - 1]!.label}`,
        columns: [0, ...slice.map((_, j) => 1 + i + j)],
      });
    }
    pdfGrades.pdfParts = parts;
  }

  return [
    overall,
    pdfGrades,
    perGrade(0, "Total per grade level", "ARAL teachers per grade level"),
    perGrade(1, "DepEd", "DepEd ARAL teachers per grade level"),
    perGrade(2, "Non-DepEd", "Non-DepEd ARAL teachers per grade level"),
  ];
}

/**
 * ARAL learners' and ARAL teachers' and Advisory's `toReportTable`: the result's `exportList`
 * (one row per school, district or scope, counts before percentages) replaces
 * the Category/Count blocks, at every level.
 */
export function exportListReportTable(result: FacetResult, frame: ReportFrame): ReportTable {
  const list = result.exportList;
  const table = summaryReportTable(result, frame);
  if (!list) return table;
  const boldLast = list.rows.at(-1)?.[0] === "Total" && result.level !== "overall";
  const teacherBlocks =
    result.facetId === "aral-teachers" ? aralTeacherBlocks(list, result.level, boldLast) : null;
  if (teacherBlocks) return { ...table, blocks: teacherBlocks };
  // No heading: the report title already names the facet.
  const block: ReportBlock = {
    columns: list.columns.map((header, i) => ({ header, width: i === 0 ? 36 : header === "District" ? 18 : 11 })),
    rows: list.rows,
    note: list.note,
    // The Total row, when the list has one, is always last.
    ...(list.rows.at(-1)?.[0] === "Total" && result.level !== "overall"
      ? { boldRowIndices: [list.rows.length - 1] }
      : {}),
    freezeColumns: 1,
    ...pdfPartsFor(list),
  };
  // A counts-only list has no % column, so the rounding note would describe nothing.
  const hasPct = list.columns.some((c) => c.includes("%"));
  const summary = hasPct
    ? table.summary
    : [`${result.schoolCount} ${result.schoolCount === 1 ? "school" : "schools"}.`, ...(table.summary ?? []).slice(1)];
  return { ...table, summary, blocks: [block] };
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
      // Reason columns ("Why") run long; wrap them instead of cutting them off.
      wrap: true,
    });
  }
  return {
    title: `${result.title} summary`,
    summary: [
      // No sections means no % columns, so the rounding note would describe nothing.
      result.sections.length > 0
        ? `${result.schoolCount} ${result.schoolCount === 1 ? "school" : "schools"}. Percentages are rounded to one decimal; a blank % means there was nothing to count.`
        : `${result.schoolCount} ${result.schoolCount === 1 ? "school" : "schools"}.`,
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
