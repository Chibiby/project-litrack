import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The sidebar's Support badge poll: admin consoles only, each admin sees the
 * count for their own scope, never cached by the browser.
 */

const requireAdminScope = vi.fn();
vi.mock("@/lib/auth/district-scope", () => ({ requireAdminScope: () => requireAdminScope() }));
const getAdminNavBadges = vi.fn();
const getDistrictNavBadges = vi.fn();
vi.mock("@/lib/nav/badges", () => ({
  getAdminNavBadges: () => getAdminNavBadges(),
  getDistrictNavBadges: (...a: unknown[]) => getDistrictNavBadges(...a),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-REF") }));

const badgesRoute = await import("@/app/api/nav/badges/route");
const get = () => badgesRoute.GET(new NextRequest("http://localhost/api/nav/badges"));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/nav/badges", () => {
  it("gives a Super Admin the division count", async () => {
    requireAdminScope.mockResolvedValue({ user: { id: "a1", role: "SUPER_ADMIN" }, scope: { kind: "division" } });
    getAdminNavBadges.mockResolvedValue({ "admin-support": 5 });
    const res = await get();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: { "admin-support": 5 } });
    expect(getDistrictNavBadges).not.toHaveBeenCalled();
  });

  it("gives a district admin their districts' count", async () => {
    const scope = { kind: "districts", districts: ["North"] };
    requireAdminScope.mockResolvedValue({ user: { id: "d1", role: "DISTRICT_ADMIN" }, scope });
    getDistrictNavBadges.mockResolvedValue({ "district-support": 2 });
    expect(await (await get()).json()).toEqual({ ok: true, data: { "district-support": 2 } });
    expect(getDistrictNavBadges).toHaveBeenCalledWith({ id: "d1", role: "DISTRICT_ADMIN" }, scope);
    expect(getAdminNavBadges).not.toHaveBeenCalled();
  });

  it("counts nothing for anyone the scope check refuses", async () => {
    requireAdminScope.mockRejectedValue(new Error("forbidden"));
    const res = await get();
    expect(res.ok).toBe(false);
    expect(getAdminNavBadges).not.toHaveBeenCalled();
    expect(getDistrictNavBadges).not.toHaveBeenCalled();
  });
});
