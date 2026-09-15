import { describe, expect, it } from "vitest";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  collapseKindsToOthers,
  formatAverage,
  formatPercent,
  safeRatio,
  shapeAdminIpMetrics,
  shapeSchoolIpMetrics,
  summarizeIpRows,
  topSchoolsWithIp,
  type AdminSchoolIpRow,
} from "@/lib/dashboard/ip-metrics";

const c = (n: number) => ({ _count: { _all: n } });

describe("ratio math", () => {
  it("never divides by zero", () => {
    expect(safeRatio(10, 0)).toBeNull();
    expect(formatAverage(10, 0)).toBe("—");
    expect(formatAverage(0, 0)).toBe("—");
    expect(formatAverage(25, 2)).toBe("12.5");
    expect(formatAverage(30, 3)).toBe("10.0");
  });

  it("formats percent to one decimal, dash on empty total", () => {
    expect(formatPercent(1, 3)).toBe("33.3%");
    expect(formatPercent(0, 5)).toBe("0.0%");
    expect(formatPercent(2, 2)).toBe("100.0%");
    expect(formatPercent(0, 0)).toBe("—");
  });
});

describe("summarizeIpRows", () => {
  it("counts a learner once in total and once per distinct IP kind", () => {
    const out = summarizeIpRows([
      { ethnicity: "BLAAN", secondaryEthnicity: "TBOLI", ...c(2) },
      { ethnicity: "BLAAN", secondaryEthnicity: null, ...c(3) },
      { ethnicity: "BISAYA", secondaryEthnicity: "TAUSOG", ...c(1) },
      { ethnicity: "BISAYA", secondaryEthnicity: null, ...c(9) },
    ]);
    expect(out.ipCount).toBe(6);
    expect(out.kinds).toEqual([
      { key: "BLAAN", name: "Blaan", value: 5 },
      { key: "TBOLI", name: "T'boli", value: 2 },
      { key: "TAUSOG", name: "Tausog", value: 1 },
    ]);
  });
});

describe("shapeAdminIpMetrics", () => {
  it("joins per-school groups and computes national figures", () => {
    const out = shapeAdminIpMetrics({
      schools: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
        { id: "z", name: "Empty" },
      ],
      learnerTotals: [
        { schoolId: "a", ...c(40) },
        { schoolId: "b", ...c(20) },
        { schoolId: "ghost", ...c(99) },
      ],
      ipRows: [
        { schoolId: "a", ethnicity: "MARANAO", secondaryEthnicity: null, ...c(4) },
        { schoolId: "b", ethnicity: "BADJAO", secondaryEthnicity: "MARANAO", ...c(1) },
        { schoolId: "ghost", ethnicity: "BADJAO", secondaryEthnicity: null, ...c(50) },
      ],
      teacherTotals: [
        // Includes a FLOATING/no-advisory-section teacher on purpose: the
        // denominator is every active teacher, not only advisers.
        { schoolId: "a", ...c(4) },
        { schoolId: null, ...c(7) },
      ],
    });

    expect(out.schools).toEqual([
      { schoolId: "a", name: "Alpha", totalLearners: 40, ipLearners: 4, ipPercent: "10.0%", activeTeachers: 4, learnersPerTeacher: "10.0" },
      { schoolId: "b", name: "Beta", totalLearners: 20, ipLearners: 1, ipPercent: "5.0%", activeTeachers: 0, learnersPerTeacher: "—" },
      { schoolId: "z", name: "Empty", totalLearners: 0, ipLearners: 0, ipPercent: "—", activeTeachers: 0, learnersPerTeacher: "—" },
    ]);
    expect(out.national).toEqual({
      totalLearners: 60,
      activeTeachers: 4,
      learnersPerTeacher: "15.0",
      ipLearners: 5,
      ipPercent: "8.3%",
    });
    expect(out.ipKinds).toEqual([
      { name: "Badjao", value: 1 },
      { name: "Maranao", value: 5 },
    ]);
  });
});

