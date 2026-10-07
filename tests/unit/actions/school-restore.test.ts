import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_ACTIONS, SECURITY_AUDIT_ACTIONS } from "@/lib/audit-actions";

/**
 * `restoreSchool` — the Super Admin's way back from `deleteSchool`.
 *
 * Pinned: it is Super-Admin-only, it only touches a school that is actually
 * removed, it clears `deletedAt` but leaves the school switched OFF, and it is
 * audited and revalidated the way the removal is.
 */

const schoolFindFirst = vi.fn();
const schoolUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { school: { findFirst: schoolFindFirst, update: schoolUpdate } },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: (...a: unknown[]) => requireUser(...a) }));
vi.mock("@/lib/auth/district-scope", () => ({ requireAdminScope: vi.fn(), loadSchoolInScope: vi.fn() }));
vi.mock("@/lib/auth/identity", () => ({ createIdentity: vi.fn(), setPassword: vi.fn(), setRole: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/cache/unstable", () => ({ cachedQuery: vi.fn() }));
vi.mock("@/lib/settings/system-settings", () => ({ demoSchoolFilter: vi.fn() }));
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: vi.fn() }));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", async () => {
  const actions = await import("@/lib/audit-actions");
  return { writeAudit: (...a: unknown[]) => writeAudit(...a), AUDIT_ACTIONS: actions.AUDIT_ACTIONS };
});

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a), revalidateTag: vi.fn() }));

const revalidateSchoolsList = vi.fn();
const revalidateSchoolDashboard = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolsList: (...a: unknown[]) => revalidateSchoolsList(...a),
  revalidateSchoolDashboard: (...a: unknown[]) => revalidateSchoolDashboard(...a),
}));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-REF") }));

const { restoreSchool } = await import("@/lib/actions/school");

const ADMIN = { id: "admin-1", role: "SUPER_ADMIN" };
const SCHOOL_ID = "school-1";

function form(id?: string): FormData {
  const fd = new FormData();
  if (id !== undefined) fd.set("id", id);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(ADMIN);
  schoolFindFirst.mockResolvedValue({ id: SCHOOL_ID, name: "Camarin ES" });
  schoolUpdate.mockResolvedValue({});
  writeAudit.mockResolvedValue(undefined);
});

describe("restoreSchool", () => {
  it("clears deletedAt, leaves the school switched off, audits and revalidates", async () => {
    const res = await restoreSchool(form(SCHOOL_ID));

    expect(res).toBeUndefined();
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
    expect(schoolFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SCHOOL_ID, deletedAt: { not: null } } })
    );
    expect(schoolUpdate).toHaveBeenCalledWith({
      where: { id: SCHOOL_ID },
      data: { deletedAt: null, isActive: false },
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ADMIN.id,
        schoolId: SCHOOL_ID,
        action: "SCHOOL_RESTORE",
        resource: "School",
        resourceId: SCHOOL_ID,
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/management/schools");
    expect(revalidateSchoolsList).toHaveBeenCalled();
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
  });

  it("refuses a school that is not removed (or does not exist) without writing", async () => {
    schoolFindFirst.mockResolvedValue(null);

    const res = await restoreSchool(form(SCHOOL_ID));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(schoolUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a missing id", async () => {
    const res = await restoreSchool(form());

    expect(res).toMatchObject({ ok: false });
    expect(schoolFindFirst).not.toHaveBeenCalled();
    expect(schoolUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when the caller is not a Super Admin", async () => {
    requireUser.mockRejectedValue(new Error("redirect"));

    const res = await restoreSchool(form(SCHOOL_ID));

    expect(res).toMatchObject({ ok: false });
    expect(schoolUpdate).not.toHaveBeenCalled();
  });

  it("is a security audit action, like the removal it reverses", () => {
    expect(SECURITY_AUDIT_ACTIONS).toContain(AUDIT_ACTIONS.SCHOOL_DELETE);
    expect(SECURITY_AUDIT_ACTIONS).toContain(AUDIT_ACTIONS.SCHOOL_RESTORE);
  });
});
