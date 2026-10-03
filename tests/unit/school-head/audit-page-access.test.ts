import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/school-head/audit` follows `/admin/audit` for a Super Admin: Developer
 * allowed, Division Admin gets the same `notFound()`. A School Head keeps
 * their own school's audit page. The refusal must land before the school view
 * resolves, so no ADMIN_SCHOOL_VIEW row is written for a refused admin.
 */

const requireUser = vi.fn();
const resolveSchoolHeadView = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock("@/lib/school-head/view", () => ({
  resolveSchoolHeadView: (...a: unknown[]) => resolveSchoolHeadView(...a),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const { default: SchoolAuditPage } = await import("@/app/school-head/(app)/audit/page");

const run = () => SchoolAuditPage({ searchParams: Promise.resolve({ schoolId: "school-1" }) });

describe("School Head audit page access", () => {
  beforeEach(() => {
    requireUser.mockReset();
    resolveSchoolHeadView.mockReset();
    resolveSchoolHeadView.mockResolvedValue({
      user: { id: "u" },
      view: { schoolId: "school-1", schoolName: null, isSuperAdminView: false },
    });
  });

  it("refuses a Division Admin before resolving the school view", async () => {
    requireUser.mockResolvedValue({ id: "a", role: "SUPER_ADMIN", adminTier: "DIVISION" });
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(resolveSchoolHeadView).not.toHaveBeenCalled();
  });

  it("refuses a Super Admin with no tier (reads as Division)", async () => {
    requireUser.mockResolvedValue({ id: "a", role: "SUPER_ADMIN", adminTier: null });
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(resolveSchoolHeadView).not.toHaveBeenCalled();
  });

  it("allows a Developer Admin", async () => {
    requireUser.mockResolvedValue({ id: "a", role: "SUPER_ADMIN", adminTier: "DEVELOPER" });
    await expect(run()).resolves.toBeTruthy();
    expect(resolveSchoolHeadView).toHaveBeenCalled();
  });

  it("allows a School Head", async () => {
    requireUser.mockResolvedValue({ id: "h", role: "SCHOOL_HEAD", adminTier: null });
    await expect(run()).resolves.toBeTruthy();
    expect(resolveSchoolHeadView).toHaveBeenCalled();
  });
});
