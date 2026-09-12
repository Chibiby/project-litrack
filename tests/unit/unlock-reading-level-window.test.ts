// Asia/Manila before the first Date, same premise as attendance-week-save.test.ts.
process.env.TZ = "Asia/Manila";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `resolveMonthlyReadingLevelWindow` / `readMonthlyReadingLevelLockState`
 * (`src/lib/unlock/reading-level-window.ts`) — the single place the action and
 * the page both ask "may this person write this month?".
 *
 * The property that matters most is the PRECEDENCE ORDER, not just the final
 * verdict: a version that queried every rung and then picked the first true one
 * would pass a naive behavioural check while paying for a settings read (and
 * failing closed on one) on the overwhelmingly common in-window save. So every
 * rung below is a spy, and the tests assert on whether the cheaper rungs ran —
 * exactly as `unlock-can-write-window.test.ts` does for `canWriteWindow`.
 */

const isSubmissionLockingEnabled = vi.fn();
const isMonthlyReadingLevelUnlockedForAll = vi.fn();
vi.mock("@/lib/settings/system-settings", () => ({
  isSubmissionLockingEnabled: () => isSubmissionLockingEnabled(),
  isMonthlyReadingLevelUnlockedForAll: () => isMonthlyReadingLevelUnlockedForAll(),
}));

const canWriteWindow = vi.fn();
const listActiveUnlockKeys = vi.fn();
vi.mock("@/lib/unlock/grants", () => ({
  canWriteWindow: (...a: unknown[]) => canWriteWindow(...a),
  listActiveUnlockKeys: (...a: unknown[]) => listActiveUnlockKeys(...a),
}));

import {
  resolveMonthlyReadingLevelWindow,
  readMonthlyReadingLevelLockState,
} from "@/lib/unlock/reading-level-window";
import { readingLevelDeadline } from "@/lib/month-range";

const USER_ID = "teacher-marivic";
const SCHOOL_ID = "school-malandag";
const MONTH_KEY = "2026-08-01";
const DEADLINE = readingLevelDeadline(MONTH_KEY); // 2026-09-07

beforeEach(() => {
  vi.clearAllMocks();
  isSubmissionLockingEnabled.mockResolvedValue(false);
  isMonthlyReadingLevelUnlockedForAll.mockResolvedValue(true);
  canWriteWindow.mockResolvedValue({ writable: false, grantId: null, grantKind: null });
  listActiveUnlockKeys.mockResolvedValue(new Set());
});

describe("resolveMonthlyReadingLevelWindow — rung 1: in-window", () => {
  it("is writable on the deadline itself with NO settings or grant query", async () => {
    const verdict = await resolveMonthlyReadingLevelWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      monthKey: MONTH_KEY,
      today: DEADLINE,
    });

    expect(verdict).toEqual({
      writable: true,
      reason: "in-window",
      deadline: DEADLINE,
      grantId: null,
      grantKind: null,
    });
    expect(isSubmissionLockingEnabled).not.toHaveBeenCalled();
    expect(isMonthlyReadingLevelUnlockedForAll).not.toHaveBeenCalled();
    expect(canWriteWindow).not.toHaveBeenCalled();
  });
});

describe("resolveMonthlyReadingLevelWindow — rung 2: master switch off", () => {
  it("is writable past the deadline with locking off, no grant query", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(false);
    const pastDeadline = new Date(DEADLINE);
    pastDeadline.setDate(pastDeadline.getDate() + 1);

    const verdict = await resolveMonthlyReadingLevelWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      monthKey: MONTH_KEY,
      today: pastDeadline,
    });

    expect(verdict.writable).toBe(true);
    expect(verdict.reason).toBe("locking-off");
    expect(isMonthlyReadingLevelUnlockedForAll).not.toHaveBeenCalled();
    expect(canWriteWindow).not.toHaveBeenCalled();
  });
});

