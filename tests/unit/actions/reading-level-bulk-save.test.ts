// Asia/Manila before the first Date: `ReadingLevelRecord.weekStart` is `@db.Date`,
// and this is the zone where a bound local-midnight `Date` would name the previous
// day. See attendance-week-save.test.ts for the same premise stated at length.
process.env.TZ = "Asia/Manila";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for `bulkRecordMonthlyReadingLevel`, which had NONE.
 *
 * The coverage on this feature was inverted before this file existed: the DEAD
 * `readingLevelBulkSchema` (weekly, zero `src/` usages) was tested, and the live
 * `readingLevelMonthlyBulkSchema` was referenced by nothing but the action. So a
 * green suite said nothing about the path a teacher actually saves through.
 *
 * What is contract here:
 *
 *   - The conflict tuple is deduped BEFORE the statement is built. One multi-row
 *     `ON CONFLICT DO UPDATE` raises Postgres 21000 on a repeated tuple and aborts
 *     the whole save, where the old per-row loop made it a harmless last-write-wins.
 *   - `weekStart` (which holds the MONTH anchor — the column keeps its weekly name)
 *     is bound as `YYYY-MM-DD` text, never as a `Date`.
 *   - The cap refuses an over-large payload with the house error shape.
 */

const TEACHER_ID = "teacher-marivic";
const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const GRADE_ID = "grade-g7";

let learnerIds: string[];
let rawCalls: { sql: string; params: unknown[] }[];
/** Makes the INSERT RETURN one row fewer than it was given — see the guard test. */
let dropOneReturnedRow: boolean;

function flattenBoundParams(values: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const v of values) {
    const nested = (v as { values?: unknown[] } | null)?.values;
    if (v && typeof v === "object" && Array.isArray(nested)) {
      out.push(...flattenBoundParams(nested));
    } else {
      out.push(v);
    }
  }
  return out;
}

/** Nested `Prisma.sql` fragments carry the per-row casts; splice them back in. */
function renderSql(strings: readonly string[], values: readonly unknown[]): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    const nested = values[i] as
      | { strings?: readonly string[]; values?: unknown[] }
      | null;
    if (
      nested &&
      typeof nested === "object" &&
      Array.isArray(nested.strings) &&
      Array.isArray(nested.values)
    ) {
      out += renderSql(nested.strings, nested.values);
    } else {
      out += " ? ";
    }
    out += strings[i + 1] ?? "";
  }
  return out;
}

/**
 * Returns one row per learner id it can find among the BOUND parameters, gated on
 * the bound tenant id. That models the statement's `JOIN "Learner"`, so deleting
 * `l."schoolId" = $n` from the action makes the action's own RETURNING count check
 * throw and turns these tests red.
 */
const queryRaw = vi.fn(async (strings: readonly string[], ...values: unknown[]) => {
  const params = flattenBoundParams(values);
  rawCalls.push({ sql: renderSql(strings, values), params });
  if (!params.includes(SCHOOL_ID)) return [];
  const returned = params
    .filter((p): p is string => typeof p === "string" && learnerIds.includes(p))
    .map((id) => ({ id: `rlr-${id}` }));
  // One row silently skipped by the JOIN — a soft-deleted learner, or one in
  // another tenant. Postgres reports no error for that; the guard is the only
  // thing that turns it into a refusal instead of a partial save.
  return dropOneReturnedRow ? returned.slice(1) : returned;
});

const transaction = vi.fn(async (arg: unknown, _options?: unknown) => {
  if (typeof arg === "function") {
    return (arg as (tx: unknown) => unknown)({
      $queryRaw: (...a: unknown[]) => queryRaw(...(a as [never])),
    });
  }
  return arg;
});

/**
 * A learner that really exists, in a school this teacher is not in. Its `teacherId`
 * is deliberately this teacher's, so the ONLY thing that can exclude it is the
 * `schoolId` scope — which is what makes the refusal test below a live probe of
 * tenancy rather than of teacher assignment.
 */
const CROSS_TENANT_LEARNER = "learner-other-school";

