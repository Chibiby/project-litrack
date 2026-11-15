import { describe, expect, it } from "vitest";
import { buildSectionPeople } from "@/lib/school-head/section-people";

const p = (id: string, firstName: string, lastName: string, over = {}) => ({
  id,
  firstName,
  lastName,
  isActive: true,
  deletedAt: null,
  ...over,
});

describe("buildSectionPeople", () => {
  it("puts the adviser first and merges every role a teacher has", () => {
    const adviser = p("t1", "Ana", "Reyes", { role: "TEACHER" });
    const people = buildSectionPeople(
      {
        adviser,
        teachers: [{ teacher: p("t2", "Ben", "Abad") }, { teacher: adviser }],
        learners: [
          { ...p("l1", "Juan", "Cruz"), isAralLearner: true, aralTeacher: adviser },
          { ...p("l2", "Maria", "Bautista"), isAralLearner: true, aralTeacher: p("t3", "Cora", "Diaz", { isActive: false }) },
          { ...p("l3", "Pedro", "Aquino"), isAralLearner: false, aralTeacher: p("t9", "Not", "Counted") },
        ],
      },
      new Set(["l2"])
    );
    expect(people.adviser).toEqual({ id: "t1", name: "Reyes, Ana", usable: true });
    expect(people.teachers).toEqual([
      { id: "t1", name: "Reyes, Ana", roles: ["ADVISER", "TEACHER", "ARAL"], inactive: false },
      { id: "t2", name: "Abad, Ben", roles: ["TEACHER"], inactive: false },
      { id: "t3", name: "Diaz, Cora", roles: ["ARAL"], inactive: true },
    ]);
    expect(people.learners.map((l) => [l.name, l.isAral, l.pendingRequest])).toEqual([
      ["Aquino, Pedro", false, false],
      ["Bautista, Maria", true, true],
      ["Cruz, Juan", true, false],
    ]);
  });

  it("reports an inactive or non-teacher adviser as not usable for moves", () => {
    const base = { teachers: [], learners: [] };
    expect(buildSectionPeople({ ...base, adviser: p("t1", "A", "B", { isActive: false }) }).adviser?.usable).toBe(false);
    expect(buildSectionPeople({ ...base, adviser: p("t1", "A", "B", { role: "SCHOOL_HEAD" }) }).adviser?.usable).toBe(false);
  });

  it("is empty for a section with no one in it", () => {
    expect(buildSectionPeople({ adviser: null, teachers: [], learners: [] })).toEqual({
      adviser: null,
      teachers: [],
      learners: [],
    });
  });
});
