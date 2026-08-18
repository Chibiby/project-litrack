import { describe, it, expect } from "vitest";
import type { ParsedSchoolRow } from "@/lib/import/school-roster";
import { assignSchoolCredentials, PLACEHOLDER_SCHOOL_ID } from "@/lib/import/school-credentials";

function row(sourceRow: number, schoolIdCode: string | null, name: string): ParsedSchoolRow {
  return { sourceRow, schoolIdCode, rawSchoolId: schoolIdCode ?? "", name, district: "Malapatan 2" };
}

describe("assignSchoolCredentials", () => {
  it("leaves a non-colliding id completely untouched", () => {
    const { assignments } = assignSchoolCredentials([row(7, "500282", "Alabel Integrated SPED Center")]);
    expect(assignments[0].schoolIdCode).toBe("500282");
    expect(assignments[0].password).toBe("500282");
    expect(assignments[0].suffixed).toBe(false);
    expect(assignments[0].placeholder).toBe(false);
  });

  it("shares the password but suffixes the stored code on a collision", () => {
    const { assignments } = assignSchoolCredentials([
      row(280, "130551", "Del Hilado ES"),
      row(281, "130551", "Del Hilado ES (Matlusi Extension)"),
    ]);
    expect(assignments.map((a) => a.schoolIdCode)).toEqual(["130551", "130551-2"]);
    expect(assignments.map((a) => a.password)).toEqual(["130551", "130551"]);
    expect(assignments.map((a) => a.suffixed)).toEqual([false, true]);
  });

  it("assigns suffixes by ascending source row regardless of input order", () => {
    const { assignments } = assignSchoolCredentials([
      row(281, "130551", "Del Hilado ES (Matlusi Extension)"),
      row(280, "130551", "Del Hilado ES"),
    ]);
    const byRow = Object.fromEntries(assignments.map((a) => [a.sourceRow, a.schoolIdCode]));
    expect(byRow[280]).toBe("130551");
    expect(byRow[281]).toBe("130551-2");
  });

  it("handles a group of three", () => {
    const { assignments } = assignSchoolCredentials([
      row(10, "502694", "A"),
      row(11, "502694", "B"),
      row(12, "502694", "C"),
    ]);
    expect(assignments.map((a) => a.schoolIdCode)).toEqual(["502694", "502694-2", "502694-3"]);
    expect(new Set(assignments.map((a) => a.password))).toEqual(new Set(["502694"]));
  });

  it("applies the placeholder id to rows the sheet left unusable", () => {
    const { assignments } = assignSchoolCredentials([
      row(147, null, "Datal Bong ES - Green Valley extension"),
      row(306, null, "Nabol NHS (Proposed)"),
    ]);
    expect(assignments.map((a) => a.schoolIdCode)).toEqual([
      PLACEHOLDER_SCHOOL_ID,
      `${PLACEHOLDER_SCHOOL_ID}-2`,
    ]);
    expect(assignments.map((a) => a.password)).toEqual([PLACEHOLDER_SCHOOL_ID, PLACEHOLDER_SCHOOL_ID]);
    expect(assignments.every((a) => a.placeholder)).toBe(true);
  });

  it("keeps every stored code unique across the whole roster", () => {
    const { assignments } = assignSchoolCredentials([
      row(1, "130551", "A"),
      row(2, "130551", "B"),
      row(3, "130554", "C"),
      row(4, null, "D"),
    ]);
    const codes = assignments.map((a) => a.schoolIdCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("reports a conflict when a suffixed code would collide with a real id", () => {
    const { conflicts } = assignSchoolCredentials([
      row(1, "130551", "A"),
      row(2, "130551", "B"),
      row(3, "130551-2", "C"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].value).toBe("130551-2");
  });

  // R7: schoolHeadSyntheticEmail lowercases and replaces every non [a-z0-9-]
  // character, so two codes that differ only in case or punctuation produce one
  // address. Supabase would reject the second createUser mid-run.
  it("reports a conflict when two distinct codes fold to the same synthetic email", () => {
    const { conflicts } = assignSchoolCredentials([row(1, "ABC123", "A"), row(2, "abc123", "B")]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sourceRows).toEqual([1, 2]);
  });

  it("reports a conflict when punctuation is the only difference", () => {
    const { conflicts } = assignSchoolCredentials([row(1, "AB_123", "A"), row(2, "AB-123", "B")]);
    expect(conflicts).toHaveLength(1);
  });

  it("carries district, region, division and address through unchanged", () => {
    const input: ParsedSchoolRow = {
      sourceRow: 9,
      schoolIdCode: "130425",
      rawSchoolId: "130425",
      name: "Famorcan ES",
      district: "Alabel 1",
      region: "XII",
      division: "Sarangani",
      address: "Bagong Lipunan, Famorcan, Alabel",
    };
    const { assignments } = assignSchoolCredentials([input]);
    expect(assignments[0]).toMatchObject({
      district: "Alabel 1",
      region: "XII",
      division: "Sarangani",
      address: "Bagong Lipunan, Famorcan, Alabel",
    });
  });
});