/**
 * Two tenants in one table. Modelled so an UNSCOPED query returns the cross-tenant
 * row, exactly as Postgres would: drop `schoolId: user.schoolId` from the action and
 * the row comes back, the save proceeds, and the refusal test goes red.
 */
const learnerFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
  const requested = (args.where.id as { in: string[] }).in;
  const table = [
    ...learnerIds.map((id) => ({ id, schoolId: SCHOOL_ID })),
    { id: CROSS_TENANT_LEARNER, schoolId: OTHER_SCHOOL_ID },
  ];
  return table
    .filter(
      (r) =>
        requested.includes(r.id) &&
        (args.where.schoolId === undefined || r.schoolId === args.where.schoolId)
    )
    .map((r) => ({
      id: r.id,
      gradeLevelId: GRADE_ID,
      teacherId: TEACHER_ID,
      aralTeacherId: null,
    }));
});

const learnerUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    learner: {
      findMany: (...a: unknown[]) => learnerFindMany(...(a as [never])),
      // Never called by this action — the intake fields `Learner.englishReadingProfile`
      // / `filipinoReadingProfile` are owned by the learner form and CSV import, and
      // a monthly reading-level save (upsert or clear) must never touch them.
      update: (...a: unknown[]) => learnerUpdate(...(a as [never])),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: async () => ({
    id: TEACHER_ID,
    schoolId: SCHOOL_ID,
    role: "TEACHER",
  }),
}));

const writeAudit = vi.fn(async (_e: { metadata: Record<string, unknown> }) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...(a as [never])),
  AUDIT_ACTIONS: {
    READING_LEVEL_BULK_RECORD: "READING_LEVEL_BULK_RECORD",
    UNLOCK_GRANT_USED: "UNLOCK_GRANT_USED",
    UNLOCK_SCHOOL_GRANT_USED: "UNLOCK_SCHOOL_GRANT_USED",
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateTeacherDashboard: vi.fn(),
}));

type WindowVerdict = {
  writable: boolean;
  reason: "in-window" | "locking-off" | "program-unlocked" | "granted" | "locked";
  deadline: Date;
  grantId: string | null;
  grantKind: "user" | "school" | null;
};

/**
 * The deadline gate. Defaults to "in-window" so every pre-existing test below
 * keeps exercising the write path without also depending on the real
 * system clock — `resolveMonthlyReadingLevelWindow` itself is covered on its
 * own terms in `tests/unit/unlock-reading-level-window.test.ts`.
 */
const resolveMonthlyReadingLevelWindow = vi.fn(
  async (_arg?: unknown): Promise<WindowVerdict> => ({
    writable: true,
    reason: "in-window",
    deadline: new Date(2026, 8, 7),
    grantId: null,
    grantKind: null,
  })
);
vi.mock("@/lib/unlock/reading-level-window", () => ({
  resolveMonthlyReadingLevelWindow: (...a: unknown[]) =>
    resolveMonthlyReadingLevelWindow(a[0]),
}));

const { bulkRecordMonthlyReadingLevel } = await import("@/lib/actions/reading-level");

function entry(learnerId: string, overrides: Record<string, unknown> = {}) {
  return {
    learnerId,
    englishProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoProfile: "INDEPENDENT_GRADE_READY",
    wordRecognitionLevel: "LEVEL_3",
    readingComprehensionLevel: "LEVEL_2",
    ...overrides,
  };
}

function post(
  entries: Record<string, unknown>[],
  monthStart = "2026-08-15",
  clears: string[] = []
) {
  return bulkRecordMonthlyReadingLevel({ monthStart, entries, clears });
}

beforeEach(() => {
  vi.clearAllMocks();
  learnerIds = ["learner-a", "learner-b"];
  rawCalls = [];
  dropOneReturnedRow = false;
  resolveMonthlyReadingLevelWindow.mockResolvedValue({
    writable: true,
    reason: "in-window",
    deadline: new Date(2026, 8, 7),
    grantId: null,
    grantKind: null,
  });
});

