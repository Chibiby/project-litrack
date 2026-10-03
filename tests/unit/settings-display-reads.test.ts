import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Display-path reads of the lock switches. A failed `SystemSetting` read throws
 * `DB_UNAVAILABLE` from the write-path guards (so a save is never let through),
 * but a page that merely RENDERS lock state must not crash into the error
 * boundary: it degrades to the fail-closed state and reports once.
 */

const findUnique = vi.fn();
const unlockFindMany = vi.fn().mockResolvedValue([]);
const schoolUnlockFindMany = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: (...a: unknown[]) => findUnique(...a) },
    unlockGrant: { findMany: (...a: unknown[]) => unlockFindMany(...a) },
    schoolUnlockGrant: { findMany: (...a: unknown[]) => schoolUnlockFindMany(...a) },
  },
}));

const reportError = vi.fn(() => "REF-1");
vi.mock("@/lib/errors/report", () => ({
  reportError: (...a: unknown[]) => reportError(...(a as [])),
}));

import { AppError } from "@/lib/errors/app-error";
import {
  readForDisplay,
  isMonthlyReadingLevelUnlockedForAllForDisplay,
  isMosySubmissionLocked,
  isMosySubmissionLockedForDisplay,
  isSubmissionLockingEnabled,
  isSubmissionLockingEnabledForDisplay,
} from "@/lib/settings/system-settings";
import { canWriteWindow, readUnlockState } from "@/lib/unlock/grants";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  findUnique.mockRejectedValue(new Error("P2024 pool timeout"));
});

describe("display reads degrade fail-closed on a failed settings read", () => {
  it("MOSY reads as locked and reports once", async () => {
    expect(await isMosySubmissionLockedForDisplay()).toBe(true);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("submission locking reads as enabled and reports", async () => {
    expect(await isSubmissionLockingEnabledForDisplay()).toBe(true);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("reading-level unlock-for-all reads as NOT unlocked and reports", async () => {
    expect(await isMonthlyReadingLevelUnlockedForAllForDisplay()).toBe(false);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("still returns the real value when the read succeeds", async () => {
    findUnique.mockReset();
    findUnique.mockResolvedValue({ value: "false" });
    expect(await isMosySubmissionLockedForDisplay()).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("readUnlockState", () => {
  it("returns the locked state instead of throwing, and reports", async () => {
    const state = await readUnlockState({ userId: "u", schoolId: "s", scope: "TERM_GRADES" });
    expect(state).toEqual({ lockingEnabled: true, unlockedKeys: new Set() });
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("does not query grants after a failed settings read", async () => {
    unlockFindMany.mockClear();
    schoolUnlockFindMany.mockClear();
    await readUnlockState({ userId: "u", schoolId: "s", scope: "TERM_GRADES" });
    expect(unlockFindMany).not.toHaveBeenCalled();
    expect(schoolUnlockFindMany).not.toHaveBeenCalled();
  });
});

describe("display reads rethrow errors that are not DB_UNAVAILABLE", () => {
  it("rejects on a plain Error", async () => {
    const err = new Error("boom");
    await expect(
      readForDisplay(async () => Promise.reject(err), true, "x")
    ).rejects.toBe(err);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("rejects on another AppError code", async () => {
    await expect(
      readForDisplay(async () => Promise.reject(new AppError("NOT_FOUND")), true, "x")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("write-path guards still throw", () => {
  it("isMosySubmissionLocked rejects DB_UNAVAILABLE", async () => {
    await expect(isMosySubmissionLocked()).rejects.toMatchObject({ code: "DB_UNAVAILABLE" });
  });

  it("isSubmissionLockingEnabled rejects DB_UNAVAILABLE", async () => {
    await expect(isSubmissionLockingEnabled()).rejects.toMatchObject({ code: "DB_UNAVAILABLE" });
  });

  it("canWriteWindow rejects rather than opening the window", async () => {
    await expect(
      canWriteWindow({ userId: "u", schoolId: "s", scope: "TERM_GRADES", targetKey: "FIRST" })
    ).rejects.toMatchObject({ code: "DB_UNAVAILABLE" });
  });
});
