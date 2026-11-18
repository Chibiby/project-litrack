import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

/**
 * Self-registration inside and outside the automatic approval window
 * (`completeTeacherAuthAfterVerify`, intent "register", new email).
 */

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const writeAudit = vi.fn();
const getAutoApproveWindow = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      create: (...args: unknown[]) => userCreate(...args),
    },
  },
}));
vi.mock("@/lib/auth/identity", () => ({ setRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: { TEACHER_REGISTER: "TEACHER_REGISTER", TEACHER_APPROVE: "TEACHER_APPROVE" },
}));
vi.mock("@/lib/auth/last-login", () => ({ recordLastLogin: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateAdminDashboard: vi.fn(),
  revalidateSchoolDashboard: vi.fn(),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
vi.mock("@/lib/settings/system-settings", () => ({
  getAutoApproveWindow: () => getAutoApproveWindow(),
}));

const { completeTeacherAuthAfterVerify } = await import("@/lib/auth/teacher-registration");

const params = {
  authId: "auth-1",
  email: "new.teacher@example.com",
  schoolId: "school-1",
  intent: "register" as const,
  names: { firstName: "Ana", lastName: "Reyes" },
};

const hour = 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue(null);
  userCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "user-1",
    ...data,
  }));
});

describe("completeTeacherAuthAfterVerify with the approval window", () => {
  it("approves into the picked school inside the window", async () => {
    getAutoApproveWindow.mockResolvedValue({
      start: new Date(Date.now() - hour),
      end: new Date(Date.now() + hour),
    });

    const result = await completeTeacherAuthAfterVerify(params);

    expect(result).toEqual({ ok: true, outcome: "auto_approved" });
    const data = userCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      schoolId: "school-1",
      approvalStatus: "APPROVED",
      isActive: true,
      profileCompleted: false,
    });
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(data.approvedById).toBeUndefined();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TEACHER_APPROVE",
        metadata: expect.objectContaining({ method: "auto_approve_window" }),
      })
    );
  });

  it("leaves the account pending outside the window", async () => {
    getAutoApproveWindow.mockResolvedValue({
      start: new Date(Date.now() + hour),
      end: new Date(Date.now() + 2 * hour),
    });

    const result = await completeTeacherAuthAfterVerify(params);

    expect(result).toEqual({ ok: true, outcome: "pending" });
    expect(userCreate.mock.calls[0][0].data).toMatchObject({
      approvalStatus: "PENDING",
      isActive: false,
      approvedAt: null,
    });
    expect(writeAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "TEACHER_APPROVE" })
    );
  });

  it("leaves the account pending with no window", async () => {
    getAutoApproveWindow.mockResolvedValue(null);
    const result = await completeTeacherAuthAfterVerify(params);
    expect(result).toEqual({ ok: true, outcome: "pending" });
  });

  it("falls back to pending when the setting cannot be read", async () => {
    getAutoApproveWindow.mockRejectedValue(new AppError("DB_UNAVAILABLE"));

    const result = await completeTeacherAuthAfterVerify(params);

    expect(result).toEqual({ ok: true, outcome: "pending" });
    expect(userCreate.mock.calls[0][0].data.approvalStatus).toBe("PENDING");
    expect(reportError).toHaveBeenCalled();
  });
});