describe("bulkRecordMonthlyReadingLevel — the month anchor", () => {
  it("normalizes any day in the month to the 1st and binds it as text", async () => {
    const res = await post([entry("learner-a")], "2026-08-15");

    expect(res).toEqual({ ok: true, data: { upserted: 1, cleared: 0 } });
    expect(rawCalls).toHaveLength(1);
    // The column is named `weekStart` but holds the MONTH anchor — one canonical
    // row per learner per month, reusing @@unique([learnerId, weekStart]).
    expect(rawCalls[0].params).toContain("2026-08-01");
    expect(rawCalls[0].sql).toContain("::date");
    // Only `updatedAt` may be a Date. `weekStart` is `@db.Date` and must not be:
    // on this timezone a bound local midnight would write 2026-07-31.
    expect(rawCalls[0].params.filter((p) => p instanceof Date)).toHaveLength(1);
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({
      monthStart: "2026-08-01",
    });
  });
});

describe("bulkRecordMonthlyReadingLevel — dedupe before ON CONFLICT", () => {
  it("collapses a repeated learner into one row instead of hitting 21000", async () => {
    // The grid is not a diff and re-posts full row state, so a duplicated learner
    // is reachable. One multi-row ON CONFLICT DO UPDATE would raise Postgres 21000
    // ("cannot affect row a second time") and lose the ENTIRE save.
    const res = await post([
      entry("learner-a", { notes: "first" }),
      entry("learner-a", { notes: "second, wins" }),
    ]);

    expect(res).toEqual({ ok: true, data: { upserted: 1, cleared: 0 } });
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].params).toContain("second, wins");
    expect(rawCalls[0].params).not.toContain("first");
  });

  it("reports the deduped count in the audit row", async () => {
    await post([entry("learner-a"), entry("learner-a"), entry("learner-b")]);

    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({ upserted: 2 });
  });
});

