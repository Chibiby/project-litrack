import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T9: `exportSummary` (docs/specs/district-admin.md 3.6).
 *
 * - A district admin asking for a district or school outside their assignment
 *   gets NOT_FOUND before any summary query runs.
 * - The facet reads only the ids of in-scope schools.
 * - The audit row carries counts and choices, never a name.
 *
 * `@/lib/auth/admin-scope` and `@/lib/auth/district-scope` are NOT mocked: the
 * point is that the real scope filter reaches the WHERE. Only `requireUser`
 * (the session) and Prisma are.
 */

const assignmentFindMany = vi.fn();
const schoolFindFirst = vi.fn();
const schoolFindMany = vi.fn();
const queryRaw = vi.fn();
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

const renderReport = vi.fn(async () => Buffer.from("file"));
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
  { id: "s-alabel-ces", name: "Alabel Central Elementary School", schoolIdCode: "130001", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: true },
  { id: "s-bagacay", name: "Bagacay Elementary School", schoolIdCode: "130002", district: "Alabel 2", division: "Sarangani", region: "XII", isActive: true },
];

/** Every array of strings bound into summary SQL (the `ANY(ids)` parameters). */
function boundIdArrays(): string[][] {
  return queryRaw.mock.calls.flatMap(([sql]) =>
    (sql as { values: unknown[] }).values.filter(
      (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string") && v.some((x) => x.startsWith("s-"))
    )
  );
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
  schoolFindMany.mockResolvedValue(ALABEL_SCHOOLS);
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

  it("reads only the admin's own districts' schools, and binds only their ids", async () => {
    const res = await exportSummary({ facet: "learners", format: "EXCEL", purpose: "RECORDS" });

    expect(res).toMatchObject({ ok: true, data: { filename: expect.stringMatching(/^litrack-learners-summary-\d{4}-\d{2}-\d{2}\.xlsx$/) } });
    for (const [args] of schoolFindMany.mock.calls) {
      expect(args.where).toEqual({ deletedAt: null, isDemo: false, district: { in: ["Alabel 1", "Alabel 2"] } });
    }
    const arrays = boundIdArrays();
    expect(arrays.length).toBeGreaterThan(0);
    for (const ids of arrays) expect(ids).toEqual(["s-alabel-ces", "s-bagacay"]);
    expect(renderReport).toHaveBeenCalledWith(expect.anything(), "EXCEL", expect.objectContaining({ purpose: "RECORDS" }));
  });

  it("narrows to one assigned district", async () => {
    await exportSummary({ facet: "compliance", format: "PDF", district: "Alabel 2" });

    expect(schoolFindMany.mock.calls[0]![0].where).toEqual({
      deletedAt: null,
      isDemo: false,
      district: { in: ["Alabel 2"] },
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

  it("lets a Super Admin export any district", async () => {
    requireUser.mockResolvedValue(SA);

    const res = await exportSummary({ facet: "profiling", format: "EXCEL", district: "Glan 1" });

    expect(res).toMatchObject({ ok: true });
    expect(assignmentFindMany).not.toHaveBeenCalled();
    expect(schoolFindMany.mock.calls[0]![0].where).toEqual({
      deletedAt: null,
      isDemo: false,
      district: { in: ["Glan 1"] },
    });
  });
});
