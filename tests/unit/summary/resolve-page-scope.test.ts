import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIVISION_SCHOOLS } from "./raw-fixtures";

/**
 * `resolvePageSummaryScope`: a requested school is checked against the cached
 * division list first (no database read for a school the admin may open). A
 * miss still goes through `loadSchoolInScope`, so an out-of-scope request is
 * refused with the same 404 AND recorded as a cross-tenant security event.
 */

const schoolFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findMany() {
        return schoolFindMany;
      },
    },
  },
}));

vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>) => fn(),
}));

const loadSchoolInScope = vi.fn();
vi.mock("@/lib/auth/district-scope", () => ({
  loadSchoolInScope: (...args: unknown[]) => loadSchoolInScope(...args),
}));

const reportError = vi.fn();
vi.mock("@/lib/errors/report", () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));

const { resolvePageSummaryScope } = await import("@/components/summary/resolve-page-scope");
const { resourceNotFound } = await import("@/lib/errors/app-error");

const ALABEL = { kind: "districts" as const, districts: ["Alabel 1"] };
const DIVISION = { kind: "division" as const };
const CTX = { route: "/district/summary/learners", userId: "da-1" };

beforeEach(() => {
  vi.clearAllMocks();
  schoolFindMany.mockResolvedValue(DIVISION_SCHOOLS);
});

describe("resolvePageSummaryScope", () => {
  it("answers an in-scope school from the cached list, without a database probe", async () => {
    const res = await resolvePageSummaryScope(ALABEL, { schoolId: "sch-bagacay" }, CTX);
    expect(res).toEqual({
      scope: { kind: "school", schoolId: "sch-bagacay" },
      district: null,
      school: { id: "sch-bagacay", name: "Bagacay ES" },
    });
    expect(loadSchoolInScope).not.toHaveBeenCalled();
  });

  it("lets the division open a demo school, as loadSchoolInScope does", async () => {
    const res = await resolvePageSummaryScope(DIVISION, { schoolId: "sch-demo" }, CTX);
    expect(res.school).toEqual({ id: "sch-demo", name: "Demo Sample ES" });
    expect(loadSchoolInScope).not.toHaveBeenCalled();
  });

  it("sends a school in another district to loadSchoolInScope, 404s and records the cross-tenant request", async () => {
    const err = resourceNotFound("School", { crossTenant: true, detail: "outside scope" });
    loadSchoolInScope.mockRejectedValue(err);

    await expect(resolvePageSummaryScope(ALABEL, { schoolId: "sch-glan-ces" }, CTX)).rejects.toBeInstanceOf(NotFound);
    expect(loadSchoolInScope).toHaveBeenCalledWith(ALABEL, "sch-glan-ces", { id: true, name: true });
    expect(reportError).toHaveBeenCalledWith(err, expect.objectContaining({ route: CTX.route, userId: "da-1" }));
  });

  it("sends a demo school requested by a district admin to loadSchoolInScope", async () => {
    loadSchoolInScope.mockRejectedValue(resourceNotFound("School", { crossTenant: true }));
    await expect(resolvePageSummaryScope(ALABEL, { schoolId: "sch-demo" }, CTX)).rejects.toBeInstanceOf(NotFound);
    expect(loadSchoolInScope).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("404s a missing school without a security record", async () => {
    loadSchoolInScope.mockRejectedValue(resourceNotFound("School"));
    await expect(resolvePageSummaryScope(ALABEL, { schoolId: "sch-nope" }, CTX)).rejects.toBeInstanceOf(NotFound);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("finds a school created after the list was cached through the database", async () => {
    loadSchoolInScope.mockResolvedValue({ id: "sch-new", name: "New ES" });
    const res = await resolvePageSummaryScope(ALABEL, { schoolId: "sch-new" }, CTX);
    expect(res.school).toEqual({ id: "sch-new", name: "New ES" });
  });

  it("does not read schools at all for a district or whole-scope view", async () => {
    const res = await resolvePageSummaryScope(ALABEL, { district: "Alabel 1" }, CTX);
    expect(res).toEqual({ scope: { kind: "districts", districts: ["Alabel 1"] }, district: "Alabel 1", school: null });
    expect(schoolFindMany).not.toHaveBeenCalled();
    expect(loadSchoolInScope).not.toHaveBeenCalled();
  });

  it("refuses an out-of-scope district and records it", async () => {
    await expect(resolvePageSummaryScope(ALABEL, { district: "Glan 1" }, CTX)).rejects.toBeInstanceOf(NotFound);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(schoolFindMany).not.toHaveBeenCalled();
  });
});
