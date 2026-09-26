import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `loadAdminScopeForUser` (src/lib/auth/district-scope.ts) — the scope-from-
 * user resolver split out for the login-time warmer, which runs before the
 * session cookie is readable back through `requireUser`/`getCurrentUser`.
 *
 * - SUPER_ADMIN -> `{ kind: "division" }`, no query.
 * - DISTRICT_ADMIN -> `{ kind: "districts", districts }` built from that
 *   user's `DistrictAdminAssignment` rows (sorted, deduplicated by
 *   `adminScopeFor`).
 * - Any other role -> throws AUTH_FORBIDDEN (a School Head or teacher that
 *   somehow reached this call is refused, not handed a scope).
 */

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    districtAdminAssignment: {
      get findMany() {
        return findMany;
      },
    },
  },
}));

// `requireUser` is not exercised by these tests (only `loadAdminScopeForUser`
// is), but `district-scope.ts` imports it at module scope for
// `requireAdminScope`'s own `cache()`-wrapped loader.
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(),
}));

const { loadAdminScopeForUser } = await import("@/lib/auth/district-scope");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadAdminScopeForUser", () => {
  it("resolves SUPER_ADMIN to the whole division, without a query", async () => {
    const scope = await loadAdminScopeForUser({ id: "sa-1", role: "SUPER_ADMIN" });
    expect(scope).toEqual({ kind: "division" });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("resolves DISTRICT_ADMIN to their assigned districts, sorted and deduplicated", async () => {
    findMany.mockResolvedValue([
      { district: "Alabel 2" },
      { district: "Alabel 1" },
      { district: "Alabel 1" },
    ]);

    const scope = await loadAdminScopeForUser({ id: "da-1", role: "DISTRICT_ADMIN" });

    expect(scope).toEqual({ kind: "districts", districts: ["Alabel 1", "Alabel 2"] });
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "da-1" },
      select: { district: true },
    });
  });

  it("resolves a DISTRICT_ADMIN with no assignment rows to an empty district list, not division-wide", async () => {
    findMany.mockResolvedValue([]);

    const scope = await loadAdminScopeForUser({ id: "da-2", role: "DISTRICT_ADMIN" });

    expect(scope).toEqual({ kind: "districts", districts: [] });
  });

  it("throws AUTH_FORBIDDEN for SCHOOL_HEAD", async () => {
    await expect(
      loadAdminScopeForUser({ id: "sh-1", role: "SCHOOL_HEAD" })
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("throws AUTH_FORBIDDEN for TEACHER", async () => {
    await expect(
      loadAdminScopeForUser({ id: "t-1", role: "TEACHER" })
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});
