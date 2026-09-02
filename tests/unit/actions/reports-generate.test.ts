import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `generateReport` — the Reports Hub's one write path.
 *
 * What is contract here, and so asserted rather than assumed:
 *
 *   - A TEACHER is narrowed to their own learners; a SCHOOL_HEAD is not. Both
 *     are pinned to their own school. This is the only place five different
 *     report builders get their tenant predicate, so a miss here is a
 *     cross-tenant leak in every report at once.
 *   - Every id in the filter set is checked against the school BEFORE it
 *     reaches a builder, and a foreign id is refused with the same generic
 *     "Not found" a missing one gets — no existence oracle.
 *   - A history row is written, and it carries no learner PII.
 *   - The audit row carries counts and ids only.
 */

const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";
const TEACHER_ID = "teacher-1";
const HEAD_ID = "head-1";

let role: "TEACHER" | "SCHOOL_HEAD" = "TEACHER";
let userId = TEACHER_ID;

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: userId,
    schoolId: SCHOOL_ID,
    role,
    fullName: "Marivic M Acibar",
  }),
}));

// Typed with its argument so `.mock.calls[0][0].where` is inspectable — the
// tenant predicate is the whole point of this file and it lives in that arg.
const attendanceFindMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [
  {
    date: new Date(2026, 7, 25),
    status: "ABSENT",
    notes: "Sick / Illness",
    learner: {
      fullName: "Asriel Gabby B. Andrews",
      gradeLevel: { type: "G3" },
      section: { name: "A" },
    },
  },
]);

const sectionFindFirst = vi.fn(
  async (args: { where: Record<string, unknown> }) => {
    // Models two tenants in one table: an UNSCOPED lookup returns the foreign
    // section exactly as Postgres would, so dropping `schoolId` goes red.
    const table = [
      { id: "section-1", schoolId: SCHOOL_ID },
      { id: "section-foreign", schoolId: OTHER_SCHOOL_ID },
    ];
    const row = table.find(
      (r) =>
        r.id === args.where.id &&
        (args.where.schoolId === undefined || r.schoolId === args.where.schoolId)
    );
    return row
      ? { id: row.id, name: "A", gradeLevel: { type: "G3" } }
      : null;
  }
);

const gradeFindFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
  const table = [
    { id: "grade-1", schoolId: SCHOOL_ID },
    { id: "grade-foreign", schoolId: OTHER_SCHOOL_ID },
  ];
  const row = table.find(
    (r) =>
      r.id === args.where.id &&
      (args.where.schoolId === undefined || r.schoolId === args.where.schoolId)
  );
  return row ? { id: row.id, type: "G3" } : null;
});

const reportCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
  createdReport = args.data;
  return { id: "report-1" };
});
let createdReport: Record<string, unknown> = {};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findFirst: async () => ({ name: "Malandag Central Elem." }) },
    attendance: {
      findMany: (...a: unknown[]) =>
        attendanceFindMany(...(a as [{ where: Record<string, unknown> }])),
    },
    section: { findFirst: (...a: unknown[]) => sectionFindFirst(...(a as [never])) },
    gradeLevel: { findFirst: (...a: unknown[]) => gradeFindFirst(...(a as [never])) },
    schoolYear: { findFirst: async () => null },
    report: { create: (...a: unknown[]) => reportCreate(...(a as [never])) },
  },
}));