describe("topSchoolsWithIp", () => {
  const row = (name: string, ipLearners: number): AdminSchoolIpRow => ({
    schoolId: name,
    name,
    totalLearners: 100,
    ipLearners,
    ipPercent: "—",
    activeTeachers: 1,
    learnersPerTeacher: "—",
  });

  it("excludes zero-IP schools and sorts by count desc, name asc on ties", () => {
    const out = topSchoolsWithIp(
      [row("Zeta", 0), row("Beta", 5), row("Alpha", 5), row("Gamma", 9)],
      5
    );
    expect(out.map((r) => r.name)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("caps at n", () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`S${i}`, 7 - i));
    expect(topSchoolsWithIp(rows, 5)).toHaveLength(5);
  });
});

describe("collapseKindsToOthers", () => {
  it("returns all groups untouched when exactly n", () => {
    const kinds = [
      { name: "A", value: 5 },
      { name: "B", value: 4 },
      { name: "C", value: 3 },
      { name: "D", value: 2 },
      { name: "E", value: 1 },
    ];
    expect(collapseKindsToOthers(kinds, 5)).toEqual(kinds);
  });

  it("collapses the remainder into a single Others slice summing the rest", () => {
    const kinds = [
      { name: "A", value: 7 },
      { name: "B", value: 6 },
      { name: "C", value: 5 },
      { name: "D", value: 4 },
      { name: "E", value: 3 },
      { name: "F", value: 2 },
      { name: "G", value: 1 },
    ];
    const out = collapseKindsToOthers(kinds, 5);
    expect(out).toEqual([
      { name: "A", value: 7 },
      { name: "B", value: 6 },
      { name: "C", value: 5 },
      { name: "D", value: 4 },
      { name: "E", value: 3 },
      { name: "Others", value: 3 },
    ]);
  });
});

describe("shapeSchoolIpMetrics", () => {
  it("builds a grade/section table ordered by grade", () => {
    const out = shapeSchoolIpMetrics({
      grades: [
        { id: "g1", type: "G1" },
        { id: "g3", type: "G3" },
      ],
      sections: [
        { id: "s1", name: "Rose" },
        { id: "s2", name: "Lily" },
      ],
      gradeLabels: GRADE_LEVEL_LABELS,
      totals: [
        { gradeLevelId: "g3", sectionId: "s2", ...c(10) },
        { gradeLevelId: "g1", sectionId: "s1", ...c(8) },
        { gradeLevelId: "g1", sectionId: null, ...c(2) },
      ],
      ipRows: [
        { gradeLevelId: "g1", sectionId: "s1", ethnicity: "TAGAKAOLO", secondaryEthnicity: null, ...c(2) },
        { gradeLevelId: "g3", sectionId: "s2", ethnicity: "ILOCANO", secondaryEthnicity: "TBOLI", ...c(1) },
      ],
      activeTeachers: 4,
    });

    expect(out.totalLearners).toBe(20);
    expect(out.ipLearners).toBe(3);
    expect(out.ipPercent).toBe("15.0%");
    expect(out.activeTeachers).toBe(4);
    expect(out.learnersPerTeacher).toBe("5.0");
    expect(out.rows.map((r) => [r.grade, r.section, r.ipLearners, r.totalLearners, r.ipPercent])).toEqual([
      ["Grade 1", "No section", 0, 2, "0.0%"],
      ["Grade 1", "Rose", 2, 8, "25.0%"],
      ["Grade 3", "Lily", 1, 10, "10.0%"],
    ]);
    expect(out.ipKinds).toEqual([
      { name: "Tagakaolo", value: 2 },
      { name: "T'boli", value: 1 },
    ]);
  });

  it("returns dashes for an empty school, and for zero teachers", () => {
    const out = shapeSchoolIpMetrics({
      grades: [],
      sections: [],
      gradeLabels: {},
      totals: [],
      ipRows: [],
      activeTeachers: 0,
    });
    expect(out).toEqual({
      totalLearners: 0,
      ipLearners: 0,
      ipPercent: "—",
      rows: [],
      ipKinds: [],
      activeTeachers: 0,
      learnersPerTeacher: "—",
    });
  });
});
