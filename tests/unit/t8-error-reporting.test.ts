import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T8: failures that used to be log-only now reach the admin error log, and the
 * TEACHER_REGISTER audit row no longer carries the teacher's email.
 */

const reportError = vi.fn(() => "ref-1");
vi.mock("@/lib/errors/report", () => ({ reportError: (...a: unknown[]) => reportError(...(a as [])) }));

const executeRaw = vi.fn();
const userFindUnique = vi.fn();
const userCreate = vi.fn();
const notificationFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      create: (...a: unknown[]) => userCreate(...a),
    },
    notification: {
      findMany: (...a: unknown[]) => notificationFindMany(...a),
      updateMany: vi.fn(),
    },
    learner: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "t-1", role: "TEACHER", schoolId: "s-1" }),
}));

const updateUserById = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById } } }),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, writeAudit: (...a: unknown[]) => writeAudit(...a) };
});
vi.mock("@/lib/auth/last-login", () => ({ recordLastLogin: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateAdminDashboard: vi.fn(),
  revalidateSchoolDashboard: vi.fn(),
}));

const { runDailyRetention } = await import("@/lib/retention/purge");
const { fetchAralAssignmentAlerts, fetchUnlockAlerts } = await import("@/lib/actions/notifications");
const { completeTeacherAuthAfterVerify } = await import("@/lib/auth/teacher-registration");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("A36 retention failures", () => {
  it("reports each failed rule and sets retentionFailed", async () => {
    executeRaw.mockRejectedValueOnce(new Error("statement timeout")).mockResolvedValue(0);
    const report = await runDailyRetention(new Date("2026-09-30T00:00:00Z"));
    expect(report.retentionFailed).toBe(true);
    expect(report.notificationsRead).toEqual({ status: "failed" });
    expect(reportError).toHaveBeenCalledTimes(1);
    const [err] = reportError.mock.calls[0] as unknown as [{ code: string; severity: string }];
    expect(err.severity).toBe("system");
  });

  it("omits retentionFailed and reports nothing on a clean run", async () => {
    executeRaw.mockResolvedValue(0);
    const report = await runDailyRetention(new Date("2026-09-30T00:00:00Z"));
    expect(report.retentionFailed).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("A39 alert read failures", () => {
  it("still returns [] but reports when the ARAL alert read fails", async () => {
    notificationFindMany.mockRejectedValue(new Error("db down"));
    await expect(fetchAralAssignmentAlerts()).resolves.toEqual([]);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("still returns [] but reports when the unlock alert read fails", async () => {
    notificationFindMany.mockRejectedValue(new Error("db down"));
    await expect(fetchUnlockAlerts()).resolves.toEqual([]);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("teacher registration", () => {
  const params = {
    authId: "auth-1",
    email: "Teacher@Example.com",
    schoolId: "s-1",
    intent: "register" as const,
    names: { firstName: "Ana", lastName: "Cruz" },
  };

  beforeEach(() => {
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "u-1" });
  });

  it("A40: reports an app_metadata failure and still succeeds", async () => {
    updateUserById.mockResolvedValue({ error: { message: "boom" } });
    const result = await completeTeacherAuthAfterVerify(params);
    expect(result).toEqual({ ok: true, outcome: "pending" });
    expect(reportError).toHaveBeenCalledTimes(1);
    const [err] = reportError.mock.calls[0] as unknown as [{ severity: string }];
    expect(err.severity).toBe("system");
  });

  it("A40: reports when the admin client throws and still succeeds", async () => {
    updateUserById.mockRejectedValue(new Error("no key"));
    const result = await completeTeacherAuthAfterVerify(params);
    expect(result).toEqual({ ok: true, outcome: "pending" });
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("does not report when app_metadata updates cleanly", async () => {
    updateUserById.mockResolvedValue({ error: null });
    await completeTeacherAuthAfterVerify(params);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("A8: TEACHER_REGISTER audit metadata has no email", async () => {
    updateUserById.mockResolvedValue({ error: null });
    await completeTeacherAuthAfterVerify(params);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const [arg] = writeAudit.mock.calls[0] as unknown as [{ metadata: Record<string, unknown> }];
    expect(arg.metadata).not.toHaveProperty("email");
    expect(JSON.stringify(arg.metadata)).not.toMatch(/example\.com/i);
    expect(arg.metadata.method).toBe("self_register");
  });
});
