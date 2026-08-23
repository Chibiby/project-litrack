// Asia/Manila BEFORE anything constructs a Date. This file's whole subject is the
// gap between local calendar fields and a UTC instant, and on this timezone a
// local midnight is 16:00 the PREVIOUS day in UTC — so a rewrite that bound a JS
// `Date` into a `@db.Date` column would write the wrong day here and the right one
// on Vercel (TZ=UTC), which is the reason this file pins the zone rather than
// trusting the developer's box.
process.env.TZ = "Asia/Manila";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateKey } from "@/lib/date-keys";

/**
 * Action-level coverage for `saveAralWeeklyAttendance`, which had NONE before the
 * bulk-write rewrite.
 *
 * What is contract here, and so asserted rather than assumed:
 *
 *   - The three values the grid's toast is built from are three DIFFERENT
 *     reductions. `cleared` is a sum of rows actually deleted; `remarksApplied` is
 *     a count of LEARNERS whose week had somewhere to put a remark; `remarksSkipped`
 *     is the rest. The old code derived them by indexing `results[i]` off an array
 *     transaction; the set-based rewrite derives them from `RETURNING`, and nothing
 *     else in the repo would notice if one of the three were wrong.
 *   - Every date reaches SQL as a `YYYY-MM-DD` STRING. `Attendance.date` and
 *     `.weekStart` are `@db.Date`, so a bound `Date` object is a silent
 *     off-by-one-day outside production.
 *   - The tenant predicate is BOUND into every statement, not interpolated.
 *
 * The fake Prisma below models an actual `Attendance` table, so the reductions are
 * measured against state rather than against argument shapes.
 */

const TEACHER_ID = "teacher-marivic";
const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const GRADE_ID = "grade-g7";
/** A Monday. 2026-08-24 is a Monday; the save is exercised mid-window. */
const WEEK_START = "2026-08-24";
const TUESDAY = "2026-08-25";

/**
 * `weekStart` is optional only as a fixture convenience: omitted means "the week
 * under test", which is true of every row seeded with a 2026-08-24..30 date. The
 * remark statement filters on it, so a test that seeds OTHER weeks must set it.
 */
type Day = {
  learnerId: string;
  dateKey: string;
  notes: string | null;
  weekStart?: string;
};

let attendance: Day[];
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

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Prisma nests `Prisma.sql` fragments, so the per-row `VALUES (…)` text — casts
 * included — lives one level down from the outer template rather than in it.
 * Splice it back in, or an assertion about `::date` silently examines only the
 * outer statement and passes for the wrong reason.
 */
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

/** `(learnerId, dateKey)` pairs, read as "the first date key after each learner id". */
function pairsFrom(params: unknown[]): { learnerId: string; dateKey: string }[] {
  const pairs: { learnerId: string; dateKey: string }[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (typeof p !== "string" || !learnerIds.includes(p)) continue;
    const date = params
      .slice(i + 1)
      .find((v): v is string => typeof v === "string" && DATE_KEY.test(v));
    if (date) pairs.push({ learnerId: p, dateKey: date });
  }
  return pairs;
}

/**
 * Models the three statements against the fake table above. Deliberately NOT a
 * stub returning fixed counts: `cleared` and `remarksApplied` are only meaningful
 * if the rows that come back depend on what is really there.
 */
