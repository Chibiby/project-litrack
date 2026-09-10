import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUBMISSION_LOCKING_KEY } from "@/lib/unlock/constants";

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
vi.mock("@/lib/prisma", () => ({
  prisma: { systemSetting: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import { isSubmissionLockingEnabled } from "@/lib/settings/system-settings";

beforeEach(() => {
  vi.clearAllMocks();
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
