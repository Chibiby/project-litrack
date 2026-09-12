import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  READING_LEVEL_UNLOCK_ALL_KEY,
  SUBMISSION_LOCKING_KEY,
} from "@/lib/unlock/constants";

/**
 * The `submissions.locking` switch itself, read straight off `SystemSetting`.
 *
 * Two things are pinned, and they are the two that would be silent if wrong:
 *
 *   1. **The default is off**, which is the opposite of `isDemoEnabled` sitting
 *      beside it in the same module. A database with no row has never had the
 *      switch touched, and the programme asked to ship writable.
 *   2. **A read failure degrades to off, not on.** `readSetting` swallows the
 *      error and returns `null`, and `null` is "off" here. That is the module's
 *      "never 500 on a settings hiccup" rule pointed in the direction that
 *      leaves a teacher able to finish the week they are encoding.
 *
 * The key string is asserted separately because three places name it — the
 * reader, the toggle action and the audit row — and a typo in any one of them
 * would leave a switch that reads one row and writes another.
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

// The two writers below need a session, an audit sink and a cache bust. The
// settings module itself stays REAL so the reader tests in this file keep
// exercising the real `readSetting` degrade-to-null behaviour.
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
  AUDIT_ACTIONS: {
    SUBMISSION_LOCKING_SET: "SUBMISSION_LOCKING_SET",
    READING_LEVEL_UNLOCK_ALL_SET: "READING_LEVEL_UNLOCK_ALL_SET",
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import {
  isMonthlyReadingLevelUnlockedForAll,
  isSubmissionLockingEnabled,
} from "@/lib/settings/system-settings";

const { setMonthlyReadingLevelUnlock, setSubmissionLocking } = await import(
  "@/lib/actions/submission-locking"
);

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
});

describe("isSubmissionLockingEnabled", () => {
  it("names the key the toggle and the audit row use", () => {
    expect(SUBMISSION_LOCKING_KEY).toBe("submissions.locking");
  });

  it("is off when the row does not exist", async () => {
    findUnique.mockResolvedValue(null);

    expect(await isSubmissionLockingEnabled()).toBe(false);
    expect(findUnique.mock.calls[0][0]).toMatchObject({
      where: { key: SUBMISSION_LOCKING_KEY },
    });
  });

  it("is off when the read fails, rather than throwing or locking everyone out", async () => {
    findUnique.mockRejectedValue(new Error("P2024 pool timeout"));

    expect(await isSubmissionLockingEnabled()).toBe(false);
  });

  it("is off for any value that is not exactly \"true\"", async () => {
    for (const value of ["false", "off", "TRUE", "1", ""]) {
      findUnique.mockResolvedValue({ value });
      // Not a lenient parse: the writer only ever stores "true" or "false", and
      // anything else is a row somebody edited by hand. Reading it as "on" would
      // lock a programme out on a typo.
      expect(await isSubmissionLockingEnabled(), value).toBe(false);
    }
  });
});

describe("isSubmissionLockingEnabled — on", () => {
  it("is on when the row says exactly \"true\"", async () => {
    findUnique.mockResolvedValue({ value: "true" });

    expect(await isSubmissionLockingEnabled()).toBe(true);
  });

  it("re-reads rather than memoizing across requests", async () => {
    // `cache()` scopes to one render/request. If it memoized process-wide, every
    // test above would be reading the first test's answer and this suite would
    // be proving nothing — so the call count is asserted rather than assumed.
    findUnique.mockResolvedValue({ value: "true" });
    await isSubmissionLockingEnabled();
    const before = findUnique.mock.calls.length;
    await isSubmissionLockingEnabled();

    expect(findUnique.mock.calls.length).toBeGreaterThan(before);
  });
});

/**
 * The reading-level-unlock-for-everyone switch, which defaults the OPPOSITE
 * direction from `isSubmissionLockingEnabled`: a missing row, or a read that
 * throws, both mean "still unlocked" here, because `readSetting` degrades every
 * failure to `null` and `null !== "false"` is `true`.
 */
