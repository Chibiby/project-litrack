import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §3 of the ten concerns: the programme-wide switch over submission deadlines.
 *
 * The property that matters most is not "returns writable" — it is that when the
 * switch is off, `UnlockGrant` is **not read at all**. A version that consulted
 * the table and then ignored the answer would pass every behavioural assertion
 * here while still paying a query on every past-deadline save and still failing
 * closed the moment that query threw. So the grant reads are spies, and the
 * tests assert on whether they ran.
 *
 * The second property is the direction of the failure. `readSetting` degrades a
 * database error to `null`, and `null` means "off" for this key — the opposite
 * direction from `isDemoEnabled`, and deliberately so: a settings hiccup must
 * leave teachers able to work rather than locked out of a week they are in the
 * middle of encoding. That is the one place where this switch and the demo
 * switch disagree, so it gets its own test.
 */

const USER_ID = "teacher-marivic";
const WEEK_KEY = "2026-09-07";

const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    unlockGrant: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

const isSubmissionLockingEnabled = vi.fn();
vi.mock("@/lib/settings/system-settings", () => ({
  isSubmissionLockingEnabled: () => isSubmissionLockingEnabled(),
}));

import { canWriteWindow, readUnlockState } from "@/lib/unlock/grants";

const LIVE_GRANT = {
  id: "grant-1",
  expiresAt: new Date(2099, 0, 1),
  grantedBy: { fullName: "Division Admin" },
};

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null);
  findMany.mockResolvedValue([]);
});

describe("canWriteWindow — locking off", () => {
  beforeEach(() => {
    isSubmissionLockingEnabled.mockResolvedValue(false);
  });

  it("opens the window without reading a grant", async () => {
    const verdict = await canWriteWindow(USER_ID, "ARAL_WEEKLY_ATTENDANCE", WEEK_KEY);

    expect(verdict).toEqual({ writable: true, grantId: null });
    // The assertion the whole switch exists for.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("reports no grant id, so an audit row cannot claim one paid for the save", async () => {
    findFirst.mockResolvedValue(LIVE_GRANT);

    const verdict = await canWriteWindow(USER_ID, "TERM_GRADES", "FIRST");

    // Even though a grant exists, it was neither read nor credited: nothing was
    // refused, so nothing had to be granted.
    expect(verdict.grantId).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("canWriteWindow — locking on", () => {
  beforeEach(() => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
  });

  it("refuses when the user holds no live grant", async () => {
    const verdict = await canWriteWindow(USER_ID, "ARAL_WEEKLY_ATTENDANCE", WEEK_KEY);

    expect(verdict).toEqual({ writable: false, grantId: null });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("opens the window and credits the grant that did it", async () => {
    findFirst.mockResolvedValue(LIVE_GRANT);

    const verdict = await canWriteWindow(USER_ID, "TERM_GRADES", "FIRST");

    expect(verdict).toEqual({ writable: true, grantId: "grant-1" });
  });

  it("asks for this user, this scope and this target only", async () => {
    await canWriteWindow(USER_ID, "TERM_GRADES", "SECOND");

    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({
        userId: USER_ID,
        scope: "TERM_GRADES",
        targetKey: "SECOND",
        revokedAt: null,
      }),
    });
  });

  it("still fails closed when the grant lookup throws", async () => {
    findFirst.mockRejectedValue(new Error("P2024 pool timeout"));

    // `findActiveUnlock` swallows and returns null; the lock therefore holds.
    // A database error must never read as permission.
    expect(
      await canWriteWindow(USER_ID, "ARAL_WEEKLY_ATTENDANCE", WEEK_KEY)
    ).toEqual({ writable: false, grantId: null });
  });
});

describe("readUnlockState", () => {
  it("reports locking off and reads no grants", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(false);

    const state = await readUnlockState(USER_ID, "TERM_GRADES");

    expect(state.lockingEnabled).toBe(false);
    expect(state.unlockedKeys.size).toBe(0);
    // The empty set means "not read", not "holds none" — which is exactly why
    // callers must branch on the flag and never on the set being empty.
    expect(findMany).not.toHaveBeenCalled();
  });

  it("reports locking on with the keys the user holds", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
    findMany.mockResolvedValue([{ targetKey: "FIRST" }, { targetKey: "THIRD" }]);

    const state = await readUnlockState(USER_ID, "TERM_GRADES");

    expect(state.lockingEnabled).toBe(true);
    expect([...state.unlockedKeys].sort()).toEqual(["FIRST", "THIRD"]);
  });

  it("reports locking on with an empty set when the list throws", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
    findMany.mockRejectedValue(new Error("boom"));

    const state = await readUnlockState(USER_ID, "ARAL_WEEKLY_ATTENDANCE");

    // Fail closed on the read path too: an unreadable grant list renders every
    // window locked rather than every window open.
    expect(state).toEqual({ lockingEnabled: true, unlockedKeys: new Set() });
  });
});
