import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `readUnlockState` with the settings read mocked, so the two paths the
 * display-reads suite cannot reach (a non-DB_UNAVAILABLE failure, and the
 * success path with real grants) are pinned.
 */

const isSubmissionLockingEnabled = vi.fn();
vi.mock("@/lib/settings/system-settings", () => ({
  isSubmissionLockingEnabled: () => isSubmissionLockingEnabled(),
}));

const unlockFindMany = vi.fn();
const schoolUnlockFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    unlockGrant: { findMany: (...a: unknown[]) => unlockFindMany(...a) },
    schoolUnlockGrant: { findMany: (...a: unknown[]) => schoolUnlockFindMany(...a) },
  },
}));

const reportError = vi.fn(() => "REF-1");
vi.mock("@/lib/errors/report", () => ({
  reportError: (...a: unknown[]) => reportError(...(a as [])),
}));
vi.mock("server-only", () => ({}));

import { readUnlockState } from "@/lib/unlock/grants";

const args = { userId: "u", schoolId: "s", scope: "TERM_GRADES" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readUnlockState", () => {
  it("propagates a plain Error from the settings read, unreported", async () => {
    const err = new Error("boom");
    isSubmissionLockingEnabled.mockRejectedValue(err);
    await expect(readUnlockState(args)).rejects.toBe(err);
    expect(reportError).not.toHaveBeenCalled();
    expect(unlockFindMany).not.toHaveBeenCalled();
  });

  it("returns the real unlockedKeys when locking is on", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
    unlockFindMany.mockResolvedValue([{ targetKey: "FIRST" }]);
    schoolUnlockFindMany.mockResolvedValue([{ targetKey: "SECOND" }]);
    const state = await readUnlockState(args);
    expect(state.lockingEnabled).toBe(true);
    expect([...state.unlockedKeys].sort()).toEqual(["FIRST", "SECOND"]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns an empty set without reading grants when locking is off", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(false);
    const state = await readUnlockState(args);
    expect(state).toEqual({ lockingEnabled: false, unlockedKeys: new Set() });
    expect(unlockFindMany).not.toHaveBeenCalled();
  });
});