const writeAudit = vi.fn(async (_e: { metadata: Record<string, unknown> }) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...(a as [never])),
  AUDIT_ACTIONS: {
    REPORT_GENERATE: "REPORT_GENERATE",
    REPORT_DELETE: "REPORT_DELETE",
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { generateReport } = await import("@/lib/actions/reports");

beforeEach(() => {
  vi.clearAllMocks();
  role = "TEACHER";
  userId = TEACHER_ID;
  createdReport = {};
});

describe("generateReport — tenancy", () => {
  it("narrows a TEACHER to their own learners", async () => {
    const res = await generateReport({ kind: "ATTENDANCE", format: "EXCEL" });

    expect(res.ok).toBe(true);
    const where = attendanceFindMany.mock.calls[0][0].where as {
      learner: Record<string, unknown>;
    };
    expect(where.learner.schoolId).toBe(SCHOOL_ID);
    // `teacherLearnerScope` owns the OR key: advisory learners OR ARAL learners.
    expect(where.learner.OR).toEqual([
      { teacherId: TEACHER_ID },
      { aralTeacherId: TEACHER_ID },
    ]);
  });

  it("does NOT narrow a SCHOOL_HEAD to a teacher's own learners", async () => {
    role = "SCHOOL_HEAD";
    userId = HEAD_ID;

    const res = await generateReport({ kind: "ATTENDANCE", format: "EXCEL" });

    expect(res.ok).toBe(true);
    const where = attendanceFindMany.mock.calls[0][0].where as {
      learner: Record<string, unknown>;
    };
    // Still pinned to the school — a head sees their whole school and no more.
    expect(where.learner.schoolId).toBe(SCHOOL_ID);
    expect(where.learner.OR).toBeUndefined();
  });

  it("refuses a section from another school, writing nothing", async () => {
    const res = await generateReport({
      kind: "ATTENDANCE",
      format: "EXCEL",
      sectionId: "section-foreign",
    });

    expect(res).toEqual({ ok: false, error: "Not found" });
    expect(attendanceFindMany).not.toHaveBeenCalled();
    expect(reportCreate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();

    // Indistinguishable from a section that does not exist at all — no oracle.
    const missing = await generateReport({
      kind: "ATTENDANCE",
      format: "EXCEL",
      sectionId: "section-nowhere",
    });
    expect(JSON.stringify(missing)).toBe(JSON.stringify(res));
  });

  it("refuses a grade from another school", async () => {
    const res = await generateReport({
      kind: "ATTENDANCE",
      format: "EXCEL",
      gradeLevelId: "grade-foreign",
    });

    expect(res).toEqual({ ok: false, error: "Not found" });
    expect(attendanceFindMany).not.toHaveBeenCalled();
  });
});

describe("generateReport — history and audit", () => {
  it("records the request without storing learner PII", async () => {
    await generateReport({
      kind: "ATTENDANCE",
      format: "EXCEL",
      sectionId: "section-1",
    });

    expect(reportCreate).toHaveBeenCalledTimes(1);
    expect(createdReport).toMatchObject({
      schoolId: SCHOOL_ID,
      createdById: TEACHER_ID,
      kind: "ATTENDANCE",
      format: "EXCEL",
      scopeLabel: "Grade 3 - A",
    });
    // The learner whose absence is in the workbook must not be in the row.
    expect(JSON.stringify(createdReport)).not.toContain("Asriel");
    expect(JSON.stringify(createdReport)).not.toContain("Sick / Illness");
  });

  it("audits counts and ids, never report content", async () => {
    await generateReport({ kind: "ATTENDANCE", format: "EXCEL" });

    const metadata = writeAudit.mock.calls[0][0].metadata;
    expect(metadata).toMatchObject({ kind: "ATTENDANCE", format: "EXCEL", rows: 1 });
    expect(JSON.stringify(metadata)).not.toContain("Asriel");
    expect(JSON.stringify(metadata)).not.toContain("Sick / Illness");
  });

  it("refuses CUSTOM, which has no builder", async () => {
    const res = await generateReport({ kind: "CUSTOM", format: "EXCEL" });

    expect(res.ok).toBe(false);
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects an inverted date range before any query", async () => {
    const res = await generateReport({
      kind: "ATTENDANCE",
      format: "EXCEL",
      from: "2026-09-30",
      to: "2026-09-01",
    });

    expect(res.ok).toBe(false);
    expect(attendanceFindMany).not.toHaveBeenCalled();
  });
});

describe("generateReport — the date range bind", () => {
  it("turns an inclusive `to` into a half-open `lt` on the next day", async () => {
    await generateReport({
      kind: "ATTENDANCE",
      format: "EXCEL",
      from: "2026-08-24",
      to: "2026-08-28",
    });

    const where = attendanceFindMany.mock.calls[0][0].where as {
      date: { gte: Date; lt: Date };
    };
    // Local dates, never parsed through `toISOString()` — the school is UTC+8
    // and a UTC slice would name the previous day.
    expect(where.date.gte.getDate()).toBe(24);
    expect(where.date.gte.getMonth()).toBe(7);
    // The 28th is INCLUDED, so the exclusive bound is the 29th.
    expect(where.date.lt.getDate()).toBe(29);
  });
});
