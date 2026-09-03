import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `UnlockGrant` reads — the permission that lets one person write inside one
 * already-closed window.
 *
 * The important thing to understand about testing this module: expiry and
 * revocation are enforced **in the query**, not in JavaScript afterwards. There
 * is no branch here that inspects `expiresAt` and decides. So a mocked client
 * cannot prove "an expired grant does not unlock" by handing back an expired
 * row — the row would never have come back. What it can prove, and what these
 * tests assert, is that the predicate sent to Postgres carries `revokedAt: null`
 * and `expiresAt: { gt: now }`, and that a query returning nothing yields `null`.
 *
 * Deleting either filter from the `where` fails a test here. That is the whole
 * point: without them, a revoked grant would keep working until it expired, and
 * an expired one would never stop.
 */

const findFirst = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unlockGrant: {
      get findFirst() {
        return findFirst;
      },
      get findMany() {
        return findMany;
      },
    },
  },
}));

// `findActiveUnlock` is wrapped in React `cache()`, which needs a request store
// that does not exist in a unit test. Identity keeps the function under test and
// drops only the per-request memoization, which is not what is being verified.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

const { findActiveUnlock, hasActiveUnlock, listActiveUnlockKeys } = await import(
  "@/lib/unlock/grants"
);

const USER = "user-1";
const WEEK_A = "2026-08-24";
const WEEK_B = "2026-08-31";

function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    expiresAt: new Date("2026-09-30T00:00:00.000Z"),
    grantedBy: { fullName: "Division Admin" },
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("findActiveUnlock", () => {
  it("returns the grant, with who issued it", async () => {
    findFirst.mockResolvedValue(liveRow());

    const grant = await findActiveUnlock(USER, "ARAL_WEEKLY_ATTENDANCE", WEEK_A);

    expect(grant).toEqual({
      id: "grant-1",
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      grantedByName: "Division Admin",
    });
  });

  it("survives a grant whose issuer was deleted", async () => {
    findFirst.mockResolvedValue(liveRow({ grantedBy: null }));

    const grant = await findActiveUnlock(USER, "ARAL_WEEKLY_ATTENDANCE", WEEK_A);

    expect(grant?.grantedByName).toBeNull();
  });

  it("asks only for grants that are neither revoked nor expired", async () => {
    // The two filters that make a grant temporary. Asserted on the query because
    // that is where they live — see the module note.
    findFirst.mockResolvedValue(null);
    const before = Date.now();

    await findActiveUnlock(USER, "TERM_GRADES", "FIRST");

    const where = findFirst.mock.calls[0]?.[0]?.where;
    expect(where.revokedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("scopes the lookup to one person, one scope, and one exact window", async () => {
    // A grant for last week must not answer for this week, and a grant for the
    // term sheet must not answer for attendance. Both come down to this `where`.
    findFirst.mockResolvedValue(null);

    await findActiveUnlock(USER, "ARAL_WEEKLY_ATTENDANCE", WEEK_A);

    expect(findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      userId: USER,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_A,
    });
  });

  it("returns null when the window has no grant", async () => {
    // What the database returns for an expired grant, a revoked one, another
    // teacher's grant, and week B when only week A was granted.
    findFirst.mockResolvedValue(null);

    await expect(
      findActiveUnlock(USER, "ARAL_WEEKLY_ATTENDANCE", WEEK_B)
    ).resolves.toBeNull();
  });

  it("fails closed when the lookup throws", async () => {
    // A pool timeout must read as "still locked", never as permission. If this
    // rethrew, a transient database error would 500 a teacher's save; if it
    // returned a grant, it would open every locked window in the app at once.
    findFirst.mockRejectedValue(new Error("P2024: pool timeout"));

    await expect(
      findActiveUnlock(USER, "ARAL_WEEKLY_ATTENDANCE", WEEK_A)
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("hasActiveUnlock", () => {
  it("is true for a live grant and false for none", async () => {
    findFirst.mockResolvedValue(liveRow());
    await expect(hasActiveUnlock(USER, "TERM_GRADES", "FIRST")).resolves.toBe(true);

    findFirst.mockResolvedValue(null);
    await expect(hasActiveUnlock(USER, "TERM_GRADES", "SECOND")).resolves.toBe(false);
  });

  it("is false when the lookup throws", async () => {
    findFirst.mockRejectedValue(new Error("connection reset"));
    await expect(hasActiveUnlock(USER, "TERM_GRADES", "FIRST")).resolves.toBe(false);
  });
});

describe("listActiveUnlockKeys", () => {
  it("returns the granted target keys as a set", async () => {
    findMany.mockResolvedValue([{ targetKey: WEEK_A }, { targetKey: WEEK_B }]);

    const keys = await listActiveUnlockKeys(USER, "ARAL_WEEKLY_ATTENDANCE");

    expect(keys).toBeInstanceOf(Set);
    expect(keys.has(WEEK_A)).toBe(true);
    expect(keys.has(WEEK_B)).toBe(true);
    expect(keys.has("2026-09-07")).toBe(false);
    expect(keys.size).toBe(2);
  });

  it("applies the same revoked and expiry filters as the single lookup", async () => {
    // The grid computes locks from this set. If it were laxer than
    // `findActiveUnlock`, a revoked week would render editable and then refuse
    // to save — the worst of both answers.
    findMany.mockResolvedValue([]);

    await listActiveUnlockKeys(USER, "TERM_GRADES");

    expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      userId: USER,
      scope: "TERM_GRADES",
      revokedAt: null,
    });
    expect(findMany.mock.calls[0]?.[0]?.where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("returns an empty set with no grants", async () => {
    findMany.mockResolvedValue([]);
    await expect(
      listActiveUnlockKeys(USER, "ARAL_WEEKLY_ATTENDANCE")
    ).resolves.toEqual(new Set());
  });

  it("returns an empty set when the query throws", async () => {
    findMany.mockRejectedValue(new Error("P2024: pool timeout"));

    const keys = await listActiveUnlockKeys(USER, "ARAL_WEEKLY_ATTENDANCE");

    expect(keys.size).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });
});