describe("isMonthlyReadingLevelUnlockedForAll", () => {
  it("names the key the setting reads and writes", () => {
    expect(READING_LEVEL_UNLOCK_ALL_KEY).toBe("submissions.readingLevelUnlockAll");
  });

  it("is on when the row does not exist", async () => {
    findUnique.mockResolvedValue(null);

    expect(await isMonthlyReadingLevelUnlockedForAll()).toBe(true);
    expect(findUnique.mock.calls[0][0]).toMatchObject({
      where: { key: READING_LEVEL_UNLOCK_ALL_KEY },
    });
  });

  it("is on when the read fails, rather than locking every teacher out", async () => {
    findUnique.mockRejectedValue(new Error("P2024 pool timeout"));

    expect(await isMonthlyReadingLevelUnlockedForAll()).toBe(true);
  });

  it("is off only when the row says exactly \"false\"", async () => {
    findUnique.mockResolvedValue({ value: "false" });

    expect(await isMonthlyReadingLevelUnlockedForAll()).toBe(false);
  });

  it("is on for any value that is not exactly \"false\"", async () => {
    for (const value of ["true", "off", "FALSE", "0", ""]) {
      findUnique.mockResolvedValue({ value });
      expect(await isMonthlyReadingLevelUnlockedForAll(), value).toBe(true);
    }
  });
});

/**
 * The writer on the other side of that reader.
 *
 * The asymmetry above is the whole reason this has its own tests: "on" can be
 * spelled a dozen ways and every one of them reads as unlocked, but "off" is
 * the single literal string `"false"`. A writer that stored `""`, `"0"` or
 * nothing at all for off would leave a switch that flips one way only, and the
 * page would show it as closed while every teacher kept writing.
 */
describe("setMonthlyReadingLevelUnlock", () => {
  it("is Super Admin only", async () => {
    await setMonthlyReadingLevelUnlock(form("on"));

    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
  });

  it("writes the exact string the reader tests for when switching off", async () => {
    const result = await setMonthlyReadingLevelUnlock(form("false"));

    expect(result).toEqual({ ok: true });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { key: READING_LEVEL_UNLOCK_ALL_KEY },
      create: { key: READING_LEVEL_UNLOCK_ALL_KEY, value: "false" },
      update: { value: "false" },
    });
  });

  it("accepts the shapes a checkbox, a switch and a hidden input each send", async () => {
    for (const on of ["true", "on"]) {
      vi.clearAllMocks();
      requireUser.mockResolvedValue(ADMIN);
      await setMonthlyReadingLevelUnlock(form(on));
      expect(upsert.mock.calls[0]?.[0]?.update, on).toEqual({ value: "true" });
    }
    for (const off of ["false", "off"]) {
      vi.clearAllMocks();
      requireUser.mockResolvedValue(ADMIN);
      await setMonthlyReadingLevelUnlock(form(off));
      expect(upsert.mock.calls[0]?.[0]?.update, off).toEqual({ value: "false" });
    }
  });

  it("refuses a value it does not recognise instead of guessing", async () => {
    const result = await setMonthlyReadingLevelUnlock(form("maybe"));

    expect(result.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("records the flip under its own audit action, against the key it wrote", async () => {
    await setMonthlyReadingLevelUnlock(form("false"));

    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      userId: "admin-1",
      schoolId: null,
      action: "READING_LEVEL_UNLOCK_ALL_SET",
      resource: "SystemSetting",
      resourceId: READING_LEVEL_UNLOCK_ALL_KEY,
      metadata: { enabled: false },
    });
  });

  it("refreshes the admin page and the teacher ARAL layout", async () => {
    await setMonthlyReadingLevelUnlock(form("false"));

    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings/submissions");
    expect(revalidatePath).toHaveBeenCalledWith("/teacher/aral", "layout");
  });

  it("does not touch the submission-locking key", async () => {
    // Two switches, two keys, one settings page. Writing the wrong one would
    // turn deadlines off for the whole programme from a control that says it
    // only opens the reading level.
    await setMonthlyReadingLevelUnlock(form("false"));

    expect(upsert.mock.calls[0]?.[0]?.where.key).not.toBe(SUBMISSION_LOCKING_KEY);
  });

  it("leaves the other switch writing its own key", async () => {
    await setSubmissionLocking(form("true"));

    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { key: SUBMISSION_LOCKING_KEY },
      update: { value: "true" },
    });
    expect(writeAudit.mock.calls[0]?.[0]?.action).toBe("SUBMISSION_LOCKING_SET");
  });
});
