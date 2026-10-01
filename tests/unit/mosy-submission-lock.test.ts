import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOSY_SUBMISSION_LOCK_KEY } from "@/lib/unlock/constants";

/**
 * The MOSY submission lock. It defaults to LOCKED: only the exact stored value
 * "false" opens it. A missing row and a failed read (`readSetting` degrades both
 * to null) must therefore read as locked.
 */

const findUnique = vi.fn();
const upsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", async () => {
  const actions = await import("@/lib/audit-actions");
  return { writeAudit: (...a: unknown[]) => writeAudit(...a), AUDIT_ACTIONS: actions.AUDIT_ACTIONS };
});

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "REF-1") }));

import { isMosySubmissionLocked } from "@/lib/settings/system-settings";
const { setMosySubmissionLock } = await import("@/lib/actions/submission-locking");

const ADMIN = { id: "admin-1", schoolId: null, role: "SUPER_ADMIN" };

function form(enabled: string): FormData {
  const data = new FormData();
  data.set("enabled", enabled);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(ADMIN);
  upsert.mockResolvedValue({ key: "k", value: "v" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isMosySubmissionLocked", () => {
  it("names the key the reader, the writer and the audit row share", () => {
    expect(MOSY_SUBMISSION_LOCK_KEY).toBe("submissions.mosyLocked");
  });

  it("reads as locked when the row does not exist", async () => {
    findUnique.mockResolvedValue(null);
    expect(await isMosySubmissionLocked()).toBe(true);
    expect(findUnique.mock.calls[0][0]).toMatchObject({ where: { key: MOSY_SUBMISSION_LOCK_KEY } });
  });

  it("reads as locked when the read fails", async () => {
    findUnique.mockRejectedValue(new Error("P2024 pool timeout"));
    expect(await isMosySubmissionLocked()).toBe(true);
  });

  it('reads as unlocked only for the exact value "false"', async () => {
    findUnique.mockResolvedValue({ value: "false" });
    expect(await isMosySubmissionLocked()).toBe(false);
  });

  it("reads as locked for every other value", async () => {
    for (const value of ["true", "FALSE", "off", "0", ""]) {
      findUnique.mockResolvedValue({ value });
      expect(await isMosySubmissionLocked(), value).toBe(true);
    }
  });
});

describe("setMosySubmissionLock", () => {
  it("is Super Admin only", async () => {
    await setMosySubmissionLock(form("true"));
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
  });

  it("a non-admin is stopped before anything is written", async () => {
    requireUser.mockRejectedValue(new Error("redirect"));
    const res = await setMosySubmissionLock(form("false"));
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('writes the literal "false" to open and "true" to lock', async () => {
    await setMosySubmissionLock(form("false"));
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { key: MOSY_SUBMISSION_LOCK_KEY },
      create: { key: MOSY_SUBMISSION_LOCK_KEY, value: "false" },
      update: { value: "false" },
    });
    vi.clearAllMocks();
    requireUser.mockResolvedValue(ADMIN);
    await setMosySubmissionLock(form("on"));
    expect(upsert.mock.calls[0]?.[0]?.update).toEqual({ value: "true" });
  });

  it("refuses a value it does not recognise", async () => {
    const res = await setMosySubmissionLock(form("maybe"));
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("audits under MOSY_SUBMISSION_LOCK_SET without any secret", async () => {
    await setMosySubmissionLock(form("false"));
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      userId: "admin-1",
      schoolId: null,
      action: "MOSY_SUBMISSION_LOCK_SET",
      resource: "SystemSetting",
      resourceId: MOSY_SUBMISSION_LOCK_KEY,
      metadata: { locked: false },
    });
  });

  it("MOSY_SUBMISSION_LOCK_SET is a security audit action, so writeAudit keeps it", async () => {
    const { SECURITY_AUDIT_ACTIONS } = await import("@/lib/audit-actions");
    expect(SECURITY_AUDIT_ACTIONS).toContain("MOSY_SUBMISSION_LOCK_SET");
  });

  it("refreshes the admin pages and the MOSY page", async () => {
    await setMosySubmissionLock(form("false"));
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/admin/school-setup/report-submissions",
        "/teacher/aral/mosy",
      ])
    );
  });
});
