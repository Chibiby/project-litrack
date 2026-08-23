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
  return params
    .filter((p): p is string => typeof p === "string" && learnerIds.includes(p))
    .map((id) => ({ id: `rlr-${id}` }));
});

const transaction = vi.fn(async (arg: unknown, _options?: unknown) => {
  if (typeof arg === "function") {
    return (arg as (tx: unknown) => unknown)({
      $queryRaw: (...a: unknown[]) => queryRaw(...(a as [never])),
    });
  }
  return arg;
});

const learnerFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
  if (args.where.schoolId !== SCHOOL_ID) return [];
  const requested = (args.where.id as { in: string[] }).in;
  return requested
    .filter((id) => learnerIds.includes(id))
    .map((id) => ({
      id,
      gradeLevelId: GRADE_ID,
      teacherId: TEACHER_ID,
      aralTeacherId: null,
    }));
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    learner: { findMany: (...a: unknown[]) => learnerFindMany(...(a as [never])) },
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
  AUDIT_ACTIONS: { READING_LEVEL_BULK_RECORD: "READING_LEVEL_BULK_RECORD" },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateTeacherDashboard: vi.fn(),
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

function post(entries: Record<string, unknown>[], monthStart = "2026-08-15") {
  return bulkRecordMonthlyReadingLevel({ monthStart, entries });
}

beforeEach(() => {
  vi.clearAllMocks();
  learnerIds = ["learner-a", "learner-b"];
  rawCalls = [];
});

describe("bulkRecordMonthlyReadingLevel — the month anchor", () => {
  it("normalizes any day in the month to the 1st and binds it as text", async () => {
    const res = await post([entry("learner-a")], "2026-08-15");

    expect(res).toEqual({ ok: true, data: { upserted: 1 } });
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

    expect(res).toEqual({ ok: true, data: { upserted: 1 } });
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

    expect(res).toEqual({ ok: true, data: { upserted: 200 } });
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

describe("bulkRecordMonthlyReadingLevel — tenancy", () => {
  it("binds the tenant into the statement", async () => {
    await post([entry("learner-a")]);

    expect(rawCalls[0].params).toContain(SCHOOL_ID);
    expect(rawCalls[0].sql).toContain('l."schoolId" =');
    expect(rawCalls[0].sql).toContain('l."deletedAt" IS NULL');
    expect(rawCalls[0].sql).toContain('l."isAralLearner" = TRUE');
  });

  it("refuses a learner the scoped roster query did not return", async () => {
    const res = await post([entry("learner-other-school")]);

    expect(res.ok).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    // The refusal names nothing that could act as an existence oracle.
    const serialized = JSON.stringify(res);
    for (const secret of [OTHER_SCHOOL_ID, "learner-other-school"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("writes nothing for the valid half of a mixed batch", async () => {
    const res = await post([entry("learner-a"), entry("learner-other-school")]);

    expect(res.ok).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
