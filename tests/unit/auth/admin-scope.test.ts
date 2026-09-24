import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * District admin scope (docs/specs/district-admin.md 3.4, T1 and T2).
 *
 * A district admin seeing a school outside their districts is the same class of
 * bug as one school reading another's learners, one level up. Every assertion
 * here is written to fail if the check it guards is removed:
 *
 * - Assignment rows grant scope only to DISTRICT_ADMIN (I1).
 * - The district filter and the demo exclusion are in the WHERE (I6, I10).
 * - Out of scope reads exactly like missing, and is recorded as `crossTenant`
 *   (I7).
 * - The Super Admin reaches the division through an explicit branch, and any
 *   other role is refused before a single assignment is read (I8).
 */

const assignmentFindMany = vi.fn();
const schoolFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    districtAdminAssignment: {
      get findMany() {
        return assignmentFindMany;
      },
    },
    school: {
      get findFirst() {
        return schoolFindFirst;
      },
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

import {
  adminScopeFor,
  assertSchoolInScope,
  resolveSummaryScope,
  schoolWhereForScope,
  scopeCacheKey,
  type AdminScope,
} from "@/lib/auth/admin-scope";
import { AppError } from "@/lib/errors/app-error";

const { requireAdminScope, loadSchoolInScope } = await import("@/lib/auth/district-scope");

const ALABEL: AdminScope = { kind: "districts", districts: ["Alabel 1", "Alabel 2"] };
const DIVISION: AdminScope = { kind: "division" };

/** Run `fn` and return the AppError it threw, failing the test if it did not. */
async function thrown(fn: () => unknown): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error("expected an AppError to be thrown");
}

function expectCrossTenantNotFound(err: AppError) {
  expect(err.code).toBe("NOT_FOUND");
  expect(err.context.crossTenant).toBe(true);
  expect(err.severity).toBe("security");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adminScopeFor (T1, I1)", () => {
  it("gives a Super Admin the whole division", () => {
    expect(adminScopeFor("SUPER_ADMIN", [])).toEqual({ kind: "division" });
  });

  it("gives a Super Admin the division even when stray assignment rows exist", () => {
    expect(adminScopeFor("SUPER_ADMIN", ["Glan 1"])).toEqual({ kind: "division" });
  });

  it("gives a district admin their districts, sorted and deduplicated", () => {
    expect(adminScopeFor("DISTRICT_ADMIN", ["Alabel 2", "Alabel 1", "Alabel 2"])).toEqual({
      kind: "districts",
      districts: ["Alabel 1", "Alabel 2"],
    });
  });

  it("gives a district admin with no assignments an empty scope, not the division", () => {
    expect(adminScopeFor("DISTRICT_ADMIN", [])).toEqual({ kind: "districts", districts: [] });
  });

  it("gives School Heads and teachers no scope, whatever rows exist for them", () => {
    expect(adminScopeFor("SCHOOL_HEAD", ["Alabel 1"])).toBeNull();
    expect(adminScopeFor("TEACHER", ["Alabel 1"])).toBeNull();
  });
});

describe("schoolWhereForScope (T1, I6, I10)", () => {
  it("filters a district scope by district, excludes demo and deleted schools", () => {
    expect(schoolWhereForScope(ALABEL)).toEqual({
      deletedAt: null,
      isDemo: false,
      district: { in: ["Alabel 1", "Alabel 2"] },
    });
  });

  it("fails closed for an admin with no assignments", () => {
    expect(schoolWhereForScope({ kind: "districts", districts: [] })).toMatchObject({
      district: { in: [] },
    });
  });

  it("has no district key for the division", () => {
    const where = schoolWhereForScope(DIVISION);
    expect(where).toEqual({ deletedAt: null });
    expect(where).not.toHaveProperty("district");
  });
});