const queryRaw = vi.fn(async (strings: readonly string[], ...values: unknown[]) => {
  const sql = renderSql(strings, values);
  const params = flattenBoundParams(values);
  rawCalls.push({ sql, params });

  if (sql.includes('INSERT INTO "Attendance"')) {
    const rows = pairsFrom(params);
    // Each inserted row binds `date` then `weekStart`, so the save's week is the
    // second date key in the list. The stored row has to carry it or the remark
    // statement below cannot filter on it.
    const dateKeys = params.filter(
      (p): p is string => typeof p === "string" && DATE_KEY.test(p)
    );
    const weekStart = dateKeys[1];
    for (const r of rows) {
      const existing = attendance.find(
        (a) => a.learnerId === r.learnerId && a.dateKey === r.dateKey
      );
      if (!existing) {
        attendance.push({
          learnerId: r.learnerId,
          dateKey: r.dateKey,
          notes: null,
          weekStart,
        });
      }
    }
    const marked = rows.map((r) => ({ id: `att-${r.learnerId}-${r.dateKey}` }));
    // One row silently skipped by the JOIN — a soft-deleted or cross-tenant learner.
    // Postgres reports no error for that, so the guard is the only thing that turns
    // it into a refusal instead of a week saved with a hole in it.
    return dropOneReturnedRow ? marked.slice(1) : marked;
  }

  if (sql.includes('DELETE FROM "Attendance"')) {
    const rows = pairsFrom(params);
    const removed: { id: string }[] = [];
    for (const r of rows) {
      const i = attendance.findIndex(
        (a) => a.learnerId === r.learnerId && a.dateKey === r.dateKey
      );
      // Only rows that really exist are deleted — that is what makes `cleared`
      // differ from "cells submitted".
      if (i >= 0) {
        attendance.splice(i, 1);
        removed.push({ id: `att-${r.learnerId}-${r.dateKey}` });
      }
    }
    return removed;
  }

  if (sql.includes('UPDATE "Attendance"')) {
    const ids = params.filter(
      (p): p is string => typeof p === "string" && learnerIds.includes(p)
    );
    // The statement's only bound date key is the week: its VALUES rows are
    // (learnerId, notes). Modelling `a."weekStart" = $n::date` is the whole point
    // of this branch — without it, deleting that predicate from the action lets a
    // remark for one week overwrite `notes` in every other week, silently.
    const weekKey = params.find(
      (p): p is string => typeof p === "string" && DATE_KEY.test(p)
    );
    const touched: { learnerId: string }[] = [];
    for (const id of ids) {
      // A remark lands on every marked day the learner has that week, and on none
      // at all if they have no marked day — the "skipped" case.
      // No week bound at all means the predicate is gone from the statement, so
      // Postgres would match EVERY week. Model that, rather than matching nothing:
      // it makes the mutation fail for the reason it actually breaks production.
      const days = attendance.filter(
        (a) =>
          a.learnerId === id &&
          (weekKey === undefined || (a.weekStart ?? WEEK_START) === weekKey)
      );
      for (const day of days) {
        day.notes = "set";
        touched.push({ learnerId: id });
      }
    }
    return touched;
  }

  throw new Error(`unexpected statement: ${sql}`);
});

const transaction = vi.fn(async (arg: unknown, _options?: unknown) => {
  if (typeof arg === "function") {
    return (arg as (tx: unknown) => unknown)({
      $queryRaw: (...a: unknown[]) => queryRaw(...(a as [never])),
    });
  }
  return arg;
});

const gradeFindFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
  if (args.where.schoolId !== SCHOOL_ID) return null;
  if (args.where.id !== GRADE_ID) return null;
  return { id: GRADE_ID };
});

const dayMetaFindMany = vi.fn(async () => [] as { date: Date }[]);

/**
 * A learner that really exists, in a school this teacher is not in. Its `teacherId`
 * is deliberately this teacher's and its grade is this grade, so the ONLY thing that
 * can exclude it is the `schoolId` scope.
 */
const CROSS_TENANT_LEARNER = "learner-not-mine";

