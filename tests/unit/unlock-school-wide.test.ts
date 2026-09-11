import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SchoolUnlockGrant` — one unlock covering every teacher in a school for one
 * window — as it feeds `canWriteWindow`.
 *
 * Same fail-closed contract as the personal grant it sits beside (see
 * `unlock-grants.test.ts`'s header), plus three properties specific to the
 * school-wide table:
 *
 *   1. **Tenancy.** The school query's `where` must carry the `schoolId` the
 *      caller passed in, never a different one — that is the whole difference
 *      between "unlocked for my school" and "unlocked for someone else's".
 *   2. **No school, no query.** `schoolId: null` (a user with no school) must
 *      not touch `schoolUnlockGrant` at all.
 *   3. **Attribution.** A personal grant wins when both exist; the school
 *      grant's id is only surfaced when it is the only one.
 */

const USER_ID = "teacher-marivic";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-other";
const WEEK_KEY = "2026-09-07";

const findFirst = vi.fn();
const findMany = vi.fn();
const schoolFindFirst = vi.fn();
const schoolFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unlockGrant: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
    schoolUnlockGrant: {
      findFirst: (...args: unknown[]) => schoolFindFirst(...args),
      findMany: (...args: unknown[]) => schoolFindMany(...args),
    },
  },
}));

const isSubmissionLockingEnabled = vi.fn();
vi.mock("@/lib/settings/system-settings", () => ({
  isSubmissionLockingEnabled: () => isSubmissionLockingEnabled(),
}));

// `findActiveUnlock` / `findActiveSchoolUnlock` are wrapped in React `cache()`,
// which needs a request store that does not exist in a unit test. Identity
// keeps the functions under test and drops only the per-request memoization.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

const { canWriteWindow, findActiveSchoolUnlock } = await import("@/lib/unlock/grants");

const LIVE_USER_GRANT = {
  id: "user-grant-1",
  expiresAt: new Date(2099, 0, 1),
  grantedBy: { fullName: "Division Admin" },
};

const LIVE_SCHOOL_GRANT = {
  id: "school-grant-1",
  expiresAt: new Date(2099, 0, 1),
  grantedBy: { fullName: "Division Admin" },
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null);
  findMany.mockResolvedValue([]);
  schoolFindFirst.mockResolvedValue(null);
  schoolFindMany.mockResolvedValue([]);
  isSubmissionLockingEnabled.mockResolvedValue(true);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("findActiveSchoolUnlock", () => {
  it("scopes the lookup to this school, this scope, this target, live only", async () => {
    schoolFindFirst.mockResolvedValue(null);
    const before = Date.now();

    await findActiveSchoolUnlock(SCHOOL_ID, "ARAL_WEEKLY_ATTENDANCE", WEEK_KEY);

    const where = schoolFindFirst.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
      revokedAt: null,
    });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("fails closed when the lookup throws", async () => {
    schoolFindFirst.mockRejectedValue(new Error("P2024: pool timeout"));

    await expect(
      findActiveSchoolUnlock(SCHOOL_ID, "ARAL_WEEKLY_ATTENDANCE", WEEK_KEY)
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("canWriteWindow — school-wide grants", () => {
  it("opens the window from a school-wide grant when there is no personal grant", async () => {
    schoolFindFirst.mockResolvedValue(LIVE_SCHOOL_GRANT);

    const verdict = await canWriteWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(verdict).toEqual({
      writable: true,
      grantId: "school-grant-1",
      grantKind: "school",
    });
  });

  it("a thrown school lookup fails closed", async () => {
    schoolFindFirst.mockRejectedValue(new Error("P2024: pool timeout"));

    const verdict = await canWriteWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(verdict).toEqual({ writable: false, grantId: null, grantKind: null });
  });

  it("locking off reads neither table", async () => {
    isSubmissionLockingEnabled.mockResolvedValue(false);
    schoolFindFirst.mockResolvedValue(LIVE_SCHOOL_GRANT);
    findFirst.mockResolvedValue(LIVE_USER_GRANT);

    const verdict = await canWriteWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(verdict).toEqual({ writable: true, grantId: null, grantKind: null });
    expect(findFirst).not.toHaveBeenCalled();
    expect(schoolFindFirst).not.toHaveBeenCalled();
  });

  it("the school query's where carries the session schoolId, not a different one", async () => {
    await canWriteWindow({
      userId: USER_ID,
      schoolId: OTHER_SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(schoolFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      schoolId: OTHER_SCHOOL_ID,
    });
    expect(schoolFindFirst.mock.calls[0]?.[0]?.where.schoolId).not.toBe(SCHOOL_ID);
  });

  it("schoolId: null issues no school query at all", async () => {
    const verdict = await canWriteWindow({
      userId: USER_ID,
      schoolId: null,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(schoolFindFirst).not.toHaveBeenCalled();
    expect(verdict).toEqual({ writable: false, grantId: null, grantKind: null });
  });

  it("a revoked or expired school grant does not open the window", async () => {
    // Enforced in the query's `where`, same as the personal grant — a mocked
    // client cannot hand back a revoked/expired row and have it excluded in
    // JS, so what is provable here is that the query never returns one and the
    // verdict reflects that absence.
    schoolFindFirst.mockResolvedValue(null);

    const verdict = await canWriteWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(verdict).toEqual({ writable: false, grantId: null, grantKind: null });
  });

  it("grantKind is \"user\" when both a personal and a school grant exist", async () => {
    findFirst.mockResolvedValue(LIVE_USER_GRANT);
    schoolFindFirst.mockResolvedValue(LIVE_SCHOOL_GRANT);

    const verdict = await canWriteWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(verdict).toEqual({
      writable: true,
      grantId: "user-grant-1",
      grantKind: "user",
    });
  });

  it("grantKind is \"school\" when only the school grant exists", async () => {
    findFirst.mockResolvedValue(null);
    schoolFindFirst.mockResolvedValue(LIVE_SCHOOL_GRANT);

    const verdict = await canWriteWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    expect(verdict.grantKind).toBe("school");
  });

  it("runs the personal and school reads together, not sequentially", async () => {
    // Neither resolves until both mocks are told to — if the implementation
    // awaited the personal read before starting the school read, this would
    // hang and the test would time out.
    let resolveUser: (v: unknown) => void;
    let resolveSchool: (v: unknown) => void;
    findFirst.mockReturnValue(new Promise((res) => (resolveUser = res)));
    schoolFindFirst.mockReturnValue(new Promise((res) => (resolveSchool = res)));

    const pending = canWriteWindow({
      userId: USER_ID,
      schoolId: SCHOOL_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_KEY,
    });

    // Let the `isSubmissionLockingEnabled()` await settle before checking that
    // both grant reads were issued off the same tick, not one after the other.
    await Promise.resolve();
    await Promise.resolve();

    // Both queries must have been issued already, before either resolves.
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(schoolFindFirst).toHaveBeenCalledTimes(1);

    resolveUser!(null);
    resolveSchool!(LIVE_SCHOOL_GRANT);

    await expect(pending).resolves.toEqual({
      writable: true,
      grantId: "school-grant-1",
      grantKind: "school",
    });
  });
});