describe("assertSchoolInScope (T2, I7)", () => {
  it("lets an in-scope school through", () => {
    expect(() =>
      assertSchoolInScope(ALABEL, { district: "Alabel 2", isDemo: false })
    ).not.toThrow();
  });

  it("refuses a school in another district as NOT_FOUND, marked crossTenant", async () => {
    expectCrossTenantNotFound(
      await thrown(() => assertSchoolInScope(ALABEL, { district: "Glan 1", isDemo: false }))
    );
  });

  it("refuses a school with no district", async () => {
    expectCrossTenantNotFound(
      await thrown(() => assertSchoolInScope(ALABEL, { district: null, isDemo: false }))
    );
  });

  it("refuses a demo school even when its district is assigned", async () => {
    expectCrossTenantNotFound(
      await thrown(() => assertSchoolInScope(ALABEL, { district: "Alabel 1", isDemo: true }))
    );
  });

  it("does not match districts by case — drift fails closed", async () => {
    expectCrossTenantNotFound(
      await thrown(() => assertSchoolInScope(ALABEL, { district: "alabel 1", isDemo: false }))
    );
  });

  it("uses the same user message as a missing school", async () => {
    const outOfScope = await thrown(() =>
      assertSchoolInScope(ALABEL, { district: "Glan 1", isDemo: false })
    );
    const missing = await thrown(() => assertSchoolInScope(ALABEL, null));
    expect(outOfScope.message).toBe(missing.message);
    expect(missing.code).toBe("NOT_FOUND");
  });

  it("lets the division see a school in any district", () => {
    expect(() =>
      assertSchoolInScope(DIVISION, { district: "Glan 1", isDemo: false })
    ).not.toThrow();
  });
});

describe("resolveSummaryScope (T2)", () => {
  it("refuses a district outside the admin's assignments as NOT_FOUND", async () => {
    expectCrossTenantNotFound(
      await thrown(() => resolveSummaryScope(ALABEL, { district: "Glan 1" }))
    );
  });

  it("refuses an out-of-scope district even when a school is also named", async () => {
    expectCrossTenantNotFound(
      await thrown(() => resolveSummaryScope(ALABEL, { district: "Glan 1", schoolId: "s-1" }))
    );
  });

  it("narrows to one assigned district", () => {
    expect(resolveSummaryScope(ALABEL, { district: "Alabel 2" })).toEqual({
      kind: "districts",
      districts: ["Alabel 2"],
    });
  });

  it("gives a district admin their own districts when nothing is requested, never `all`", () => {
    expect(resolveSummaryScope(ALABEL, {})).toEqual({
      kind: "districts",
      districts: ["Alabel 1", "Alabel 2"],
    });
    expect(resolveSummaryScope(ALABEL, { district: "", schoolId: "" })).toEqual({
      kind: "districts",
      districts: ["Alabel 1", "Alabel 2"],
    });
  });

  it("gives the division `all`, and any district it asks for", () => {
    expect(resolveSummaryScope(DIVISION, {})).toEqual({ kind: "all" });
    expect(resolveSummaryScope(DIVISION, { district: "Glan 1" })).toEqual({
      kind: "districts",
      districts: ["Glan 1"],
    });
  });

  it("passes a requested school through for loadSchoolInScope to check", () => {
    expect(resolveSummaryScope(ALABEL, { schoolId: "s-1" })).toEqual({
      kind: "school",
      schoolId: "s-1",
    });
  });
});

