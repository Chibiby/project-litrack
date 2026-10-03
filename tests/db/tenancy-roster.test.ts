import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { multiAdvisoryTeacherIds, teacherRosterScope } from "@/lib/teachers/roster";
import { db, makeGrade, makeSchool, makeTeacher, truncateAll } from "./helpers";

// Real queries from src/lib/teachers/roster.ts (School Head teachers workspace)
// against real Postgres: the schoolId where-clause must keep schools apart.
describe("tenancy: teacher roster queries", () => {
  beforeEach(truncateAll);
  afterAll(() => db.$disconnect());

  async function schoolWithMultiAdvisoryTeacher(name: string) {
    const school = await makeSchool(name);
    const grade = await makeGrade(school.id);
    const teacher = await makeTeacher(school.id, name);
    const solo = await makeTeacher(school.id, `${name}-solo`);
    await db.section.createMany({
      data: [
        { schoolId: school.id, gradeLevelId: grade.id, name: "A", adviserId: teacher.id },
        { schoolId: school.id, gradeLevelId: grade.id, name: "B", adviserId: teacher.id },
        { schoolId: school.id, gradeLevelId: grade.id, name: "C", adviserId: solo.id },
      ],
    });
    return { school, teacher, solo };
  }

  it("multiAdvisoryTeacherIds returns only the caller's school", async () => {
    const a = await schoolWithMultiAdvisoryTeacher("Alpha");
    const b = await schoolWithMultiAdvisoryTeacher("Beta");

    expect(await multiAdvisoryTeacherIds(a.school.id)).toEqual([a.teacher.id]);
    expect(await multiAdvisoryTeacherIds(b.school.id)).toEqual([b.teacher.id]);
  });

  it("teacherRosterScope lists only that school's live teachers", async () => {
    const a = await schoolWithMultiAdvisoryTeacher("Alpha");
    const b = await schoolWithMultiAdvisoryTeacher("Beta");
    await db.user.update({ where: { id: a.solo.id }, data: { deletedAt: new Date() } });

    const rows = await db.user.findMany({ where: teacherRosterScope(a.school.id) });
    expect(rows.map((r) => r.id)).toEqual([a.teacher.id]);
    expect(rows.some((r) => r.schoolId === b.school.id)).toBe(false);
  });
});
