import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T9: `exportSummary` (docs/specs/district-admin.md 3.6).
 *
 * - A district admin asking for a district or school outside their assignment
 *   gets NOT_FOUND before any summary query runs.
 * - The summary SQL is division-wide (one shared raw cache entry per facet and
 *   period) and returns other districts' rows too; what is EXPORTED must hold
 *   only the in-scope schools. The tests feed raw rows for out-of-scope and
 *   demo schools and assert on the rendered report table and the audit counts.
 * - The audit row carries counts and choices, never a name.
 *
 * `@/lib/auth/admin-scope`, `@/lib/auth/district-scope`, the scope school list
 * and the `scopeRaw` fence are NOT mocked: the point is that the real scope
 * filter decides what is exported. Only `requireUser` (the session) and Prisma
 * are.
 */

const assignmentFindMany = vi.fn();
const schoolFindFirst = vi.fn();
const schoolFindMany = vi.fn();
const queryRaw = vi.fn();
const executeRaw = vi.fn();
// `queryLearnerRows` wraps its query in `prisma.$transaction` to scope a
// `SET LOCAL work_mem` bump to just that statement; the mock's `tx` exposes
// the same `$queryRaw`/`$executeRaw` stubs so callers don't need to branch.
vi.mock("@/lib/cache/unstable", () => ({ cachedQuery: (fn: () => unknown) => fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    districtAdminAssignment: {
      get findMany() {
        return assignmentFindMany;
      },
    },
    school: {
      get findFirst() {
        return schoolFindFirst;
      },
      get findMany() {
        return schoolFindMany;
      },
    },
    get $queryRaw() {
      return queryRaw;
    },
    get $executeRaw() {
      return executeRaw;
    },
    $transaction: (fn: (tx: { $queryRaw: typeof queryRaw; $executeRaw: typeof executeRaw }) => unknown) =>
      fn({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: { SUMMARY_EXPORT: "SUMMARY_EXPORT" },
}));

vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/demo/session", () => ({ isDemoVisible: async () => false }));

const renderReport = vi.fn(async (..._args: unknown[]) => Buffer.from("file"));
vi.mock("@/lib/reports/render", () => ({
  renderReport: (...args: unknown[]) => renderReport(...(args as [])),
}));

const loadReportFrame = vi.fn();
vi.mock("@/lib/reports/sheet-header", () => ({
  loadReportFrame: (...args: unknown[]) => loadReportFrame(...args),
}));

const reportError = vi.fn(() => "E-TESTREF1");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

const { exportSummary } = await import("@/lib/actions/summary-export");

const DA = { id: "da-1", role: "DISTRICT_ADMIN", schoolId: null, fullName: "Ferdinand Simon" };
const SA = { id: "sa-1", role: "SUPER_ADMIN", schoolId: null, fullName: "John Division" };

const ALABEL_SCHOOLS = [
  { id: "s-alabel-ces", name: "Alabel Central Elementary School", schoolIdCode: "130001", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: true, isDemo: false },
  { id: "s-bagacay", name: "Bagacay Elementary School", schoolIdCode: "130002", district: "Alabel 2", division: "Sarangani", region: "XII", isActive: true, isDemo: false },
];
/** Outside the district admin's assignment. */
const GLAN_SCHOOL = { id: "s-glan-ces", name: "Glan Central Elementary School", schoolIdCode: "130201", district: "Glan 1", division: "Sarangani", region: "XII", isActive: true, isDemo: false };
/** Inside an assigned district, but a demo school: never in a district scope. */
const DEMO_SCHOOL = { id: "s-demo", name: "Demo Sandbox Elementary School", schoolIdCode: "999901", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: true, isDemo: true };
/** The one live division list every scope is cut from. */
const DIVISION_SCHOOLS = [...ALABEL_SCHOOLS, DEMO_SCHOOL, GLAN_SCHOOL];
const OUT_OF_SCOPE_NAMES = ["Glan", "Demo Sandbox"];

/**
 * Learner raw rows as the division-wide SQL returns them: population, a gender
 * split, and an age only this school has. The age list is read out of the
 * data, so an unfenced row would add its age as a column even where `rollUp`
 * drops its counts.
 */
function learnerRaw(schoolId: string, n: number, age: string) {
  return [
    { school_id: schoolId, gt: "G3", field: "population", bucket: "ALL", count: n },
    { school_id: schoolId, gt: "G3", field: "gender", bucket: "FEMALE", count: n },
    { school_id: schoolId, gt: "G3", field: "age", bucket: age, count: n },
  ];
}

function profilingRaw(schoolId: string, n: number) {
  return [
    { school_id: schoolId, who: "TEACHER", field: "accounts", bucket: "ALL", count: n },
    { school_id: schoolId, who: "TEACHER", field: "population", bucket: "ALL", count: n },
    { school_id: schoolId, who: "TEACHER", field: "position", bucket: "TEACHER_I", count: n },
  ];
}

function complianceRaw(schoolId: string, live: number) {
  return {
    school_id: schoolId,
    live,
    non_archived: live,
    pending: 0,
    grades_no_adviser: 0,
    aral: 0,
    incomplete: 0,
    enrollments: live,
    drift: 0,
    last_attendance: null,
    reading: 0,
    last_week: 0,
    has_admin: true,
  };
}

type RenderedTable = {
  frame: { schoolName: string };
  blocks: { heading: string; rows: (string | number | null)[][] }[];
};

function renderedTable(): RenderedTable {
  expect(renderReport).toHaveBeenCalledTimes(1);
  return renderReport.mock.calls[0]![0] as RenderedTable;
}

/** The first column of every exported row: the school name at the `school` level. */
function exportedSchoolNames(table: RenderedTable): Set<string> {
  return new Set(table.blocks.flatMap((b) => b.rows.map((r) => String(r[0]))));
}

function expectNoOutOfScopeSchool(table: RenderedTable) {
  const text = JSON.stringify(table);
  for (const name of OUT_OF_SCOPE_NAMES) expect(text).not.toContain(name);
}

function expectNothingRead() {
  expect(queryRaw).not.toHaveBeenCalled();
  expect(schoolFindMany).not.toHaveBeenCalled();
  expect(renderReport).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(DA);
  assignmentFindMany.mockResolvedValue([{ district: "Alabel 1" }, { district: "Alabel 2" }]);
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  schoolFindMany.mockResolvedValue(DIVISION_SCHOOLS);
  queryRaw.mockResolvedValue([]);
});

describe("exportSummary scope (T9)", () => {
  it("refuses a district outside the admin's assignment as NOT_FOUND before any query", async () => {
    const res = await exportSummary({ facet: "learners", format: "EXCEL", district: "Glan 1" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNothingRead();
  });

  it("refuses a school outside the admin's districts as NOT_FOUND before any summary query", async () => {
    // Scoped lookup misses; the id-only probe finds a live school elsewhere.
    schoolFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "s-glan" });

    const res = await exportSummary({ facet: "learners", format: "PDF", schoolId: "s-glan" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(schoolFindFirst.mock.calls[0]![0].where).toEqual({
      AND: [{ id: "s-glan" }, { deletedAt: null, isDemo: false, district: { in: ["Alabel 1", "Alabel 2"] } }],
    });
    expectNothingRead();
  });

  it("exports only the admin's own districts' schools, though the raw rows hold every school", async () => {
    queryRaw.mockResolvedValueOnce([
      ...learnerRaw("s-alabel-ces", 10, "8"),
      ...learnerRaw("s-bagacay", 20, "9"),
      ...learnerRaw("s-glan-ces", 300, "13"),
      ...learnerRaw("s-demo", 4000, "16"),
    ]);

    const res = await exportSummary({ facet: "learners", format: "EXCEL", purpose: "RECORDS", level: "school" });

    expect(res).toMatchObject({ ok: true, data: { filename: expect.stringMatching(/^litrack-learners-summary-\d{4}-\d{2}-\d{2}\.xlsx$/) } });
    // The raw rows really did carry the other schools: the fence did the work.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(renderReport).toHaveBeenCalledWith(expect.anything(), "EXCEL", expect.objectContaining({ purpose: "RECORDS" }));

    const table = renderedTable();
    expect(exportedSchoolNames(table)).toEqual(
      new Set(["Alabel Central Elementary School", "Bagacay Elementary School"])
    );
    expectNoOutOfScopeSchool(table);
    // Figures are the in-scope schools' only: 10 + 20 girls, never Glan's 300 or the demo's 4000.
    const gender = table.blocks.find((b) => b.heading === "Gender")!;
    const counts = gender.rows.filter((r) => r[1] === "Female").map((r) => r[2]);
    expect(counts.sort()).toEqual([10, 20]);
    // Ages are read from the rows: only the in-scope schools' ages are columns.
    const age = table.blocks.find((b) => b.heading === "Age")!;
    expect(new Set(age.rows.map((r) => r[1]))).toEqual(new Set(["8", "9"]));

    expect(writeAudit.mock.calls[0]![0].metadata).toMatchObject({
      scopeKind: "districts",
      districtCount: 2,
      schoolCount: 2,
    });
  });

  it("narrows to one assigned district", async () => {
    queryRaw.mockResolvedValueOnce([
      complianceRaw("s-alabel-ces", 0),
      complianceRaw("s-bagacay", 5),
      complianceRaw("s-glan-ces", 0),
      complianceRaw("s-demo", 0),
    ]);

    const res = await exportSummary({ facet: "compliance", format: "PDF", district: "Alabel 2", level: "school" });

    expect(res).toMatchObject({ ok: true });
    const table = renderedTable();
    expect(table.frame.schoolName).toBe("Alabel 2 district (1 school)");
    const names = exportedSchoolNames(table);
    expect(names).toContain("Bagacay Elementary School");
    expect(names).not.toContain("Alabel Central Elementary School");
    expect(JSON.stringify(table)).not.toContain("Alabel Central");
    expectNoOutOfScopeSchool(table);
    expect(writeAudit.mock.calls[0]![0].metadata).toMatchObject({
      scopeKind: "districts",
      districtCount: 1,
      schoolCount: 1,
    });
  });

  it("writes an audit row with counts and choices, and no names", async () => {
    await exportSummary({ facet: "attendance", format: "PDF", level: "school" });

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0]![0];
    expect(entry).toMatchObject({
      userId: "da-1",
      schoolId: null,
      action: "SUMMARY_EXPORT",
      metadata: {
        facet: "attendance",
        level: "school",
        scopeKind: "districts",
        districtCount: 2,
        schoolCount: 2,
        format: "PDF",
        purpose: "PRINT",
      },
    });
    const text = JSON.stringify(entry);
    for (const name of ["Alabel Central", "Bagacay", "Alabel 1", "Alabel 2", "Ferdinand"]) {
      expect(text).not.toContain(name);
    }
  });

  it("refuses a School Head or teacher before reading anything", async () => {
    for (const role of ["SCHOOL_HEAD", "TEACHER"]) {
      requireUser.mockResolvedValue({ id: "u-1", role, schoolId: "s-alabel-ces", fullName: "X" });
      const res = await exportSummary({ facet: "learners", format: "EXCEL" });
      expect(res).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    }
    expect(assignmentFindMany).not.toHaveBeenCalled();
    expectNothingRead();
  });

  it("stops at the rate limit before reading anything", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });

    const res = await exportSummary({ facet: "learners", format: "EXCEL" });

    expect(res).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(checkRateLimit).toHaveBeenCalledWith("summary-export:da-1", { limit: 20, windowMs: 600_000 });
    expectNothingRead();
  });

  it("rejects an unknown facet", async () => {
    const res = await exportSummary({ facet: "salaries", format: "EXCEL" });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expectNothingRead();
  });

  it("filters a compliance export to one flag's list and names the file for it", async () => {
    queryRaw.mockResolvedValueOnce([
      {
        school_id: "s-alabel-ces",
        live: 0,
        non_archived: 0,
        pending: 0,
        grades_no_adviser: 0,
        aral: 0,
        incomplete: 0,
        enrollments: 0,
        drift: 0,
        last_attendance: null,
        reading: 0,
        last_week: 0,
        has_admin: true,
      },
      {
        school_id: "s-bagacay",
        live: 5,
        non_archived: 5,
        pending: 0,
        grades_no_adviser: 0,
        aral: 0,
        incomplete: 0,
        enrollments: 5,
        drift: 0,
        last_attendance: null,
        reading: 0,
        last_week: 0,
        has_admin: true,
      },
    ]);

    const res = await exportSummary({ facet: "compliance", format: "EXCEL", flag: "NO_ENCODED_DATA" });

    expect(res).toMatchObject({
      ok: true,
      data: { filename: expect.stringMatching(/^litrack-compliance-no-encoded-data-summary-\d{4}-\d{2}-\d{2}\.xlsx$/) },
    });

    const table = renderReport.mock.calls[0]![0] as {
      blocks: { heading: string; rows: (string | number | null)[][] }[];
    };
    expect(table.blocks).toHaveLength(1);
    expect(table.blocks[0]!.heading).toBe("No encoded data");
    expect(table.blocks[0]!.rows).toHaveLength(1);
    expect(table.blocks[0]!.rows[0]![0]).toBe("Alabel Central Elementary School");

    expect(writeAudit.mock.calls[0]![0].metadata).toMatchObject({
      facet: "compliance",
      flag: "NO_ENCODED_DATA",
    });
  });

  it("rejects an unknown flag before reading anything", async () => {
    const res = await exportSummary({ facet: "compliance", format: "EXCEL", flag: "BOGUS" });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expectNothingRead();
  });

  it("leaves a compliance export unchanged when no flag is chosen", async () => {
    queryRaw.mockResolvedValueOnce([
      {
        school_id: "s-alabel-ces",
        live: 0,
        non_archived: 0,
        pending: 0,
        grades_no_adviser: 0,
        aral: 0,
        incomplete: 0,
        enrollments: 0,
        drift: 0,
        last_attendance: null,
        reading: 0,
        last_week: 0,
        has_admin: true,
      },
      {
        school_id: "s-bagacay",
        live: 5,
        non_archived: 5,
        pending: 0,
        grades_no_adviser: 0,
        aral: 0,
        incomplete: 0,
        enrollments: 5,
        drift: 0,
        last_attendance: null,
        reading: 0,
        last_week: 0,
        has_admin: true,
      },
    ]);

    const res = await exportSummary({ facet: "compliance", format: "EXCEL" });

    expect(res).toMatchObject({
      ok: true,
      data: { filename: expect.stringMatching(/^litrack-compliance-summary-\d{4}-\d{2}-\d{2}\.xlsx$/) },
    });
    const table = renderReport.mock.calls[0]![0] as { blocks: unknown[] };
    // The overview section plus every flag's list (5) plus "no district admin".
    expect(table.blocks.length).toBeGreaterThan(1);
    expect(writeAudit.mock.calls[0]![0].metadata).toMatchObject({ flag: null });
  });

  it("lets a Super Admin export any district", async () => {
    requireUser.mockResolvedValue(SA);

    queryRaw.mockResolvedValueOnce([...profilingRaw("s-alabel-ces", 8), ...profilingRaw("s-glan-ces", 3)]);

    const res = await exportSummary({ facet: "profiling", format: "EXCEL", district: "Glan 1", level: "school" });

    expect(res).toMatchObject({ ok: true });
    expect(assignmentFindMany).not.toHaveBeenCalled();
    const table = renderedTable();
    expect(table.frame.schoolName).toBe("Glan 1 district (1 school)");
    const names = exportedSchoolNames(table);
    expect(names).toContain("Glan Central Elementary School");
    expect(names).not.toContain("Alabel Central Elementary School");
    expect(JSON.stringify(table)).not.toContain("Alabel Central");
    expect(writeAudit.mock.calls[0]![0].metadata).toMatchObject({
      scopeKind: "districts",
      districtCount: 1,
      schoolCount: 1,
    });
  });
});
