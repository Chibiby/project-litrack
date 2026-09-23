/**
 * Pure decision layer for the SF2-style ("Daily Attendance Report of
 * Learners") Excel/PDF layout: one block per month, MALE roster block then
 * FEMALE roster block (each alphabetical, surname-first — the caller already
 * sorts learners that way), a "TOTAL Per Day" row per sex, and a "COMBINED
 * TOTAL PER DAY" row. No Prisma, no I/O — `queries.ts` fetches and shapes the
 * cells, this module only decides how they lay out as `ReportBlock[]` for
 * `renderExcel`/`renderPdf` (`./render.ts`).
 *
 * `type` imports only from `./render` (which is `"use server"`) — an
 * `import type` is erased at compile time, so this module stays safely
 * importable from a plain Vitest file with no Prisma/session mocking, the
 * same pattern `./mosy.ts` already uses.
 */
import { parseLocalDateKey } from "@/lib/date-keys";
import type { ReportBlock } from "./render";

export type Sf2Sex = "MALE" | "FEMALE" | null;

export type Sf2Learner = {
  id: string;
  /** Already "Lastname, Firstname Middlename" — see `formatListingNameFromRecord`. */
  displayName: string;
  sex: Sf2Sex;
  gradeLabel: string;
  sectionLabel: string;
};

export type Sf2Status = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

/** `null` = no Attendance row at all for that learner on that day. */
export type Sf2CellLookup = (learnerId: string, dayKey: string) => Sf2Status | null;

const STATUS_CODE: Record<Sf2Status, string> = {
  PRESENT: "",
  ABSENT: "x",
  LATE: "L",
  EXCUSED: "E",
};

// `Date#getDay()`: 0 Sun .. 6 Sat.
const WEEKDAY_LETTER: Record<number, string> = { 1: "M", 2: "T", 3: "W", 4: "TH", 5: "F" };

