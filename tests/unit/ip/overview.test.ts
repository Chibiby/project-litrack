import { describe, expect, it } from "vitest";
import { NO_DISTRICT, shapeIpOverview, type IpOverviewRow } from "@/lib/ip/overview";

const row = (over: Partial<IpOverviewRow> & { n: number }): IpOverviewRow => ({
  schoolId: "s1",
  gradeLevelId: "g1",
  gender: "FEMALE",
  isAralLearner: false,
  ethnicity: "BLAAN",
  secondaryEthnicity: null,
  ...over,
  _count: { _all: over.n },
});

const base = {
  schools: [
    { id: "s1", name: "Alpha ES", district: "Glan 1" },
    { id: "s2", name: "Beta ES", district: "Glan 1" },
    { id: "s3", name: "Gamma ES", district: null },
  ],
  enrolledBySchool: [
    { schoolId: "s1", _count: { _all: 10 } },
    { schoolId: "s2", _count: { _all: 20 } },
    { schoolId: "s3", _count: { _all: 5 } },
  ],
  gradeTypeById: new Map([
    ["g1", "GRADE_1"],
    ["g2", "KINDER"],
  ]),
  gradeOrder: ["KINDER", "GRADE_1"],
};

describe("shapeIpOverview", () => {
  it("counts a learner once in the total and once per group", () => {
    const o = shapeIpOverview({
      ...base,
      ipRows: [
        row({ n: 3, secondaryEthnicity: "TBOLI" }),
        row({ n: 2, schoolId: "s2", gender: "MALE", isAralLearner: true, gradeLevelId: "g2" }),
      ],
    });
    expect(o.ipLearners).toBe(5);
    expect(o.enrolled).toBe(35);
    expect(o.groups.map((g) => [g.key, g.count])).toEqual([
      ["BLAAN", 5],
      ["TBOLI", 3],
    ]);
    expect(o.bySex).toEqual({ male: 2, female: 3, unrecorded: 0 });
    expect(o.inAral).toBe(2);
    expect(o.byGrade.map((g) => g.grade)).toEqual(["KINDER", "GRADE_1"]);
  });

  it("ranks schools and districts by IP learners, with shares of their own enrolled", () => {
    const o = shapeIpOverview({
      ...base,
      ipRows: [row({ n: 2 }), row({ n: 6, schoolId: "s2" }), row({ n: 1, schoolId: "s3" })],
    });
    expect(o.schools.map((s) => [s.name, s.ipLearners, s.ipPercent])).toEqual([
      ["Beta ES", 6, "30.0%"],
      ["Alpha ES", 2, "20.0%"],
      ["Gamma ES", 1, "20.0%"],
    ]);
    expect(o.districts).toEqual([
      { district: "Glan 1", schoolsWithIp: 2, ipLearners: 8, enrolled: 30, ipPercent: "26.7%" },
      { district: NO_DISTRICT, schoolsWithIp: 1, ipLearners: 1, enrolled: 5, ipPercent: "20.0%" },
    ]);
    expect(o.schoolsWithIp).toBe(3);
    expect(o.schoolsInScope).toBe(3);
  });

  it("ignores rows of schools out of scope and rows with no IP group", () => {
    const o = shapeIpOverview({
      ...base,
      ipRows: [row({ n: 4, schoolId: "elsewhere" }), row({ n: 9, ethnicity: "ILOCANO" })],
    });
    expect(o.ipLearners).toBe(0);
    expect(o.ipPercent).toBe("0.0%");
    expect(o.schools).toEqual([]);
  });
});