describe("bulkRecordMonthlyReadingLevel — payload size", () => {
  it("accepts a 200-entry payload in two chunked statements", async () => {
    learnerIds = Array.from({ length: 200 }, (_, i) => `learner-${i}`);

    const res = await post(learnerIds.map((id) => entry(id)));

    expect(res).toEqual({ ok: true, data: { upserted: 200, cleared: 0 } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(rawCalls).toHaveLength(2);
  });

  it("rejects 201 entries with the house error shape and writes nothing", async () => {
    learnerIds = Array.from({ length: 201 }, (_, i) => `learner-${i}`);

    const res = await post(learnerIds.map((id) => entry(id)));

    expect(res.ok).toBe(false);
    expect(typeof (res as { error: string }).error).toBe("string");
    expect(transaction).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    // Refused by Zod, before the roster was read.
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("passes an explicit timeout and maxWait", async () => {
    await post([entry("learner-a")]);

    const options = transaction.mock.calls[0][1] as {
      timeout: number;
      maxWait: number;
    };
    expect(options.timeout).toBeGreaterThan(5_000);
    expect(options.maxWait).toBeGreaterThan(2_000);
  });
});

describe("bulkRecordMonthlyReadingLevel — the RETURNING count guard", () => {
  it("refuses the whole save when the statement writes fewer rows than it was given", async () => {
    // The last defence against a silently skipped row. The JOIN drops any learner
    // that is soft-deleted, non-ARAL or in another tenant, and Postgres reports NO
    // error for that — the teacher would be told the save succeeded while one
    // learner's assessment quietly went nowhere. Nothing else in the suite fires
    // this branch, so an inverted or deleted comparison would go unnoticed.
    dropOneReturnedRow = true;

    const res = await post([entry("learner-a"), entry("learner-b")]);

    expect(res).toEqual({
      ok: false,
      error: "Could not save the reading levels. Please try again.",
    });
    // Refused, not partially committed: the throw is inside the transaction.
    expect(writeAudit).not.toHaveBeenCalled();
    // And the row count is not leaked to the client.
    expect((res as { error: string }).error).not.toMatch(/\d/);
  });
});

describe("bulkRecordMonthlyReadingLevel — tenancy", () => {
  it("binds the tenant into the statement", async () => {
    await post([entry("learner-a")]);

    expect(rawCalls[0].params).toContain(SCHOOL_ID);
    expect(rawCalls[0].sql).toContain('l."schoolId" =');
    expect(rawCalls[0].sql).toContain('l."deletedAt" IS NULL');
    expect(rawCalls[0].sql).toContain('l."isAralLearner" = TRUE');
  });

  it("refuses a learner that exists in another school", async () => {
    // A live tenancy probe, not a decorative one. CROSS_TENANT_LEARNER exists in the
    // fake table under OTHER_SCHOOL_ID with this teacher's own teacherId, so only
    // the `schoolId: user.schoolId` scope can exclude it. Drop that scope from the
    // action and the roster query returns the row, the length check passes, and this
    // goes red on `queryRaw` having been called.
    const res = await post([entry(CROSS_TENANT_LEARNER)]);

    expect(res.ok).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    // The scoped query was still asked with the caller's OWN tenant, never the
    // learner's — nothing in the request can widen it.
    expect(learnerFindMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL_ID);
    // And the refusal cannot serve as an existence oracle: a learner in another
    // school is indistinguishable from one that does not exist at all.
    const missing = await post([entry("learner-does-not-exist")]);
    expect(JSON.stringify(missing)).toBe(JSON.stringify(res));
  });

  it("writes nothing for the valid half of a mixed batch", async () => {
    const res = await post([entry("learner-a"), entry(CROSS_TENANT_LEARNER)]);

    expect(res.ok).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("bulkRecordMonthlyReadingLevel — partial rows reach SQL as NULL", () => {
  it("binds the fields a teacher has not filled in yet as NULL, not as a rejection", async () => {
    // Only two of the six value fields are present. Under the old all-required
    // `bulkEntryFields` this row would have been rejected by Zod before ever
    // reaching the roster query or SQL — this is the regression the nullable
    // `ReadingProfile` column and the partial schema exist to fix.
    const res = await post([
      {
        learnerId: "learner-a",
        englishProfile: "INSTRUCTIONAL_DEVELOPING",
        filipinoProfile: "INDEPENDENT_GRADE_READY",
      },
    ]);

    expect(res).toEqual({ ok: true, data: { upserted: 1, cleared: 0 } });
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].sql).toContain("INSERT INTO");
    // wordRecognitionLevel, readingComprehensionLevel, writingLevel, notes are
    // all absent — four NULL binds, two of which (word recognition, reading
    // comprehension) were REQUIRED enums before this change.
    expect(rawCalls[0].params.filter((p) => p === null)).toHaveLength(4);
  });
});

describe("bulkRecordMonthlyReadingLevel — clears", () => {
  it("deletes by month RANGE, not by the anchor", async () => {
    const res = await post([], "2026-08-15", ["learner-a"]);

    expect(res).toEqual({ ok: true, data: { upserted: 0, cleared: 1 } });
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].sql).toContain('DELETE FROM "ReadingLevelRecord"');
    expect(rawCalls[0].sql).toContain('r."weekStart" >=');
    expect(rawCalls[0].sql).toContain('r."weekStart" <');
    // Same belt-and-braces the INSERT carries — a non-ARAL learner's stray row
    // must not be reachable by this DELETE even though the upstream `findMany`
    // already excludes non-ARAL learners from `clearIds`.
    expect(rawCalls[0].sql).toContain('l."isAralLearner" = TRUE');
    // A range's two bounds, not a single anchor equality — this is what lets a
    // legacy 2026-08-10 row and the 2026-08-01 anchor both fall inside one
    // DELETE, where an exact `= '2026-08-01'` would miss the legacy row and
    // let it reappear on the next render.
    expect(rawCalls[0].params).toContain("2026-08-01");
    expect(rawCalls[0].params).toContain("2026-09-01");
  });

  it("skips the INSERT statement entirely on a clears-only save", async () => {
    await post([], "2026-08-15", ["learner-a"]);

    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].sql).not.toContain("INSERT INTO");
  });

  it("counts cleared as the returned row count, not the submitted id count", async () => {
    // The fake JOIN silently drops one id, exactly as a soft-deleted or
    // cross-tenant row would in Postgres. There is no RETURNING-count guard on
    // the DELETE path (clearing an already-empty month is not an error), so
    // `cleared` must reflect what was actually deleted.
    dropOneReturnedRow = true;

    const res = await post([], "2026-08-15", ["learner-a", "learner-b"]);

    expect(res).toEqual({ ok: true, data: { upserted: 0, cleared: 1 } });
  });

  it("aborts the whole batch when a clear id is in another tenant", async () => {
    const res = await post([], "2026-08-15", [CROSS_TENANT_LEARNER]);

    expect(res.ok).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("never calls prisma.learner.update — intake profile fields are untouched", async () => {
    await post([entry("learner-a")], "2026-08-15", []);
    await post([], "2026-08-15", ["learner-b"]);

    expect(learnerUpdate).not.toHaveBeenCalled();
  });
});

describe("bulkRecordMonthlyReadingLevel — the deadline gate", () => {
  it("refuses before any learner query when the window is locked", async () => {
    resolveMonthlyReadingLevelWindow.mockResolvedValue({
      writable: false,
      reason: "locked",
      deadline: new Date(2026, 8, 7),
      grantId: null,
      grantKind: null,
    });

    const res = await post([entry("learner-a")]);

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe(
      "This month is locked. Editing closed on September 7, 2026."
    );
    // The whole point of ordering the gate first: a refused save never reads
    // the roster and never opens a transaction.
    expect(learnerFindMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("succeeds through a school-wide grant and writes UNLOCK_SCHOOL_GRANT_USED against SchoolUnlockGrant", async () => {
    // A school-wide grant lives in a DIFFERENT table (`SchoolUnlockGrant`) than
    // a personal one (`UnlockGrant`). Joining its id against `UnlockGrant`
    // would find nothing, so the second audit row must name the right table —
    // both in `action` and in `resource` — not just carry `grantKind` in
    // `metadata`.
    resolveMonthlyReadingLevelWindow.mockResolvedValue({
      writable: true,
      reason: "granted",
      deadline: new Date(2026, 8, 7),
      grantId: "grant-99",
      grantKind: "school",
    });

    const res = await post([entry("learner-a")]);

    expect(res).toEqual({ ok: true, data: { upserted: 1, cleared: 0 } });
    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(writeAudit.mock.calls[0][0]).toMatchObject({
      action: "READING_LEVEL_BULK_RECORD",
      metadata: expect.objectContaining({ grantKind: "school" }),
    });
    expect(writeAudit.mock.calls[1][0]).toMatchObject({
      action: "UNLOCK_SCHOOL_GRANT_USED",
      resource: "SchoolUnlockGrant",
      resourceId: "grant-99",
      metadata: expect.objectContaining({
        scope: "MONTHLY_READING_LEVEL",
        targetKey: "2026-08-01",
        grantKind: "school",
      }),
    });
  });

  it("succeeds through a personal grant and still writes UNLOCK_GRANT_USED against UnlockGrant", async () => {
    resolveMonthlyReadingLevelWindow.mockResolvedValue({
      writable: true,
      reason: "granted",
      deadline: new Date(2026, 8, 7),
      grantId: "grant-42",
      grantKind: "user",
    });

    const res = await post([entry("learner-a")]);

    expect(res).toEqual({ ok: true, data: { upserted: 1, cleared: 0 } });
    expect(writeAudit.mock.calls[1][0]).toMatchObject({
      action: "UNLOCK_GRANT_USED",
      resource: "UnlockGrant",
      resourceId: "grant-42",
      metadata: expect.objectContaining({ grantKind: "user" }),
    });
  });

  it("writes no second audit row when the save was in-window", async () => {
    await post([entry("learner-a")]);

    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});
