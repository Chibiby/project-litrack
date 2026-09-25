import { describe, expect, it } from "vitest";
import {
  ARAL_TUTOR_DEPED,
  ARAL_TUTOR_NON_DEPED,
  aralFacetRows,
  classifyAralTutor,
  shapeAral,
  type RawAralRow,
} from "@/lib/summary/queries/aral";
import { NOT_ANSWERED } from "@/lib/summary/shape/section";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * Facet `aral`: (1) ARAL learners per grade level, showing only grades with a
 * learner somewhere in the result (enum order; the full list if none), and
 * (2) teachers currently designated ARAL tutor, split DepEd / Non-DepEd / Not
 * answered by a pure TS rule so the mapping itself is under test, not just the
 * raw buckets passed through. Pure shaping only — no Prisma.
 */

function school(id: string, name: string, district: string | null): ScopeSchool {
  return {
    id,
    name,
    schoolIdCode: id.toUpperCase(),
    district,
    division: "Sarangani",
    region: "XII",
    isActive: true,
  };
}

const SCHOOLS = [
  school("s1", "Alabel CES", "Alabel 1"),
  school("s2", "Bagacay ES", "Alabel 1"),
  school("s3", "Glan CES", "Glan 1"),
];

describe("classifyAralTutor", () => {
  it("DEPED_PLANTILLA -> DEPED", () => {
    expect(classifyAralTutor("DEPED_PLANTILLA", null)).toBe(ARAL_TUTOR_DEPED);
  });

  it("NON_DEPED -> NON_DEPED", () => {
    expect(classifyAralTutor("NON_DEPED", null)).toBe(ARAL_TUTOR_NON_DEPED);
  });

  it("no employmentType, the ARAL volunteer designation -> NON_DEPED", () => {
    expect(classifyAralTutor(null, ARAL_VOLUNTEER_DESIGNATION)).toBe(ARAL_TUTOR_NON_DEPED);
  });

  it("no employmentType, some other designation -> NOT_ANSWERED", () => {
    expect(classifyAralTutor(null, "Master Teacher I")).toBe(NOT_ANSWERED);
  });

  it("no employmentType, no designation (no profile) -> NOT_ANSWERED", () => {
    expect(classifyAralTutor(null, null)).toBe(NOT_ANSWERED);
  });

  it("DEPED_PLANTILLA wins over a volunteer-looking designation", () => {
    expect(classifyAralTutor("DEPED_PLANTILLA", ARAL_VOLUNTEER_DESIGNATION)).toBe(ARAL_TUTOR_DEPED);
  });
});

describe("aralFacetRows", () => {
  it("carries grade rows through with no grade split", () => {
    const raw: RawAralRow[] = [
      { school_id: "s1", field: "grade", bucket: "G3", employment_type: null, designation: null, count: 10 },
    ];
    const rows = aralFacetRows(raw);
    expect(rows).toEqual([{ schoolId: "s1", gradeType: null, field: "grade", bucket: "G3", count: 10 }]);
  });

  it("sums two raw tutor rows that map to the same (school, bucket)", () => {
    const raw: RawAralRow[] = [
      { school_id: "s1", field: "tutor", bucket: null, employment_type: null, designation: "Master Teacher I", count: 2 },
      { school_id: "s1", field: "tutor", bucket: null, employment_type: null, designation: null, count: 3 },
    ];
    const rows = aralFacetRows(raw);
    expect(rows).toEqual([{ schoolId: "s1", gradeType: null, field: "tutor", bucket: NOT_ANSWERED, count: 5 }]);
  });

  it("keeps different schools and different buckets separate", () => {
    const raw: RawAralRow[] = [
      { school_id: "s1", field: "tutor", bucket: null, employment_type: "DEPED_PLANTILLA", designation: null, count: 2 },
      { school_id: "s1", field: "tutor", bucket: null, employment_type: "NON_DEPED", designation: null, count: 1 },
      { school_id: "s2", field: "tutor", bucket: null, employment_type: "DEPED_PLANTILLA", designation: null, count: 1 },
    ];
    const rows = aralFacetRows(raw);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.schoolId === "s1" && r.bucket === ARAL_TUTOR_DEPED)?.count).toBe(2);
    expect(rows.find((r) => r.schoolId === "s1" && r.bucket === ARAL_TUTOR_NON_DEPED)?.count).toBe(1);
    expect(rows.find((r) => r.schoolId === "s2" && r.bucket === ARAL_TUTOR_DEPED)?.count).toBe(1);
  });
});

const RAW: RawAralRow[] = [
  { school_id: "s1", field: "grade", bucket: "G3", employment_type: null, designation: null, count: 10 },
  { school_id: "s1", field: "grade", bucket: "G4", employment_type: null, designation: null, count: 5 },
  { school_id: "s2", field: "grade", bucket: "G3", employment_type: null, designation: null, count: 7 },
  { school_id: "s3", field: "grade", bucket: "G5", employment_type: null, designation: null, count: 3 },
  { school_id: "s1", field: "tutor", bucket: null, employment_type: "DEPED_PLANTILLA", designation: null, count: 2 },
  { school_id: "s1", field: "tutor", bucket: null, employment_type: "NON_DEPED", designation: null, count: 1 },
  { school_id: "s2", field: "tutor", bucket: null, employment_type: null, designation: "Master Teacher I", count: 1 },
];