describe("scopeCacheKey", () => {
  it("keys the same district set the same way whatever the order", () => {
    expect(scopeCacheKey({ kind: "districts", districts: ["B", "A"] }, false)).toBe(
      scopeCacheKey({ kind: "districts", districts: ["A", "B"] }, false)
    );
  });

  it("never lets a district admin's view share a key with the division's", () => {
    const daAll = resolveSummaryScope(ALABEL, {});
    expect(scopeCacheKey(daAll, false)).not.toBe(scopeCacheKey(DIVISION, false));
    expect(scopeCacheKey(daAll, false)).not.toBe(scopeCacheKey({ kind: "all" }, false));
  });

  it("separates different district sets, demo on and off, and schools", () => {
    const keys = [
      scopeCacheKey({ kind: "districts", districts: ["A"] }, false),
      scopeCacheKey({ kind: "districts", districts: ["A", "B"] }, false),
      scopeCacheKey({ kind: "districts", districts: ["A,B"] }, false),
      scopeCacheKey(DIVISION, false),
      scopeCacheKey(DIVISION, true),
      scopeCacheKey({ kind: "school", schoolId: "s-1" }, false),
      scopeCacheKey({ kind: "school", schoolId: "s-2" }, false),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("requireAdminScope (T1, I8)", () => {
  it("gives a Super Admin the division without reading assignments", async () => {
    requireUser.mockResolvedValue({ id: "sa-1", role: "SUPER_ADMIN", schoolId: null });

    const { scope } = await requireAdminScope();

    expect(scope).toEqual({ kind: "division" });
    expect(assignmentFindMany).not.toHaveBeenCalled();
  });

  it("gives a district admin the districts assigned to them, read by their own id", async () => {
    requireUser.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN", schoolId: null });
    assignmentFindMany.mockResolvedValue([{ district: "Alabel 2" }, { district: "Alabel 1" }]);

    const { user, scope } = await requireAdminScope();

    expect(user.id).toBe("da-1");
    expect(scope).toEqual({ kind: "districts", districts: ["Alabel 1", "Alabel 2"] });
    expect(assignmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "da-1" } })
    );
  });

  it("asks requireUser for exactly the two admin roles", async () => {
    requireUser.mockResolvedValue({ id: "sa-1", role: "SUPER_ADMIN", schoolId: null });

    await requireAdminScope();

    expect(requireUser).toHaveBeenCalledWith(["SUPER_ADMIN", "DISTRICT_ADMIN"], false);
  });

  it.each(["SCHOOL_HEAD", "TEACHER"])(
    "refuses a %s with AUTH_FORBIDDEN and never reads assignments",
    async (role) => {
      requireUser.mockResolvedValue({ id: "u-1", role, schoolId: "school-1" });

      const err = await thrown(() => requireAdminScope());

      expect(err.code).toBe("AUTH_FORBIDDEN");
      expect(assignmentFindMany).not.toHaveBeenCalled();
    }
  );
});

describe("loadSchoolInScope (I6, I7)", () => {
  it("puts the district filter in the WHERE, next to the id", async () => {
    schoolFindFirst.mockResolvedValueOnce({ id: "s-1", name: "Alabel CES" });

    const school = await loadSchoolInScope(ALABEL, "s-1", { id: true, name: true });

    expect(school).toEqual({ id: "s-1", name: "Alabel CES" });
    expect(schoolFindFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "s-1" }, schoolWhereForScope(ALABEL)] },
      select: { id: true, name: true },
    });
  });

  it("gives an out-of-scope school NOT_FOUND marked crossTenant", async () => {
    schoolFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "s-glan" });

    expectCrossTenantNotFound(
      await thrown(() => loadSchoolInScope(ALABEL, "s-glan", { id: true }))
    );
  });

  it("gives a missing school the same message, not marked crossTenant", async () => {
    schoolFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const missing = await thrown(() => loadSchoolInScope(ALABEL, "s-none", { id: true }));

    schoolFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "s-glan" });
    const outOfScope = await thrown(() => loadSchoolInScope(ALABEL, "s-glan", { id: true }));

    expect(missing.code).toBe("NOT_FOUND");
    expect(missing.context.crossTenant).toBe(false);
    expect(missing.message).toBe(outOfScope.message);
  });

  it("lets the division load any live school", async () => {
    schoolFindFirst.mockResolvedValueOnce({ id: "s-glan" });

    await loadSchoolInScope(DIVISION, "s-glan", { id: true });

    expect(schoolFindFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "s-glan" }, { deletedAt: null }] },
      select: { id: true },
    });
  });
});
