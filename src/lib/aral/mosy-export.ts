/**
 * MOSY Report page -> Excel/PDF: the pure layout layer.
 *
 * Turns what the page shows (stats plus every filtered row) into a
 * `ReportTable`, which `renderReport` (`src/lib/reports/render.ts`) draws in
 * the same DepEd template as every Reports Hub file. No Prisma runtime and no
 * `server-only`, so it is testable with hand-built fixtures; the action loads
 * the data and the frame.
 *
 * A `null` cell is the single "nothing to show" value: both renderers print it
 * blank, so no "-" placeholders here.
 */
import {
  MOSY_LEVEL_LANGUAGE_PREFIXES,
  MOSY_STATUS_LABELS,
  type MosyStatusFilter, type MosyStats } from "@/lib/aral/mosy";
import type { MosyExportRow } from "@/lib/aral/mosy-queries";
import { formatReportDate, type GradeSectionLine, type ReportFrame } from "@/lib/reports/report-frame";
import type { ReportBlock, ReportTable } from "@/lib/reports/render";

export const MOSY_EXPORT_TITLE = "MOSY Report — ARAL Learners (Middle of School Year)";

export type MosyExportInput = {
  /** School, school year and signatories (`loadReportFrame`). */
  frame: ReportFrame;
  /** The ARAL tutor the report is for (the signed-in teacher). */
  teacherName: string;
  /** The MOSY term window label, e.g. "November - January". */
  windowLabel: string;
  /** School-local day the report is stamped with (`schoolToday()`). */
  asOf: Date;
  filters: {
    q: string;
    status: MosyStatusFilter;
    /** `null` = all grades. */
    gradeLabel: string | null;
    /** `null` = all sections. */
    sectionLabel: string | null;
  };
  stats: MosyStats;
  rows: MosyExportRow[];
  /** Matching rows before the export cap. */
  totalCount: number;
  truncated: boolean;
};

/** "Fil: Low Emergent · Eng: Developing", or null when no BOSY level is set. */
function bosyLevelCell(row: MosyExportRow): string | null {
  const b = row.bosyLevel;
  if (!b) return null;
  const parts = [
    b.filipino ? `Fil: ${b.filipino}` : null,
    b.english ? `Eng: ${b.english}` : null,
  ].filter((s): s is string => s !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** "Fil: Low Emergent" (Kinder to G2) or "Eng: Developing" (G3 up); null when no level is saved. */
function mosyLevelCell(row: MosyExportRow): string | null {
  if (!row.mosyLevelLabel) return null;
  return `${MOSY_LEVEL_LANGUAGE_PREFIXES[row.mosyLanguage]}: ${row.mosyLevelLabel}`;
}

function gradeSectionCell(row: MosyExportRow): string {
  return row.sectionName ? `${row.gradeLabel} - ${row.sectionName}` : row.gradeLabel;
}

/** The Summary block and the learner listing, in that order. */
export function buildMosyExportBlocks(input: MosyExportInput): ReportBlock[] {
  const summary: ReportBlock = {
    heading: "Summary",
    sheetName: "Summary",
    columns: [
      { header: "Measure", width: 34 },
      { header: "Learners", width: 12 },
    ],
    rows: input.stats.cards.map((c) => [c.label, c.value]),
    note: "Counts cover every learner in your MOSY scope, whatever filters are applied to the list below.",
  };

  const learners: ReportBlock = {
    heading: "Learners",
    sheetName: "MOSY Learners",
    columns: [
      { header: "#", width: 4 },
      { header: "Learner name", width: 24 },
      { header: "Grade & section", width: 16 },
      { header: "BOSY reading level", width: 30 },
      { header: "MOSY reading level", width: 20 },
      { header: "ARAL status decision", width: 14 },
      { header: "Reason", width: 26 },
      { header: "Remarks", width: 30 },
    ],
    // Reason and remarks are free-form; wrap instead of clipping with "…".
    wrap: true,
    rows: input.rows.map((row, i) => [
      i + 1,
      row.listingName,
      gradeSectionCell(row),
      bosyLevelCell(row),
      mosyLevelCell(row),
      MOSY_STATUS_LABELS[row.status],
      row.reasonLabel,
      row.remarks,
    ]),
    freezeColumns: 2,
  };

  return [summary, learners];
}

/** "Grade & section: Grade 3 - A  |  ARAL status: For decision  |  Search: "cruz"". */
export function describeMosyFilters(filters: MosyExportInput["filters"]): string {
  const where = filters.gradeLabel
    ? `Grade & section: ${filters.gradeLabel}${filters.sectionLabel ? ` - ${filters.sectionLabel}` : ""}`
    : filters.sectionLabel
      ? `Grade & section: All grades - ${filters.sectionLabel}`
      : "Grade & section: All";
  const parts = [where, `ARAL status: ${MOSY_STATUS_LABELS[filters.status]}`];
  if (filters.q) parts.push(`Search: "${filters.q}"`);
  return parts.join("  |  ");
}

/** The whole report, ready for `renderReport(table, format, { purpose, generatedOn })`. */
export function buildMosyExportTable(input: MosyExportInput): ReportTable {
  const blocks = buildMosyExportBlocks(input);
  const learners = blocks[1]!;
  const { gradeLabel, sectionLabel } = input.filters;

  const gradeSection: GradeSectionLine = gradeLabel
    ? { gradeLevel: gradeLabel, section: sectionLabel }
    : { label: sectionLabel ? `Section: ${sectionLabel}` : "All Classes" };

  return {
    title: MOSY_EXPORT_TITLE,
    reportingPeriod: `MOSY window: ${input.windowLabel}`,
    gradeSection,
    summary: [
      `ARAL tutor: ${input.teacherName}`,
      `Filters applied: ${describeMosyFilters(input.filters)}`,
      `As of ${formatReportDate(input.asOf)}`,
      `${input.rows.length} learner(s) listed`,
      ...(input.truncated
        ? [
            `Only the first ${input.rows.length} of ${input.totalCount} matching learners are listed. Narrow the filters to export the rest.`,
          ]
        : []),
    ],
    frame: input.frame,
    // Mirrored like `buildMosyTable`, for anything still reading the flat pair.
    columns: learners.columns,
    rows: learners.rows,
    blocks,
  };
}
