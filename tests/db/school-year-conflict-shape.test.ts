import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isActiveYearConflict, isLabelConflict } from "@/lib/school-year-conflicts";
import { db, makeSchool, makeYear, truncateAll } from "./helpers";

/**
 * Proves the mappers against the error the real runtime (engineType "client" +
 * @prisma/adapter-pg) produces, not a hand-built mock: `meta.target` is absent
 * there, and the unique fields live under `meta.driverAdapterError`.
 */
async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the write to fail");
}

describe("SchoolYear P2002 real error shape", () => {
  beforeEach(truncateAll);
  afterAll(() => db.$disconnect());

  it("classifies a second active year as an active-year conflict", async () => {
    const school = await makeSchool();
    await makeYear(school.id, { label: "2026-2027", isActive: true });
    const err = await caught(() => makeYear(school.id, { label: "2027-2028", isActive: true }));
    expect(err).toMatchObject({ code: "P2002" });
    expect(isActiveYearConflict(err)).toBe(true);
    expect(isLabelConflict(err)).toBe(false);
  });

  it("classifies a duplicate (schoolId, label) as a label conflict", async () => {
    const school = await makeSchool();
    await makeYear(school.id, { label: "2026-2027", isActive: false });
    const err = await caught(() => makeYear(school.id, { label: "2026-2027", isActive: false }));
    expect(err).toMatchObject({ code: "P2002" });
    expect(isLabelConflict(err)).toBe(true);
    expect(isActiveYearConflict(err)).toBe(false);
  });
});