/**
 * Two tenants in one table, modelled so an UNSCOPED query returns the cross-tenant
 * row exactly as Postgres would. Drop `schoolId: user.schoolId` from the action and
 * the row comes back, the length check passes, and the refusal test goes red.
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    gradeLevel: { findFirst: (...a: unknown[]) => gradeFindFirst(...(a as [never])) },
    attendanceDayMeta: { findMany: () => dayMetaFindMany() },
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
  AUDIT_ACTIONS: { ATTENDANCE_WEEK_SAVE: "ATTENDANCE_WEEK_SAVE" },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateTeacherDashboard: vi.fn(),
}));

// `attendanceDeadline` locks a week some days after it ends, so the fake clock has
// to sit inside the editable window for this week.
vi.mock("@/lib/week-range", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, attendanceDeadline: () => new Date(2099, 0, 1) };
});

const { saveAralWeeklyAttendance } = await import("@/lib/actions/attendance");

type Cell = { learnerId: string; date: string; status: string | null };

function post(overrides: {
  cells?: Cell[];
  remarks?: { learnerId: string; notes: string }[];
} = {}) {
  return saveAralWeeklyAttendance({
    gradeId: GRADE_ID,
    weekStart: WEEK_START,
    cells: [],
    remarks: [],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  attendance = [];
  learnerIds = ["learner-a", "learner-b", "learner-c"];
  rawCalls = [];
  dropOneReturnedRow = false;
});

describe("saveAralWeeklyAttendance — the RETURNING count guard", () => {
  it("refuses the whole save when the INSERT writes fewer rows than it was given", async () => {
    // The last defence against a silently skipped row. The JOIN drops any learner
    // that is soft-deleted, non-ARAL, or in another tenant, and Postgres reports NO
    // error — the teacher would be shown a saved week with one learner's marks
    // missing. Nothing else in this file fires the branch, so an inverted or deleted
    // comparison would go unnoticed.
    dropOneReturnedRow = true;

    const res = await post({
      cells: [
        { learnerId: "learner-a", date: TUESDAY, status: "PRESENT" },
        { learnerId: "learner-b", date: TUESDAY, status: "ABSENT" },
      ],
    });

    expect(res).toEqual({
      ok: false,
      error: "Could not save the week. Please try again.",
    });
    expect(writeAudit).not.toHaveBeenCalled();
    // The row count is not leaked to the client.
    expect((res as { error: string }).error).not.toMatch(/\d/);
  });
});

describe("saveAralWeeklyAttendance — the Asia/Manila date bind", () => {
  it("proves the timezone this file runs in actually shifts a UTC instant", () => {
    // The premise. Without this, the assertions below could pass on a UTC box for
    // the wrong reason and the whole point of the file would be lost.
    const localMidnight = new Date(2026, 7, 24);
    expect(localMidnight.getTimezoneOffset()).toBe(-480);
    expect(formatLocalDateKey(localMidnight)).toBe("2026-08-24");
    // This is the defect the bind-as-text rule exists to prevent: the same instant
    // names the PREVIOUS day once it is serialized as UTC.
    expect(localMidnight.toISOString().slice(0, 10)).toBe("2026-08-23");
  });

  it("binds every date as a YYYY-MM-DD string and never a Date", async () => {
    await post({
      cells: [{ learnerId: "learner-a", date: TUESDAY, status: "PRESENT" }],
    });

    const insert = rawCalls.find((c) => c.sql.includes('INSERT INTO "Attendance"'))!;
    // The cell's own day and the week anchor, both as text, cast in SQL.
    expect(insert.params).toContain(TUESDAY);
    expect(insert.params).toContain(WEEK_START);
    expect(insert.sql).toContain("::date");
    // `updatedAt` is a TIMESTAMP(3) instant and is legitimately a Date; the two
    // `@db.Date` columns must not be. So: exactly one Date among the binds.
    const dates = insert.params.filter((p) => p instanceof Date);
    expect(dates).toHaveLength(1);
  });
});

describe("saveAralWeeklyAttendance — the three derived counts", () => {
  it("counts cleared as rows actually deleted, not cells submitted", async () => {
    // The distinction the old `sum of deleteMany counts` encoded: clearing a cell
    // that was never marked deletes nothing and must not be counted.
    attendance = [{ learnerId: "learner-a", dateKey: TUESDAY, notes: null }];

    const res = await post({
      cells: [
        { learnerId: "learner-a", date: TUESDAY, status: null },
        { learnerId: "learner-b", date: TUESDAY, status: null },
      ],
    });

    expect(res.ok).toBe(true);
    expect((res as { data: { cleared: number } }).data.cleared).toBe(1);
  });

  it("counts remarksApplied per LEARNER, not per updated row", async () => {
    // A remark spans every marked day in the learner's week, so counting returned
    // rows would report 3 for one learner. The old code counted STATEMENTS with a
    // non-zero count; the rewrite must count distinct learners to match.
    attendance = [
      { learnerId: "learner-a", dateKey: "2026-08-24", notes: null },
      { learnerId: "learner-a", dateKey: "2026-08-25", notes: null },
      { learnerId: "learner-a", dateKey: "2026-08-26", notes: null },
    ];

    const res = await post({
      remarks: [{ learnerId: "learner-a", notes: "Improving steadily" }],
    });

    expect(res).toMatchObject({
      ok: true,
      data: { upserted: 0, cleared: 0, remarksApplied: 1, remarksSkipped: 0 },
    });
  });

  it("confines a remark to the week being saved", async () => {
    // The remark statement's `a."weekStart" = $n::date` predicate is the only thing
    // stopping a week-3 remark from overwriting `notes` in weeks 1, 2 and 4: the
    // UPDATE otherwise matches on learnerId alone. `Attendance.notes` is per-day,
    // so those other weeks' remarks would be destroyed with no way to recover them.
    attendance = [
      { learnerId: "learner-a", dateKey: "2026-08-11", notes: "week 1", weekStart: "2026-08-10" },
      { learnerId: "learner-a", dateKey: "2026-08-18", notes: "week 2", weekStart: "2026-08-17" },
      { learnerId: "learner-a", dateKey: TUESDAY, notes: null, weekStart: WEEK_START },
      { learnerId: "learner-a", dateKey: "2026-09-01", notes: "week 4", weekStart: "2026-08-31" },
    ];

    const res = await post({
      remarks: [{ learnerId: "learner-a", notes: "this week only" }],
    });

    expect(res).toMatchObject({ ok: true, data: { remarksApplied: 1 } });
    expect(attendance.map((a) => a.notes)).toEqual([
      "week 1",
      "week 2",
      "set",
      "week 4",
    ]);
  });

  it("counts a remark for a learner with no marked day as skipped", async () => {
    // `Attendance.notes` is per-day, so a weekly remark has nowhere to live until
    // the learner has at least one marked day. The grid tells the teacher, so the
    // number has to be right.
    attendance = [{ learnerId: "learner-a", dateKey: TUESDAY, notes: null }];

    const res = await post({
      remarks: [
        { learnerId: "learner-a", notes: "has a marked day" },
        { learnerId: "learner-b", notes: "has none" },
        { learnerId: "learner-c", notes: "has none either" },
      ],
    });

    expect(res).toMatchObject({
      ok: true,
      data: { remarksApplied: 1, remarksSkipped: 2 },
    });
  });

  it("applies a remark to a day created in the same save", async () => {
    // The ordering invariant: the remark UPDATE runs after the mark INSERT, so a
    // first-time entry keeps its remark. Reversing the two would report this as
    // skipped.
    const res = await post({
      cells: [{ learnerId: "learner-a", date: TUESDAY, status: "PRESENT" }],
      remarks: [{ learnerId: "learner-a", notes: "First week back" }],
    });

    expect(res).toMatchObject({
      ok: true,
      data: { upserted: 1, remarksApplied: 1, remarksSkipped: 0 },
    });
    const order = rawCalls.map((c) =>
      c.sql.includes("INSERT") ? "insert" : c.sql.includes("DELETE") ? "delete" : "update"
    );
    expect(order.indexOf("insert")).toBeLessThan(order.indexOf("update"));
  });

  it("does not resurrect a cell cleared in the same save", async () => {
    // Clears are ordered between marks and remarks, as they were before. A remark
    // must not find the day the same save deleted.
    attendance = [{ learnerId: "learner-a", dateKey: TUESDAY, notes: null }];

    const res = await post({
      cells: [{ learnerId: "learner-a", date: TUESDAY, status: null }],
      remarks: [{ learnerId: "learner-a", notes: "gone" }],
    });

    expect(res).toMatchObject({
      ok: true,
      data: { cleared: 1, remarksApplied: 0, remarksSkipped: 1 },
    });
    expect(attendance).toHaveLength(0);
  });

  it("reports all four counts in the audit row, with no remark text", async () => {
    attendance = [{ learnerId: "learner-b", dateKey: TUESDAY, notes: null }];

    await post({
      cells: [
        { learnerId: "learner-a", date: TUESDAY, status: "PRESENT" },
        { learnerId: "learner-b", date: TUESDAY, status: null },
      ],
      remarks: [{ learnerId: "learner-a", notes: "Reads with confidence now" }],
    });

    const metadata = writeAudit.mock.calls[0][0].metadata;
    expect(metadata).toMatchObject({
      upserted: 1,
      cleared: 1,
      remarksApplied: 1,
      remarksSkipped: 0,
    });
    // Remark text is learner PII and never enters an audit row.
    expect(JSON.stringify(metadata)).not.toContain("Reads with confidence");
  });
});

describe("saveAralWeeklyAttendance — payload size and tenancy", () => {
  it("saves a 100-learner week in a handful of statements, not one per cell", async () => {
    // 100 learners x 5 school days = 500 cells, the worst case the cap allows once
    // Task 14 paginates the grid. Per-cell statements were what blew the 5 s
    // transaction budget at roughly 22 cells.
    learnerIds = Array.from({ length: 100 }, (_, i) => `learner-${i}`);
    const days = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"];
    const cells = learnerIds.flatMap((learnerId) =>
      days.map((date) => ({ learnerId, date, status: "PRESENT" }))
    );
    expect(cells).toHaveLength(500);

    const res = await post({ cells });

    expect(res).toMatchObject({ ok: true, data: { upserted: 500 } });
    expect(transaction).toHaveBeenCalledTimes(1);
    // 500 rows at the 100-row chunk size.
    expect(rawCalls).toHaveLength(5);
  });

  it("passes an explicit timeout and maxWait", async () => {
    await post({
      cells: [{ learnerId: "learner-a", date: TUESDAY, status: "PRESENT" }],
    });

    const options = transaction.mock.calls[0][1] as { timeout: number; maxWait: number };
    expect(options.timeout).toBeGreaterThan(5_000);
    expect(options.maxWait).toBeGreaterThan(2_000);
  });

  it("binds the tenant into every statement and never a foreign id", async () => {
    attendance = [{ learnerId: "learner-b", dateKey: TUESDAY, notes: null }];

    await post({
      cells: [
        { learnerId: "learner-a", date: TUESDAY, status: "PRESENT" },
        { learnerId: "learner-b", date: TUESDAY, status: null },
      ],
      remarks: [{ learnerId: "learner-a", notes: "note" }],
    });

    expect(rawCalls).toHaveLength(3);
    for (const call of rawCalls) {
      // Bound, not interpolated — the only witness a raw statement has that the
      // tenant predicate held.
      expect(call.params).toContain(SCHOOL_ID);
      expect(call.params).toContain(GRADE_ID);
      expect(call.sql).toContain('l."schoolId" =');
      expect(call.sql).toContain('l."deletedAt" IS NULL');
    }
    // No `not.toContain(OTHER_SCHOOL_ID)` here: the statements can only ever bind
    // `user.schoolId`, so that assertion could not fail and said nothing. The live
    // cross-tenant probe is the next test.
  });

  it("refuses a learner that exists in another school, writing nothing", async () => {
    // CROSS_TENANT_LEARNER exists in the fake table under OTHER_SCHOOL_ID, with this
    // teacher's own teacherId and this grade — only `schoolId: user.schoolId` on the
    // roster query excludes it. Remove that and this goes red.
    const res = await post({
      cells: [{ learnerId: CROSS_TENANT_LEARNER, date: TUESDAY, status: "PRESENT" }],
    });

    expect(res.ok).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(learnerFindMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL_ID);
    // Indistinguishable from a learner that does not exist at all — no oracle.
    const missing = await post({
      cells: [{ learnerId: "learner-nowhere", date: TUESDAY, status: "PRESENT" }],
    });
    expect(JSON.stringify(missing)).toBe(JSON.stringify(res));
  });
});
