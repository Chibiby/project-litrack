import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `commitLearnerImport` at scale. The pre-existing `tests/unit/import-csv.test.ts`
 * covers the row mapper and the row schema; nothing covered the commit itself.
 *
 * What is contract here:
 *
 *   - The write is CHUNKED, not per-row. The old loop issued two statements per
 *     learner, so the 500-row cap meant 1000 sequential round trips inside one
 *     transaction — over a ~220 ms link that exceeds Prisma's inherited 5 s budget
 *     long before it finishes, and the whole import dies with `P2028`.
 *   - `Enrollment` rows are derived from what the insert RETURNED, so a learner and
 *     their active enrollment cannot drift apart.
 *   - A failed transaction returns the house `{ ok: false, error }` shape rather
 *     than throwing: the wizard's `handleCommit` has `try/finally` and no `catch`.
 */

const TEACHER_ID = "teacher-marivic";
const SCHOOL_ID = "school-malandag";
const GRADE_ID = "grade-g7";
const YEAR_ID = "sy-2026-2027";

let seq = 0;
let failOnCreate = false;
let activeYear: { id: string } | null;

const createManyAndReturn = vi.fn(
  async (args: { data: Record<string, unknown>[] }) => {
    if (failOnCreate) throw new Error("P2028: transaction already closed");
    return args.data.map((row) => ({
      id: `learner-${++seq}`,
      gradeLevelId: row.gradeLevelId as string,
      sectionId: (row.sectionId as string | null) ?? null,
      isAralLearner: Boolean(row.isAralLearner),
    }));
  }
);

const enrollmentCreateMany = vi.fn(async (_args: { data: unknown[] }) => ({
  count: 0,
}));

const transaction = vi.fn(async (arg: unknown, _options?: unknown) => {
  if (typeof arg !== "function") return arg;
  return (arg as (tx: unknown) => unknown)({
    learner: { createManyAndReturn },
    enrollment: { createMany: enrollmentCreateMany },
  });
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    gradeLevel: {
      findFirst: async (args: { where: Record<string, unknown> }) =>
        args.where.schoolId === SCHOOL_ID && args.where.id === GRADE_ID
          ? { id: GRADE_ID, schoolId: SCHOOL_ID }
          : null,
    },
    // No pre-existing learners, so nothing is flagged as a duplicate against the DB.
    learner: { findMany: async () => [] },
    section: { findMany: async () => [] },
    schoolYear: { findFirst: async () => activeYear },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: async () => ({
    id: TEACHER_ID,
    schoolId: SCHOOL_ID,
    role: "TEACHER",
    profileCompleted: true,
  }),
}));

const writeAudit = vi.fn(async (_e: { metadata: Record<string, unknown> }) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...(a as [never])),
  AUDIT_ACTIONS: { IMPORT_LEARNERS: "IMPORT_LEARNERS" },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateLearnerScoped: vi.fn() }));

const { commitLearnerImport } = await import("@/lib/actions/import-learners");

/** Distinct names and ages, so the in-batch duplicate check keeps every row. */
function rows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    firstName: `Learner${i}`,
    lastName: `Family${i}`,
    age: 7 + (i % 6),
    gender: "FEMALE",
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    parentEducation: "SECONDARY_GRADUATE",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  failOnCreate = false;
  activeYear = { id: YEAR_ID };
});

describe("commitLearnerImport — chunked writes", () => {
  it("imports 500 rows in 5 insert statements, not 500", async () => {
    const res = await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(500) });

    expect(res).toMatchObject({ ok: true, data: { imported: 500 } });
    // The whole import stays ONE transaction — a partial roster is worse than none.
    expect(transaction).toHaveBeenCalledTimes(1);
    // 500 rows at the 100-row chunk size: 5 inserts + 5 enrollment inserts.
    expect(createManyAndReturn).toHaveBeenCalledTimes(5);
    expect(enrollmentCreateMany).toHaveBeenCalledTimes(5);
    const written = createManyAndReturn.mock.calls.reduce(
      (n, call) => n + call[0].data.length,
      0
    );
    expect(written).toBe(500);
  });

  it("passes an explicit timeout and maxWait", async () => {
    await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(3) });

    const options = transaction.mock.calls[0][1] as {
      timeout: number;
      maxWait: number;
    };
    // Prisma's inherited default is 5 s / 2 s, which 500 rows cannot finish in.
    expect(options.timeout).toBeGreaterThan(5_000);
    expect(options.maxWait).toBeGreaterThan(2_000);
  });

  it("derives each enrollment from the learner id the insert returned", async () => {
    await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(2) });

    const created = await createManyAndReturn.mock.results[0].value;
    const enrollments = enrollmentCreateMany.mock.calls[0][0].data as {
      learnerId: string;
      schoolId: string;
      schoolYearId: string;
      status: string;
    }[];
    // Not zipped against the input array: `createManyAndReturn` does not document
    // its row order, and a mismatch would enroll the wrong learner.
    expect(enrollments.map((e) => e.learnerId)).toEqual(
      (created as { id: string }[]).map((c) => c.id)
    );
    for (const e of enrollments) {
      expect(e.schoolId).toBe(SCHOOL_ID);
      expect(e.schoolYearId).toBe(YEAR_ID);
      expect(e.status).toBe("ACTIVE");
    }
  });

  it("still imports learners when no school year is active", async () => {
    // A documented state: creating learners with no active year skips enrollment
    // creation by design rather than refusing the import.
    activeYear = null;

    const res = await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(2) });

    expect(res).toMatchObject({ ok: true, data: { imported: 2 } });
    expect(enrollmentCreateMany).not.toHaveBeenCalled();
  });
});

describe("commitLearnerImport — failure and refusal", () => {
  it("returns the house error shape instead of throwing when the write fails", async () => {
    failOnCreate = true;

    const res = await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(10) });

    expect(res.ok).toBe(false);
    expect(typeof (res as { error: string }).error).toBe("string");
    // Nothing committed, so no audit row claiming an import happened.
    expect(writeAudit).not.toHaveBeenCalled();
    // The refusal is safe: no Prisma error code or stack reaches the client.
    expect((res as { error: string }).error).not.toContain("P2028");
  });

  it("refuses more than 500 rows before opening a transaction", async () => {
    const res = await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(501) });

    expect(res.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses a grade the teacher does not advise", async () => {
    const res = await commitLearnerImport({
      gradeLevelId: "grade-not-mine",
      rows: rows(3),
    });

    expect(res.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it("stamps every learner row with the caller's own tenant and grade", async () => {
    await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(4) });

    for (const row of createManyAndReturn.mock.calls[0][0].data) {
      // Taken from the session, never from the CSV.
      expect(row.schoolId).toBe(SCHOOL_ID);
      expect(row.gradeLevelId).toBe(GRADE_ID);
      expect(row.teacherId).toBe(TEACHER_ID);
    }
  });

  it("logs counts only, never learner PII", async () => {
    await commitLearnerImport({ gradeLevelId: GRADE_ID, rows: rows(3) });

    const metadata = writeAudit.mock.calls[0][0].metadata;
    expect(metadata).toMatchObject({ imported: 3, rowCount: 3 });
    expect(JSON.stringify(metadata)).not.toContain("Learner0");
  });
});
