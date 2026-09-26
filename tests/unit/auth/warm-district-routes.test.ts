import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `warmDistrictRoutes` (src/lib/auth/warm-routes.ts) — the login-time warmer
 * for `/district`.
 *
 * What must hold:
 * - For a DISTRICT_ADMIN with at least one district, it resolves the scope
 *   via `loadAdminScopeForUser` and calls `resolveScopeSchools` plus the four
 *   `SUMMARY_FACETS` loads (learners, reading-behavior, attendance,
 *   compliance) and `getDistrictNotifications`, with the SAME arguments
 *   `src/app/district/page.tsx` uses: `level: "overall"`, `month` = the
 *   current month key, and the attendance facet's `from`/`to` both equal to
 *   that same month.
 * - A DISTRICT_ADMIN with zero assigned districts warms nothing at all — they
 *   see `NoDistrictsState`, not the dashboard tiles.
 * - A rejecting leaf, or a rejecting `loadAdminScopeForUser`, never throws out
 *   of `warmDistrictRoutes` (it must never fail a login).
 */

const loadAdminScopeForUser = vi.fn();
const isDemoVisible = vi.fn();
const resolveScopeSchools = vi.fn();
const getDistrictNotifications = vi.fn();
const learnersLoad = vi.fn();
const readingBehaviorLoad = vi.fn();
const attendanceLoad = vi.fn();
const complianceLoad = vi.fn();

vi.mock("@/lib/auth/district-scope", () => ({
  get loadAdminScopeForUser() {
    return loadAdminScopeForUser;
  },
}));
vi.mock("@/lib/demo/session", () => ({
  get isDemoVisible() {
    return isDemoVisible;
  },
}));
vi.mock("@/lib/summary/scope-schools", () => ({
  get resolveScopeSchools() {
    return resolveScopeSchools;
  },
}));
vi.mock("@/lib/district/notifications", () => ({
  get getDistrictNotifications() {
    return getDistrictNotifications;
  },
}));
vi.mock("@/lib/summary/facets", () => ({
  SUMMARY_FACETS: {
    learners: { load: (...a: unknown[]) => learnersLoad(...a) },
    "reading-behavior": { load: (...a: unknown[]) => readingBehaviorLoad(...a) },
    attendance: { load: (...a: unknown[]) => attendanceLoad(...a) },
    compliance: { load: (...a: unknown[]) => complianceLoad(...a) },
  },
}));

// The dashboard aggregate warmers and the teacher overview are not exercised
// by this file's tests, but `warm-routes.ts` imports them at module scope, so
// they need a mock that never throws on import.
vi.mock("@/lib/dashboard/aggregates", () => ({
  getAdminActivitySeries: vi.fn(),
  getAdminMetricCounts: vi.fn(),
  getAdminRecentSchools: vi.fn(),
  getSchoolHeadCharts: vi.fn(),
  getSchoolHeadMetricCounts: vi.fn(),
  getSchoolHeadRecentActivity: vi.fn(),
  getTeacherShellGrades: vi.fn(),
}));
vi.mock("@/lib/dashboard/teacher-overview", () => ({
  getTeacherOverview: vi.fn(),
}));

import { warmDistrictRoutes } from "@/lib/auth/warm-routes";

const DISTRICT_ADMIN = { id: "da-1", role: "DISTRICT_ADMIN" as const };

// A fixed instant so the expected month key is deterministic, matching
// whatever `formatLocalDateKey(schoolToday())` + `monthKeyOf` computes for
// "now" inside the module under test.
const NOW = new Date("2026-09-26T04:00:00.000Z");
const EXPECTED_MONTH = "2026-09";

beforeEach(() => {
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  isDemoVisible.mockResolvedValue(false);
  resolveScopeSchools.mockResolvedValue([]);
  getDistrictNotifications.mockResolvedValue([]);
  learnersLoad.mockResolvedValue({});
  readingBehaviorLoad.mockResolvedValue({});
  attendanceLoad.mockResolvedValue({});
  complianceLoad.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("warmDistrictRoutes", () => {
  it("warms scope schools, all four facets and notifications with the page's own arguments", async () => {
    loadAdminScopeForUser.mockResolvedValue({ kind: "districts", districts: ["Alabel 1"] });

    await warmDistrictRoutes(DISTRICT_ADMIN);

    expect(loadAdminScopeForUser).toHaveBeenCalledWith(DISTRICT_ADMIN);
    expect(resolveScopeSchools).toHaveBeenCalledWith(
      { kind: "districts", districts: ["Alabel 1"] },
      false
    );

    const summaryScope = { kind: "districts", districts: ["Alabel 1"] };
    expect(learnersLoad).toHaveBeenCalledWith(summaryScope, { level: "overall" });
    expect(readingBehaviorLoad).toHaveBeenCalledWith(summaryScope, {
      level: "overall",
      month: EXPECTED_MONTH,
    });
    expect(attendanceLoad).toHaveBeenCalledWith(summaryScope, {
      level: "overall",
      from: EXPECTED_MONTH,
      to: EXPECTED_MONTH,
    });
    expect(complianceLoad).toHaveBeenCalledWith(summaryScope, { level: "overall" });

    expect(getDistrictNotifications).toHaveBeenCalledWith(DISTRICT_ADMIN, {
      kind: "districts",
      districts: ["Alabel 1"],
    });
  });

  it("warms the division scope for a Super Admin", async () => {
    const superAdmin = { id: "sa-1", role: "SUPER_ADMIN" as const };
    loadAdminScopeForUser.mockResolvedValue({ kind: "division" });

    await warmDistrictRoutes(superAdmin);

    expect(resolveScopeSchools).toHaveBeenCalledWith({ kind: "division" }, false);
    expect(learnersLoad).toHaveBeenCalledWith({ kind: "all" }, { level: "overall" });
  });

  it("warms nothing for a DISTRICT_ADMIN with zero assigned districts", async () => {
    loadAdminScopeForUser.mockResolvedValue({ kind: "districts", districts: [] });

    await warmDistrictRoutes(DISTRICT_ADMIN);

    expect(resolveScopeSchools).not.toHaveBeenCalled();
    expect(learnersLoad).not.toHaveBeenCalled();
    expect(readingBehaviorLoad).not.toHaveBeenCalled();
    expect(attendanceLoad).not.toHaveBeenCalled();
    expect(complianceLoad).not.toHaveBeenCalled();
    expect(getDistrictNotifications).not.toHaveBeenCalled();
  });

  it("never throws when loadAdminScopeForUser rejects", async () => {
    loadAdminScopeForUser.mockRejectedValue(new Error("db down"));

    await expect(warmDistrictRoutes(DISTRICT_ADMIN)).resolves.toBeUndefined();
    expect(resolveScopeSchools).not.toHaveBeenCalled();
  });

  it("never throws when a leaf load rejects, and still calls the others", async () => {
    loadAdminScopeForUser.mockResolvedValue({ kind: "districts", districts: ["Alabel 1"] });
    learnersLoad.mockRejectedValue(new Error("query failed"));

    await expect(warmDistrictRoutes(DISTRICT_ADMIN)).resolves.toBeUndefined();
    expect(readingBehaviorLoad).toHaveBeenCalled();
    expect(attendanceLoad).toHaveBeenCalled();
    expect(complianceLoad).toHaveBeenCalled();
    expect(getDistrictNotifications).toHaveBeenCalled();
  });
});
