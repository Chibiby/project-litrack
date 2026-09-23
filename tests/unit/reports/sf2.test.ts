import { describe, expect, it } from "vitest";
import {
  buildSf2Blocks,
  buildSf2MonthBlock,
  groupDayKeysByMonth,
  sf2DayHeader,
  sf2MonthLabel,
  type Sf2Learner,
  type Sf2Status,
} from "@/lib/reports/sf2";

/**
 * `buildSf2MonthBlock`/`buildSf2Blocks` (`src/lib/reports/sf2.ts`) — pure
 * decision layer for the SF2 ("Daily Attendance Report of Learners") Excel/
 * PDF layout. No Prisma, no I/O; every fixture here is hand-built.
 */

const MALE_1: Sf2Learner = {
  id: "m1",
  displayName: "Abad, Ben",
  sex: "MALE",
  gradeLabel: "Grade 3",
  sectionLabel: "A",
};
const MALE_2: Sf2Learner = {
  id: "m2",
  displayName: "Cruz, Carlo",
  sex: "MALE",
  gradeLabel: "Grade 3",
  sectionLabel: "A",
};
const FEMALE_1: Sf2Learner = {
  id: "f1",
  displayName: "Dela Cruz, Diana",
  sex: "FEMALE",
  gradeLabel: "Grade 3",
  sectionLabel: "A",
};

describe("sf2DayHeader", () => {
  it("formats a weekday as day-of-month + SF2 letter", () => {
    // 2026-08-24 is a Monday.
    expect(sf2DayHeader("2026-08-24")).toBe("24-M");
    // 2026-08-27 is a Thursday.
    expect(sf2DayHeader("2026-08-27")).toBe("27-TH");
  });
});

describe("sf2MonthLabel / groupDayKeysByMonth", () => {
  it("labels a month from any day key inside it", () => {
    expect(sf2MonthLabel("2026-08-15")).toBe("August 2026");
  });

  it("groups day keys by their local YYYY-MM prefix, across a month boundary", () => {
    const groups = groupDayKeysByMonth(["2026-08-31", "2026-09-01", "2026-09-02"]);
    expect([...groups.keys()]).toEqual(["2026-08", "2026-09"]);
    expect(groups.get("2026-08")).toEqual(["2026-08-31"]);
    expect(groups.get("2026-09")).toEqual(["2026-09-01", "2026-09-02"]);
  });
});

describe("buildSf2MonthBlock — MALE then FEMALE blocks", () => {
  it("lists MALE learners first, then FEMALE, each in the order given", () => {
    const cellFor = (): Sf2Status | null => "PRESENT";
    const block = buildSf2MonthBlock({
      learners: [MALE_1, MALE_2, FEMALE_1],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });

    // Row order: M1, M2, MALE total, F1, FEMALE total, COMBINED total.
    expect(block.rows.map((r) => r[1])).toEqual([
      "Abad, Ben",
      "Cruz, Carlo",
      "MALE | TOTAL Per Day",
      "Dela Cruz, Diana",
      "FEMALE | TOTAL Per Day",
      "COMBINED TOTAL PER DAY",
    ]);
  });

  it("omits the unspecified-sex block entirely when every learner has a sex", () => {
    const cellFor = (): Sf2Status | null => "PRESENT";
    const block = buildSf2MonthBlock({
      learners: [MALE_1, FEMALE_1],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });
    expect(block.rows.map((r) => r[1])).not.toContain("NOT SPECIFIED | TOTAL Per Day");
  });

  it("lists a learner with no recorded sex after the FEMALE block, without a MALE/FEMALE total row claiming them", () => {
    const noSex: Sf2Learner = { ...MALE_1, id: "u1", displayName: "Reyes, Uni", sex: null };
    const cellFor = (): Sf2Status | null => "PRESENT";
    const block = buildSf2MonthBlock({
      learners: [MALE_1, noSex],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });
    expect(block.rows.map((r) => r[1])).toContain("Reyes, Uni");
    // The unspecified group gets no "TOTAL Per Day" row of its own — only
    // MALE and FEMALE (even an empty FEMALE block, printed as zeroes) ever
    // get one; the unspecified sex is never claimed by either total.
    expect(block.rows.filter((r) => String(r[1]).includes("TOTAL Per Day"))).toHaveLength(2);
    expect(block.rows.map((r) => r[1])).not.toContain("NOT SPECIFIED | TOTAL Per Day");
  });
});