describe("shapeAral", () => {
  const result = shapeAral({ raw: RAW, schools: SCHOOLS, level: "overall", computedAt: "2026-09-25T00:00:00.000Z" });

  it("returns the facetId, title and both sections", () => {
    expect(result.facetId).toBe("aral");
    expect(result.title).toBe("ARAL learners and tutors");
    expect(result.sections.map((s) => s.id)).toEqual(["learnersByGrade", "tutors"]);
  });

  it("never puts a teacher or learner's own name, email or contact number in the result", () => {
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/); // no email address
    expect(blob).not.toMatch(/"(firstName|lastName|fullName|contactNumber)"/);
  });

  describe("learnersByGrade", () => {
    const section = result.sections.find((s) => s.id === "learnersByGrade")!;
    const overall = section.table.groups.find((g) => g.key === "overall")!;

    it("is a single-choice table not split by grade (grade is the bucket)", () => {
      expect(section.kind).toBe("single");
      expect(section.byGrade).toBe(false);
    });

    it("only shows grades with a learner somewhere in the result, in enum order", () => {
      expect(section.buckets.map((b) => b.id)).toEqual(["G3", "G4", "G5"]);
    });

    it("falls back to the full grade list when nothing has any ARAL learners", () => {
      const empty = shapeAral({ raw: [], schools: SCHOOLS, level: "overall", computedAt: "x" });
      const emptySection = empty.sections.find((s) => s.id === "learnersByGrade")!;
      expect(emptySection.buckets.length).toBe(14);
      expect(emptySection.buckets[0]!.id).toBe("KINDER");
    });

    it("counts every ARAL learner across the shown grade buckets", () => {
      expect(overall.cells.G3!.count).toBe(17);
      expect(overall.cells.G4!.count).toBe(5);
      expect(overall.cells.G5!.count).toBe(3);
      expect(overall.base).toBe(25);
    });
  });

  describe("tutors", () => {
    const section = result.sections.find((s) => s.id === "tutors")!;
    const overall = section.table.groups.find((g) => g.key === "overall")!;

    it("maps DepEd, Non-DepEd and Not answered buckets and zero-fills the rest", () => {
      expect(overall.cells[ARAL_TUTOR_DEPED]!.count).toBe(2);
      expect(overall.cells[ARAL_TUTOR_NON_DEPED]!.count).toBe(1);
      expect(overall.cells[NOT_ANSWERED]!.count).toBe(1);
      expect(overall.base).toBe(4);
    });
  });

  describe("district and school rollup", () => {
    it("district level sums school rows within the same district", () => {
      const district = shapeAral({
        raw: RAW,
        schools: SCHOOLS,
        level: "district",
        computedAt: "2026-09-25T00:00:00.000Z",
      });
      const grade = district.sections.find((s) => s.id === "learnersByGrade")!;
      const alabel = grade.table.groups.find((g) => g.label === "Alabel 1")!;
      const glan = grade.table.groups.find((g) => g.label === "Glan 1")!;
      expect(alabel.cells.G3!.count).toBe(17);
      expect(alabel.cells.G4!.count).toBe(5);
      expect(alabel.base).toBe(22);
      expect(glan.cells.G5!.count).toBe(3);
      expect(glan.base).toBe(3);
    });

    it("school level keeps one row per school, matching the raw counts", () => {
      const bySchool = shapeAral({
        raw: RAW,
        schools: SCHOOLS,
        level: "school",
        computedAt: "2026-09-25T00:00:00.000Z",
      });
      const grade = bySchool.sections.find((s) => s.id === "learnersByGrade")!;
      const s1 = grade.table.groups.find((g) => g.schoolId === "s1")!;
      const s2 = grade.table.groups.find((g) => g.schoolId === "s2")!;
      const s3 = grade.table.groups.find((g) => g.schoolId === "s3")!;
      expect(s1.cells.G3!.count).toBe(10);
      expect(s1.cells.G4!.count).toBe(5);
      expect(s2.cells.G3!.count).toBe(7);
      expect(s3.cells.G5!.count).toBe(3);

      const tutors = bySchool.sections.find((s) => s.id === "tutors")!;
      const t1 = tutors.table.groups.find((g) => g.schoolId === "s1")!;
      const t2 = tutors.table.groups.find((g) => g.schoolId === "s2")!;
      const t3 = tutors.table.groups.find((g) => g.schoolId === "s3")!;
      expect(t1.cells[ARAL_TUTOR_DEPED]!.count).toBe(2);
      expect(t1.cells[ARAL_TUTOR_NON_DEPED]!.count).toBe(1);
      expect(t2.cells[NOT_ANSWERED]!.count).toBe(1);
      expect(t3.base).toBe(0);
    });
  });
});
