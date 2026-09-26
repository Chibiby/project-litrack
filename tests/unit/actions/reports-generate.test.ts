import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 20s, not the 5s default. The first test in this file pays for the dynamic
 * `import("exceljs")` and the zip write; run alone it finishes in ~2s, but under
 * a full `vitest run` the workers contend and it crosses 5s intermittently. The
 * timeout is the flake, not the code — so it is raised here rather than made
 * global, and only in the files that unzip a workbook.
 */
vi.setConfig({ testTimeout: 20_000 });

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
// Aug 24-28, 2026 are Mon-Fri (5 weekdays, no weekend to drop) — matched by
// the mocked active school year below, so the default (no filter) grid range
// is deterministic: 5 dates x 1 in-scope learner = 5 rows.
const attendanceFindMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [
  {
    date: new Date(2026, 7, 25),
    status: "ABSENT",
    notes: "Sick / Illness",
    learnerId: "learner-1",
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

// A DepEd teacher advising a section by default — no report kind is locked
// for this fixture unless a test overrides it.
let teacherProfileFixture: { designation: string | null; advisoryMode: string } | null = {
  designation: null,
  advisoryMode: "DEFAULT",
};
const teacherProfileFindFirst = vi.fn(async () => teacherProfileFixture);

// `learner.findMany` backs the grid builders' roster read (Attendance /
// Reading Level); the fixture learner matches the attendance row above so a
// grid cell exists for it, and `attendanceFindMany`'s single-arg style
// above the mock stays the shape these tenancy/audit assertions read.
const learnerFindMany = vi.fn(async () => [
  {
    id: "learner-1",
    firstName: "Asriel Gabby",
    middleName: "B.",
    lastName: "Andrews",
    gradeLevel: { type: "G3" },
    section: { name: "A" },
  },
]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findFirst: async () => ({ name: "Malandag Central Elem." }) },
    attendance: {
      findMany: (...a: unknown[]) =>
        attendanceFindMany(...(a as [{ where: Record<string, unknown> }])),
    },
    learner: { findMany: () => learnerFindMany() },
    section: { findFirst: (...a: unknown[]) => sectionFindFirst(...(a as [never])) },
    gradeLevel: { findFirst: (...a: unknown[]) => gradeFindFirst(...(a as [never])) },
    schoolYear: {
      findFirst: async () => ({ startDate: new Date(2026, 7, 24), endDate: new Date(2026, 7, 28) }),
    },
    teacherProfile: {
      findFirst: () => teacherProfileFindFirst(),
    },
    termGrade: { findMany: async () => [] },
    termSubject: { findMany: async () => [] },
    report: { create: (...a: unknown[]) => reportCreate(...(a as [never])) },
    // `loadReportFooter` (`src/lib/reports/sheet-header.ts`) reads the
    // school's School Head once for the shared footer's "Noted by" field;
    // no test here asserts on its content.
    user: { findFirst: async () => null },
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
  teacherProfileFixture = { designation: null, advisoryMode: "DEFAULT" };
});

describe("generateReport — locked report kinds", () => {
  const VOLUNTEER_MESSAGE = "End of Term grades are for DepEd teachers who advise a section.";
  const FLOATING_MESSAGE =
    "Floating teachers do not advise a section, so there are no term grades to report.";

  it("refuses TERM_GRADES for a Non-DepEd ARAL Volunteer, before any builder query", async () => {
    teacherProfileFixture = { designation: "Non-DepEd ARAL Volunteer", advisoryMode: "DEFAULT" };

    const res = await generateReport({ kind: "TERM_GRADES", format: "EXCEL" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED", error: VOLUNTEER_MESSAGE });
    expect(reportCreate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses TERM_GRADES for a FLOATING DepEd teacher", async () => {
    teacherProfileFixture = { designation: null, advisoryMode: "FLOATING" };

    const res = await generateReport({ kind: "TERM_GRADES", format: "EXCEL" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED", error: FLOATING_MESSAGE });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("does not lock a DepEd teacher with a live advisory", async () => {
    teacherProfileFixture = { designation: null, advisoryMode: "DEFAULT" };

    const res = await generateReport({ kind: "TERM_GRADES", format: "EXCEL" });

    expect(res.ok).toBe(true);
  });

  it("never locks a SCHOOL_HEAD, even holding a volunteer-shaped profile row", async () => {
    role = "SCHOOL_HEAD";
    userId = HEAD_ID;
    // A School Head is not a TEACHER, so `scope.teacherId` is null and this
    // profile is never even read — set to what would lock a teacher to prove
    // the branch is skipped by construction, not by a lucky designation.
    teacherProfileFixture = { designation: "Non-DepEd ARAL Volunteer", advisoryMode: "FLOATING" };

    const res = await generateReport({ kind: "TERM_GRADES", format: "EXCEL" });

    expect(res.ok).toBe(true);
    expect(teacherProfileFindFirst).not.toHaveBeenCalled();
  });
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

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
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

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
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
    // 5 weekdays (Aug 24-28) x 1 in-scope learner from the fixture — the grid
    // builder always emits one row per date/learner pair, blank or not.
    expect(metadata).toMatchObject({ kind: "ATTENDANCE", format: "EXCEL", rows: 5 });
    expect(JSON.stringify(metadata)).not.toContain("Asriel");
    expect(JSON.stringify(metadata)).not.toContain("Sick / Illness");
  });

  it("defaults the purpose to PRINT, storing it with the filters and in the audit", async () => {
    await generateReport({ kind: "ATTENDANCE", format: "EXCEL" });

    expect((createdReport as { filters: Record<string, unknown> }).filters).toMatchObject({
      purpose: "PRINT",
    });
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({ purpose: "PRINT" });
  });

  it("round-trips RECORDS through the history row, so Re-generate replays it", async () => {
    const first = await generateReport({ kind: "ATTENDANCE", format: "EXCEL", purpose: "RECORDS" });
    if (!first.ok || !first.data) throw new Error("expected a report");
    const saved = (createdReport as { filters: Record<string, unknown> }).filters;
    expect(saved).toMatchObject({ purpose: "RECORDS" });

    // A RECORDS workbook: header at row 3, no images.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(first.data.base64, "base64") as unknown as Parameters<typeof wb.xlsx.load>[0]
    );
    for (const ws of wb.worksheets) {
      expect(ws.getImages()).toHaveLength(0);
      expect(ws.getRow(3).getCell(1).value).toBe("#");
    }

    // Re-generate sends the saved filters back as they were stored.
    await generateReport({ kind: "ATTENDANCE", format: "EXCEL", ...saved });
    expect((createdReport as { filters: Record<string, unknown> }).filters).toEqual(saved);
  });

  it("refuses an unknown purpose before any query", async () => {
    const res = await generateReport({ kind: "ATTENDANCE", format: "EXCEL", purpose: "POSTER" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED", error: "Choose Print or Records" });
    expect(attendanceFindMany).not.toHaveBeenCalled();
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