describe("buildSf2MonthBlock — status codes", () => {
  it("blank = present, x = absent, L = tardy, E = excused", () => {
    const statuses: Record<string, Sf2Status> = {
      m1: "PRESENT",
      m2: "ABSENT",
    };
    const cellFor = (learnerId: string): Sf2Status | null => statuses[learnerId] ?? null;
    const learners = [MALE_1, MALE_2];
    const block = buildSf2MonthBlock({
      learners,
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });

    const dayColIdx = 2; // "#", "Learner", <day>
    const m1Row = block.rows.find((r) => r[1] === "Abad, Ben")!;
    const m2Row = block.rows.find((r) => r[1] === "Cruz, Carlo")!;
    expect(m1Row[dayColIdx]).toBe(""); // present -> blank
    expect(m2Row[dayColIdx]).toBe("x"); // absent -> x
  });

  it("counts LATE as tardy in the TARDY column and as present in the daily total", () => {
    const cellFor = (): Sf2Status | null => "LATE";
    const block = buildSf2MonthBlock({
      learners: [MALE_1],
      dayKeys: ["2026-08-24", "2026-08-25"],
      cellFor,
      includeGradeSection: false,
    });

    const row = block.rows.find((r) => r[1] === "Abad, Ben")!;
    // "#", "Learner", day1, day2, ABSENT, TARDY
    expect(row[row.length - 1]).toBe(2); // TARDY
    expect(row[row.length - 2]).toBe(0); // ABSENT

    const maleTotalRow = block.rows.find((r) => r[1] === "MALE | TOTAL Per Day")!;
    // LATE counts as present in the daily total.
    expect(maleTotalRow[2]).toBe(1);
  });

  it("marks EXCUSED with E and does not count it as present", () => {
    const cellFor = (): Sf2Status | null => "EXCUSED";
    const block = buildSf2MonthBlock({
      learners: [MALE_1],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });
    const row = block.rows.find((r) => r[1] === "Abad, Ben")!;
    expect(row[2]).toBe("E");
    const maleTotalRow = block.rows.find((r) => r[1] === "MALE | TOTAL Per Day")!;
    expect(maleTotalRow[2]).toBe(0);
  });
});

describe("buildSf2MonthBlock — shaded cells for a missing record", () => {
  it("shades a day cell with no Attendance row at all, distinct from a recorded blank present", () => {
    const cellFor = (learnerId: string, dayKey: string): Sf2Status | null =>
      dayKey === "2026-08-24" ? "PRESENT" : null;
    const block = buildSf2MonthBlock({
      learners: [MALE_1],
      dayKeys: ["2026-08-24", "2026-08-25"],
      cellFor,
      includeGradeSection: false,
    });

    const rowIdx = block.rows.findIndex((r) => r[1] === "Abad, Ben");
    const dayColStart = 2;
    expect(block.shadedCells?.[rowIdx]?.[dayColStart]).toBe(false); // recorded present
    expect(block.shadedCells?.[rowIdx]?.[dayColStart + 1]).toBe(true); // no record
  });
});

describe("buildSf2MonthBlock — totals rows are bold", () => {
  it("flags the MALE/FEMALE/COMBINED total rows as bold", () => {
    const cellFor = (): Sf2Status | null => "PRESENT";
    const block = buildSf2MonthBlock({
      learners: [MALE_1, FEMALE_1],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });

    const maleTotalIdx = block.rows.findIndex((r) => r[1] === "MALE | TOTAL Per Day");
    const femaleTotalIdx = block.rows.findIndex((r) => r[1] === "FEMALE | TOTAL Per Day");
    const combinedIdx = block.rows.findIndex((r) => r[1] === "COMBINED TOTAL PER DAY");
    expect(block.boldRowIndices).toEqual(
      expect.arrayContaining([maleTotalIdx, femaleTotalIdx, combinedIdx])
    );
  });
});

describe("buildSf2MonthBlock — Grade/Section columns", () => {
  it("includes Grade and Section columns when includeGradeSection is true", () => {
    const cellFor = (): Sf2Status | null => "PRESENT";
    const block = buildSf2MonthBlock({
      learners: [MALE_1],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: true,
    });
    expect(block.columns.map((c) => c.header)).toEqual(
      expect.arrayContaining(["Grade", "Section"])
    );
  });

  it("omits Grade and Section columns when a single section is already filtered", () => {
    const cellFor = (): Sf2Status | null => "PRESENT";
    const block = buildSf2MonthBlock({
      learners: [MALE_1],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });
    expect(block.columns.map((c) => c.header)).not.toContain("Grade");
    expect(block.columns.map((c) => c.header)).not.toContain("Section");
  });
});

describe("buildSf2Blocks — one block per calendar month, split across a month boundary", () => {
  it("produces two blocks for a range spanning August into September", () => {
    const cellFor = (): Sf2Status | null => "PRESENT";
    const blocks = buildSf2Blocks({
      learners: [MALE_1],
      dayKeys: ["2026-08-31", "2026-09-01", "2026-09-02"],
      cellFor,
      includeGradeSection: false,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].sheetName).toBe("August 2026");
    expect(blocks[1].sheetName).toBe("September 2026");
    // Only the one day in scope for August's block.
    expect(blocks[0].columns.map((c) => c.header)).toContain("31-M");
    expect(blocks[1].columns.map((c) => c.header)).toEqual(
      expect.arrayContaining(["1-T", "2-W"])
    );
  });
});

describe("buildSf2MonthBlock — month summary note", () => {
  it("reports school days, enrolment, ADA and percentage attendance", () => {
    const statuses: Record<string, Sf2Status> = { m1: "PRESENT", f1: "ABSENT" };
    const cellFor = (learnerId: string): Sf2Status | null => statuses[learnerId] ?? null;
    const block = buildSf2MonthBlock({
      learners: [MALE_1, FEMALE_1],
      dayKeys: ["2026-08-24"],
      cellFor,
      includeGradeSection: false,
    });

    expect(block.note).toContain("School days: 1");
    expect(block.note).toContain("Enrolment: 2");
    // 1 of 2 learners present on the only day -> ADA 1.0, 50% attendance.
    expect(block.note).toContain("Average Daily Attendance: 1.0");
    expect(block.note).toContain("Percentage of Attendance: 50%");
  });
});
