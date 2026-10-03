import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, makeSchool, makeYear, truncateAll } from "./helpers";

// SchoolYear_school_active_unique is SQL-only (WHERE "isActive").
describe("SchoolYear_school_active_unique", () => {
  beforeEach(truncateAll);
  afterAll(() => db.$disconnect());

  it("rejects a second active year for the same school with P2002", async () => {
    const school = await makeSchool();
    await makeYear(school.id, { label: "2026-2027", isActive: true });
    await expect(
      makeYear(school.id, { label: "2027-2028", isActive: true }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("accepts another school's active year and extra inactive years", async () => {
    const a = await makeSchool();
    const b = await makeSchool();
    await makeYear(a.id, { label: "2026-2027", isActive: true });
    await makeYear(a.id, { label: "2025-2026", isActive: false });
    await makeYear(a.id, { label: "2024-2025", isActive: false });
    await makeYear(b.id, { label: "2026-2027", isActive: true });
    expect(await db.schoolYear.count({ where: { isActive: true } })).toBe(2);
  });

  it("deactivate-then-activate in one transaction succeeds (activateSchoolYear order)", async () => {
    const school = await makeSchool();
    const current = await makeYear(school.id, { label: "2026-2027", isActive: true });
    const target = await makeYear(school.id, { label: "2027-2028", isActive: false });

    await db.$transaction(async (tx) => {
      await tx.schoolYear.updateMany({
        where: { schoolId: school.id, isActive: true },
        data: { isActive: false },
      });
      await tx.schoolYear.update({ where: { id: target.id }, data: { isActive: true } });
    });

    const active = await db.schoolYear.findMany({
      where: { schoolId: school.id, isActive: true },
    });
    expect(active.map((y) => y.id)).toEqual([target.id]);
    expect(
      (await db.schoolYear.findUniqueOrThrow({ where: { id: current.id } })).isActive,
    ).toBe(false);
  });
});
