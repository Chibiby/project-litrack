import { describe, expect, it } from "vitest";
import {
  ARAL_ATTENDANCE_SORTS,
  ARAL_READING_LEVEL_SORTS,
  aralReadingLevelOrderBy,
  sortAttendanceLearners,
  type AttendanceSortableLearner,
} from "@/lib/aral/grid-sorts";

/**
 * The two ARAL entry grids sort through different mechanisms — weekly
 * attendance in the browser (it is unpaginated and holds unsaved marks),
 * monthly reading level through a Prisma `orderBy` (it is paginated). These
 * cover both halves.
 */

const LEARNERS: AttendanceSortableLearner[] = [
  { id: "l1", listingName: "Santos, Ana", sectionName: "Sampaguita" },
  { id: "l2", listingName: "Cruz, Ben", sectionName: null },
  { id: "l3", listingName: "Aguilar, Zoe", sectionName: "Ilang-Ilang" },
];

const names = (rows: { listingName: string }[]) => rows.map((r) => r.listingName);

describe("sortAttendanceLearners", () => {
  it("orders alphabetically by the surname-first name the column shows", () => {
    expect(names(sortAttendanceLearners(LEARNERS, "name", new Map()))).toEqual([
      "Aguilar, Zoe",
      "Cruz, Ben",
      "Santos, Ana",
    ]);
  });

  it("puts a learner with no section last rather than first", () => {
    // Sorting `null` naively ("" sorts before every letter) would open the
    // table with the rows that carry the least information.
    expect(names(sortAttendanceLearners(LEARNERS, "section", new Map()))).toEqual([
      "Aguilar, Zoe", // Ilang-Ilang
      "Santos, Ana", // Sampaguita
      "Cruz, Ben", // no section
    ]);
  });

  it("orders by most absences first, breaking ties by name", () => {
    const absences = new Map([
      ["l1", 1],
      ["l2", 3],
      // l3 was absent zero times, and is therefore missing from the map.
    ]);
    expect(names(sortAttendanceLearners(LEARNERS, "absences", absences))).toEqual([
      "Cruz, Ben", // 3
      "Santos, Ana", // 1
      "Aguilar, Zoe", // 0, a missing key reads as zero
    ]);
  });

  it("breaks an absence tie by name rather than leaving input order to decide", () => {
    const tied = new Map([
      ["l1", 2],
      ["l2", 2],
      ["l3", 2],
    ]);
    expect(names(sortAttendanceLearners(LEARNERS, "absences", tied))).toEqual([
      "Aguilar, Zoe",
      "Cruz, Ben",
      "Santos, Ana",
    ]);
  });

  it("does not mutate the array it is given", () => {
    const input = [...LEARNERS];
    sortAttendanceLearners(input, "name", new Map());
    expect(names(input)).toEqual(names(LEARNERS));
  });

  it("collates accents like the database does, so Ñ groups with N", () => {
    const rows: AttendanceSortableLearner[] = [
      { id: "a", listingName: "Nuñez, Rosa", sectionName: null },
      { id: "b", listingName: "Ñuñez, Pedro", sectionName: null },
      { id: "c", listingName: "Ocampo, Luis", sectionName: null },
    ];
    const sorted = names(sortAttendanceLearners(rows, "name", new Map()));
    // Both Nuñez spellings land before Ocampo — an accent-blind comparator,
    // not raw code-point order, which would push "Ñ" (U+00D1) past "O".
    expect(sorted[2]).toBe("Ocampo, Luis");
  });
});

describe("ARAL sort parsing", () => {
  it("falls back to alphabetical for an unknown, missing, or repeated param", () => {
    expect(ARAL_ATTENDANCE_SORTS.parse("nonsense")).toBe("name");
    expect(ARAL_ATTENDANCE_SORTS.parse(undefined)).toBe("name");
    expect(ARAL_READING_LEVEL_SORTS.parse("")).toBe("name");
    expect(ARAL_READING_LEVEL_SORTS.parse(["section", "name"])).toBe("section");
  });

  it("is case-insensitive, so a hand-typed URL still resolves", () => {
    expect(ARAL_READING_LEVEL_SORTS.parse("Reading-Level")).toBe("reading-level");
  });
});

describe("aralReadingLevelOrderBy", () => {
  it("ends every ordering with the id tiebreaker", () => {
    // The grid is paginated with skip/take and none of the sort keys is
    // unique. Without a unique last key Postgres may return one learner on
    // two pages and drop another entirely.
    for (const option of ARAL_READING_LEVEL_SORTS.options) {
      expect(aralReadingLevelOrderBy(option.value).at(-1)).toEqual({ id: "asc" });
    }
  });

  it("orders alphabetically by name parts, never the Firstname-first fullName", () => {
    // `fullName` is stored Firstname-first while the column reads
    // surname-first; ordering by it would sort against what is on screen.
    const clauses = aralReadingLevelOrderBy("name");
    expect(clauses).toEqual([{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }]);
    expect(JSON.stringify(clauses)).not.toContain("fullName");
  });

  it("sorts by section name, then by learner name inside a section", () => {
    expect(aralReadingLevelOrderBy("section")).toEqual([
      { section: { name: "asc" } },
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ]);
  });
});