describe("resolveMonthlyReadingLevelWindow — rung 3: programme switch on", () => {
  const pastDeadline = new Date(DEADLINE);
  pastDeadline.setDate(pastDeadline.getDate() + 1);

  beforeEach(() => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
    isMonthlyReadingLevelUnlockedForAll.mockResolvedValue(true);
  });

  it("is writable and NEVER reaches the grant lookup (rung 4)", async () => {
    const verdict = await resolveMonthlyReadingLevelWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      monthKey: MONTH_KEY,
      today: pastDeadline,
    });

    expect(verdict.writable).toBe(true);
    expect(verdict.reason).toBe("program-unlocked");
    // The assertion the whole rung ordering exists for.
    expect(canWriteWindow).not.toHaveBeenCalled();
  });
});

describe("resolveMonthlyReadingLevelWindow — rung 4: grant", () => {
  const pastDeadline = new Date(DEADLINE);
  pastDeadline.setDate(pastDeadline.getDate() + 1);

  beforeEach(() => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
    isMonthlyReadingLevelUnlockedForAll.mockResolvedValue(false);
  });

  it("is writable and credits the grant when one is live", async () => {
    canWriteWindow.mockResolvedValue({
      writable: true,
      grantId: "grant-1",
      grantKind: "school",
    });

    const verdict = await resolveMonthlyReadingLevelWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      monthKey: MONTH_KEY,
      today: pastDeadline,
    });

    expect(verdict).toEqual({
      writable: true,
      reason: "granted",
      deadline: DEADLINE,
      grantId: "grant-1",
      grantKind: "school",
    });
    expect(canWriteWindow.mock.calls[0][0]).toMatchObject({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "MONTHLY_READING_LEVEL",
      targetKey: MONTH_KEY,
    });
  });

  it("is locked when no grant is live", async () => {
    canWriteWindow.mockResolvedValue({ writable: false, grantId: null, grantKind: null });

    const verdict = await resolveMonthlyReadingLevelWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      monthKey: MONTH_KEY,
      today: pastDeadline,
    });

    expect(verdict).toEqual({
      writable: false,
      reason: "locked",
      deadline: DEADLINE,
      grantId: null,
      grantKind: null,
    });
  });

  it("fails closed when a downstream lookup throws", async () => {
    isSubmissionLockingEnabled.mockRejectedValue(new Error("P2024 pool timeout"));

    const verdict = await resolveMonthlyReadingLevelWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      monthKey: MONTH_KEY,
      today: pastDeadline,
    });

    expect(verdict.writable).toBe(false);
    expect(verdict.reason).toBe("locked");
  });
});

describe("readMonthlyReadingLevelLockState", () => {
  it("reports locking off and reads nothing else", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(false);

    const state = await readMonthlyReadingLevelLockState({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
    });

    expect(state).toEqual({ lockingEnabled: false, programUnlockAll: false, unlockedMonths: [] });
    expect(isMonthlyReadingLevelUnlockedForAll).not.toHaveBeenCalled();
    expect(listActiveUnlockKeys).not.toHaveBeenCalled();
  });

  it("reports the programme switch on and reads no grant list", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
    isMonthlyReadingLevelUnlockedForAll.mockResolvedValue(true);

    const state = await readMonthlyReadingLevelLockState({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
    });

    expect(state).toEqual({ lockingEnabled: true, programUnlockAll: true, unlockedMonths: [] });
    expect(listActiveUnlockKeys).not.toHaveBeenCalled();
  });

  it("reports the held grant months when the programme switch is off", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(true);
    isMonthlyReadingLevelUnlockedForAll.mockResolvedValue(false);
    listActiveUnlockKeys.mockResolvedValue(new Set(["2026-07-01", "2026-08-01"]));

    const state = await readMonthlyReadingLevelLockState({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
    });

    expect(state.lockingEnabled).toBe(true);
    expect(state.programUnlockAll).toBe(false);
    expect([...state.unlockedMonths].sort()).toEqual(["2026-07-01", "2026-08-01"]);
  });

  it("fails closed when the settings read throws", async () => {
    isSubmissionLockingEnabled.mockRejectedValue(new Error("boom"));

    const state = await readMonthlyReadingLevelLockState({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
    });

    expect(state).toEqual({ lockingEnabled: true, programUnlockAll: false, unlockedMonths: [] });
  });
});