/** "23-M" for a Monday the 23rd — the day-of-month plus its SF2 weekday letter. */
export function sf2DayHeader(dayKey: string): string {
  const d = parseLocalDateKey(dayKey);
  const letter = WEEKDAY_LETTER[d.getDay()] ?? "";
  return `${d.getDate()}${letter ? `-${letter}` : ""}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "August 2026" from any day key in that month. */
export function sf2MonthLabel(dayKey: string): string {
  const d = parseLocalDateKey(dayKey);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Groups sorted day keys by their local `YYYY-MM` prefix, preserving order —
 * each group becomes one SF2 sheet (one calendar month).
 */
export function groupDayKeysByMonth(dayKeys: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const key of dayKeys) {
    const monthKey = key.slice(0, 7);
    const list = map.get(monthKey);
    if (list) list.push(key);
    else map.set(monthKey, [key]);
  }
  return map;
}

function sexLabel(sex: Sf2Sex): "MALE" | "FEMALE" | "NOT SPECIFIED" {
  return sex === "MALE" ? "MALE" : sex === "FEMALE" ? "FEMALE" : "NOT SPECIFIED";
}

/** Splits a roster into MALE / FEMALE / unspecified groups, order preserved within each. */
export function groupBySex(learners: Sf2Learner[]): { sex: Sf2Sex; group: Sf2Learner[] }[] {
  const male = learners.filter((l) => l.sex === "MALE");
  const female = learners.filter((l) => l.sex === "FEMALE");
  const unspecified = learners.filter((l) => l.sex !== "MALE" && l.sex !== "FEMALE");
  const groups: { sex: Sf2Sex; group: Sf2Learner[] }[] = [
    { sex: "MALE", group: male },
    { sex: "FEMALE", group: female },
  ];
  // Only a real third block when someone actually has no recorded sex — an
  // all-Male-and-Female roster (the ordinary case) never grows a phantom
  // empty block.
  if (unspecified.length > 0) groups.push({ sex: null, group: unspecified });
  return groups;
}

export type Sf2MonthBlockArgs = {
  /** Already scoped/ordered (alphabetical, surname-first) roster for the report. */
  learners: Sf2Learner[];
  /** All day keys in this ONE month, ascending, already cap-filtered by the caller. */
  dayKeys: string[];
  cellFor: Sf2CellLookup;
  /** False when a single section is already the report's own filter — Grade/Section columns are then redundant. */
  includeGradeSection: boolean;
};

/**
 * Builds ONE SF2 month sheet: `#`, `Learner`, optionally `Grade`/`Section`,
 * one column per school day (header "23-M"), then `ABSENT`/`TARDY` totals —
 * MALE roster + "MALE | TOTAL Per Day", FEMALE roster + "FEMALE | TOTAL Per
 * Day", (an unspecified-sex block only if any learner needs it), then
 * "COMBINED TOTAL PER DAY". `shadedCells` marks a day with no Attendance row
 * at all (as opposed to a recorded Present, which is also a blank cell) so
 * `renderExcel`/`renderPdf` can grey it visually.
 */
export function buildSf2MonthBlock(args: Sf2MonthBlockArgs): ReportBlock {
  const { learners, dayKeys, cellFor, includeGradeSection } = args;

  const columns: { header: string; width?: number }[] = [
    { header: "#", width: 5 },
    { header: "Learner", width: 26 },
    ...(includeGradeSection
      ? [{ header: "Grade", width: 10 }, { header: "Section", width: 12 }]
      : []),
    ...dayKeys.map((d) => ({ header: sf2DayHeader(d), width: 5 })),
    { header: "ABSENT", width: 9 },
    { header: "TARDY", width: 9 },
  ];
  const dayColStart = includeGradeSection ? 4 : 2;

  const rows: (string | number | null)[][] = [];
  const shadedCells: boolean[][] = [];
  const boldRowIndices: number[] = [];

  const groups = groupBySex(learners);
  let seq = 0;

  for (const { sex, group } of groups) {
    if (group.length === 0 && sex !== null) {
      // Still print an empty MALE/FEMALE block's total row (0 for every day)
      // rather than silently omitting the sex entirely — a school with an
      // all-female section still shows "MALE | TOTAL Per Day" as zeroes, so
      // the sheet's shape never depends on this month's actual roster mix.
    }
    for (const learner of group) {
      seq += 1;
      const shadedRow: boolean[] = new Array(columns.length).fill(false);
      let absent = 0;
      let tardy = 0;
      const dayCells = dayKeys.map((dayKey, i) => {
        const status = cellFor(learner.id, dayKey);
        if (status === null) {
          shadedRow[dayColStart + i] = true;
          return "";
        }
        if (status === "ABSENT") absent += 1;
        if (status === "LATE") tardy += 1;
        return STATUS_CODE[status];
      });
      rows.push([
        seq,
        learner.displayName,
        ...(includeGradeSection ? [learner.gradeLabel, learner.sectionLabel] : []),
        ...dayCells,
        absent,
        tardy,
      ]);
      shadedCells.push(shadedRow);
    }

    if (sex !== null) {
      const totalRow: (string | number | null)[] = [
        null,
        `${sexLabel(sex)} | TOTAL Per Day`,
        ...(includeGradeSection ? [null, null] : []),
        ...dayKeys.map((dayKey) => group.filter((l) => {
          const status = cellFor(l.id, dayKey);
          return status === "PRESENT" || status === "LATE";
        }).length),
        null,
        null,
      ];
      boldRowIndices.push(rows.length);
      rows.push(totalRow);
      shadedCells.push(new Array(columns.length).fill(false));
    }
  }

  const combinedRow: (string | number | null)[] = [
    null,
    "COMBINED TOTAL PER DAY",
    ...(includeGradeSection ? [null, null] : []),
    ...dayKeys.map((dayKey) => learners.filter((l) => {
      const status = cellFor(l.id, dayKey);
      return status === "PRESENT" || status === "LATE";
    }).length),
    null,
    null,
  ];
  boldRowIndices.push(rows.length);
  rows.push(combinedRow);
  shadedCells.push(new Array(columns.length).fill(false));

  const enrolment = learners.length;
  const schoolDays = dayKeys.length;
  let totalPresent = 0;
  for (const l of learners) {
    for (const dayKey of dayKeys) {
      const status = cellFor(l.id, dayKey);
      if (status === "PRESENT" || status === "LATE") totalPresent += 1;
    }
  }
  const totalPossible = enrolment * schoolDays;
  const ada = schoolDays > 0 ? (totalPresent / schoolDays).toFixed(1) : "—";
  const pctAttendance =
    totalPossible > 0 ? `${Math.round((totalPresent / totalPossible) * 100)}%` : "—";

  const note =
    `Legend: blank = present, x = absent, L = tardy, E = excused; shaded = no attendance record for that day. ` +
    `School days: ${schoolDays} | Enrolment: ${enrolment} | Average Daily Attendance: ${ada} | Percentage of Attendance: ${pctAttendance}`;

  const monthLabel = dayKeys[0] ? sf2MonthLabel(dayKeys[0]) : "No school days";

  return {
    heading: `Daily Attendance Report of Learners — ${monthLabel}`,
    sheetName: monthLabel.slice(0, 31),
    columns,
    rows,
    note,
    freezeColumns: dayColStart,
    boldRowIndices,
    shadedCells,
  };
}

/** One `buildSf2MonthBlock` per calendar month touched by `dayKeys`, in order. */
export function buildSf2Blocks(args: {
  learners: Sf2Learner[];
  dayKeys: string[];
  cellFor: Sf2CellLookup;
  includeGradeSection: boolean;
}): ReportBlock[] {
  const monthGroups = groupDayKeysByMonth(args.dayKeys);
  return [...monthGroups.values()].map((monthDayKeys) =>
    buildSf2MonthBlock({
      learners: args.learners,
      dayKeys: monthDayKeys,
      cellFor: args.cellFor,
      includeGradeSection: args.includeGradeSection,
    })
  );
}
