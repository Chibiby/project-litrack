import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, enrollmentData, makeGrade, makeLearner, makeSchool, makeYear, truncateAll } from "./helpers";

// Enrollment_learner_active_unique is SQL-only (WHERE status = 'ACTIVE'), so no
// mocked-Prisma test can see it.
describe("Enrollment_learner_active_unique", () => {
  beforeEach(truncateAll);
  afterAll(() => db.$disconnect());

  async function seed() {
    const school = await makeSchool();
    const grade = await makeGrade(school.id);
    const year = await makeYear(school.id, { isActive: true });
    const learner = await makeLearner(school.id, grade.id, "Ana");
    return { learner, year };
  }

  it("rejects a second ACTIVE enrollment for the same learner with P2002", async () => {
    const { learner, year } = await seed();
    await db.enrollment.create({ data: enrollmentData(learner, year.id, "ACTIVE") });
    await expect(
      db.enrollment.create({ data: enrollmentData(learner, year.id, "ACTIVE") }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("accepts an ACTIVE row alongside ended ones", async () => {
    const { learner, year } = await seed();
    await db.enrollment.create({ data: enrollmentData(learner, year.id, "ACTIVE") });
    await db.enrollment.create({ data: enrollmentData(learner, year.id, "COMPLETED") });
    await db.enrollment.create({ data: enrollmentData(learner, year.id, "ARCHIVED") });
    expect(await db.enrollment.count({ where: { learnerId: learner.id } })).toBe(3);
  });

  it("allows a new ACTIVE row once the previous one ended", async () => {
    const { learner, year } = await seed();
    const first = await db.enrollment.create({ data: enrollmentData(learner, year.id, "ACTIVE") });
    await db.enrollment.update({ where: { id: first.id }, data: { status: "COMPLETED" } });
    await db.enrollment.create({ data: enrollmentData(learner, year.id, "ACTIVE") });
    expect(
      await db.enrollment.count({ where: { learnerId: learner.id, status: "ACTIVE" } }),
    ).toBe(1);
  });
});
