import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `resolveMosyAccess`: who may open the MOSY Report and over which sections.
 * The predicate `advisoryRosterDenial` is real; Prisma and the placements
 * read are faked.
 */

const profileFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { teacherProfile: { findFirst: (a: unknown) => profileFindFirst(a) } },
}));

const getAdvisoryPlacements = vi.fn();
vi.mock("@/lib/teachers/advisory", () => ({
  getAdvisoryPlacements: (u: unknown) => getAdvisoryPlacements(u),
}));

const { resolveMosyAccess } = await import("@/lib/aral/mosy-access");

const TEACHER = { id: "t-1", role: "TEACHER", schoolId: "school-1" };
const placement = (sectionId: string) => ({ sectionId });

beforeEach(() => {
  vi.clearAllMocks();
  profileFindFirst.mockResolvedValue({ designation: "Teacher I", advisoryMode: "DEFAULT" });
  getAdvisoryPlacements.mockResolvedValue([placement("s-1")]);
});

describe("resolveMosyAccess", () => {
  it("a Super Admin gets the whole school and no lookups", async () => {
    const res = await resolveMosyAccess({ id: "sa", role: "SUPER_ADMIN", schoolId: "school-1" });
    expect(res).toEqual({ ok: true, sectionIds: null });
    expect(profileFindFirst).not.toHaveBeenCalled();
    expect(getAdvisoryPlacements).not.toHaveBeenCalled();
  });

  it("a DepEd adviser gets exactly their advisory section ids", async () => {
    getAdvisoryPlacements.mockResolvedValue([placement("s-1"), placement("s-2")]);
    expect(await resolveMosyAccess(TEACHER)).toEqual({ ok: true, sectionIds: ["s-1", "s-2"] });
    expect(getAdvisoryPlacements).toHaveBeenCalledWith({ id: "t-1", schoolId: "school-1" });
  });

  it("keeps the tenant in the profile lookup", async () => {
    await resolveMosyAccess(TEACHER);
    expect(profileFindFirst.mock.calls[0]![0]).toMatchObject({
      where: { userId: "t-1", user: { schoolId: "school-1" } },
    });
  });

  it("a Non-DepEd ARAL Volunteer is refused as volunteer", async () => {
    const { ARAL_VOLUNTEER_DESIGNATION } = await import("@/lib/validators/profile.schema");
    profileFindFirst.mockResolvedValue({
      designation: ARAL_VOLUNTEER_DESIGNATION,
      advisoryMode: "DEFAULT",
    });
    expect(await resolveMosyAccess(TEACHER)).toEqual({
      ok: false,
      reason: "volunteer",
      message: "MOSY Report is for DepEd teachers who advise a section.",
    });
    expect(getAdvisoryPlacements).not.toHaveBeenCalled();
  });

  it("a floating teacher is refused as floating", async () => {
    profileFindFirst.mockResolvedValue({ designation: "Teacher I", advisoryMode: "FLOATING" });
    const res = await resolveMosyAccess(TEACHER);
    expect(res).toMatchObject({ ok: false, reason: "floating" });
    expect(getAdvisoryPlacements).not.toHaveBeenCalled();
  });

  it("a DepEd teacher with no advisory section is refused as no_advisory", async () => {
    getAdvisoryPlacements.mockResolvedValue([]);
    const res = await resolveMosyAccess(TEACHER);
    expect(res).toMatchObject({ ok: false, reason: "no_advisory" });
    expect((res as { message: string }).message.length).toBeGreaterThan(0);
  });
});
