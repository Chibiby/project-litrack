import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for `exportMosyReport`. Real: Zod schema, `action()`,
 * `parseInput`, `loadMosyExport`, `buildMosyExportTable`, the where builders.
 * Faked: Prisma leaves, session, audit, active school year, report frame and
 * the renderer (the table it is handed is captured and asserted instead).
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID = "school-1";
const FOREIGN_GRADE = "grade-of-another-school";
const FOREIGN_SECTION = "section-of-another-school";
const YEAR = { id: "year-1", label: "2026-2027", startDateKey: "2026-06-08", endDateKey: "2027-03-31", overrides: [] };
const TODAY = new Date(2026, 11, 15, 12, 0, 0);

const learnerCount = vi.fn();
const learnerFindMany = vi.fn();
const gradeFindFirst = vi.fn();
const sectionFindFirst = vi.fn();
const reportCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { count: (a: unknown) => learnerCount(a), findMany: (a: unknown) => learnerFindMany(a) },
    gradeLevel: { findFirst: (a: unknown) => gradeFindFirst(a) },
    section: { findFirst: (a: unknown) => sectionFindFirst(a) },
    report: { create: (a: unknown) => reportCreate(a), createMany: (a: unknown) => reportCreate(a) },
  },
}));

/** What `resolveMosyAccess` returns for the session user. */
let access: unknown;
const resolveMosyAccess = vi.fn(async (_u: unknown) => access);
vi.mock("@/lib/aral/mosy-access", () => ({
  resolveMosyAccess: (u: unknown) => resolveMosyAccess(u),
}));

// The lock gates saves only. Exporting must never consult it.
const isMosySubmissionLocked = vi.fn(async () => true);
vi.mock("@/lib/settings/system-settings", () => ({
  isMosySubmissionLocked: () => isMosySubmissionLocked(),
}));

const requireSchoolUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...a),
}));

const writeAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/audit", async () => {
  const actions = await import("@/lib/audit-actions");
  return { writeAudit: (...a: unknown[]) => writeAudit(...a), AUDIT_ACTIONS: actions.AUDIT_ACTIONS };
});

let activeYear: typeof YEAR | null;
const getActiveSchoolYear = vi.fn(async (_schoolId: string) => activeYear);
vi.mock("@/lib/cache/school-year", () => ({
  getActiveSchoolYear: (id: string) => getActiveSchoolYear(id),
}));

const loadReportFrame = vi.fn(async (_a: unknown) => ({
  schoolName: "Malandag ES",
  schoolIdCode: "1",
  region: "",
  division: "",
  district: "",
  address: "",
  schoolYearLabel: "2026-2027",
  schoolHeadName: "",
  preparedBy: "Marivic Santos",
}));
vi.mock("@/lib/reports/sheet-header", () => ({
  loadReportFrame: (a: unknown) => loadReportFrame(a),
}));

const renderReport = vi.fn(async (..._a: unknown[]) => Buffer.from("FILE-BYTES"));
vi.mock("@/lib/reports/render", () => ({
  renderReport: (...a: unknown[]) => renderReport(...a),
}));

vi.mock("@/lib/date-keys", async (orig) => {
  const actual = await orig<typeof import("@/lib/date-keys")>();
  return { ...actual, schoolToday: () => TODAY };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "REF-1") }));

const { exportMosyReport } = await import("@/lib/actions/aral-mosy-export");

function form(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("format", "EXCEL");
  fd.set("purpose", "PRINT");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function learnerRow(over: Record<string, unknown> = {}) {
  return {
    id: "l-1",
    fullName: "Juan Cruz",
    firstName: "Juan",
    middleName: null,
    lastName: "Cruz",
    gradeLevelId: "grade-4",
    isAralLearner: true,
    gradeLevel: { type: "G4" },
    section: { name: "A" },
    mosyDecisions: [
      { mosyLevel: "INSTRUCTIONAL_DEVELOPING", decision: "STAY", reason: null, improvedToLevel: null, remarks: "Ana Cruz has epilepsy", updatedAt: new Date() },
    ],
    filipinoReadingProfile: "FRUSTRATION_HIGH_EMERGENT",
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    ...over,
  };
}

function listWhere() {
  const call = learnerFindMany.mock.calls
    .map((c) => c[0] as { where: Record<string, unknown> })
    .at(0);
  return call!.where;
}

function renderedTable() {
  return renderReport.mock.calls[0]![0] as {
    blocks: { heading: string; rows: unknown[][] }[];
    summary: string[];
    gradeSection: { gradeLevel?: string; section?: string; label?: string };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  activeYear = YEAR;
  access = { ok: true, sectionIds: ["section-a", "section-b"] };
  requireSchoolUser.mockResolvedValue({
    id: USER_ID,
    schoolId: SCHOOL_ID,
    role: "TEACHER",
    fullName: "Marivic Santos",
  });
  learnerCount.mockResolvedValue(1);
  learnerFindMany.mockResolvedValue([learnerRow()]);
  gradeFindFirst.mockResolvedValue(null);
  sectionFindFirst.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("exportMosyReport", () => {
  it("requires a TEACHER school user", async () => {
    await exportMosyReport(form());
    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");
  });

  it("success returns base64 + a dated Excel filename", async () => {
    const res = await exportMosyReport(form());
    expect(res).toEqual({
      ok: true,
      data: { base64: Buffer.from("FILE-BYTES").toString("base64"), filename: "litrack-mosy-report-2026-12-15.xlsx" },
    });
    expect(renderReport.mock.calls[0]![1]).toBe("EXCEL");
    expect(renderReport.mock.calls[0]![2]).toMatchObject({ purpose: "PRINT" });
  });

  it("PDF gives a .pdf filename", async () => {
    const res = await exportMosyReport(form({ format: "PDF" }));
    expect(res).toMatchObject({ ok: true, data: { filename: "litrack-mosy-report-2026-12-15.pdf" } });
    expect(renderReport.mock.calls[0]![1]).toBe("PDF");
  });

  it("invalid format is VALIDATION_FAILED and nothing is loaded, rendered or audited", async () => {
    const res = await exportMosyReport(form({ format: "DOCX" }));
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(learnerFindMany).not.toHaveBeenCalled();
    expect(renderReport).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("missing format is VALIDATION_FAILED", async () => {
    const fd = new FormData();
    fd.set("purpose", "PRINT");
    const res = await exportMosyReport(fd);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(renderReport).not.toHaveBeenCalled();
  });

  it("no active school year fails with no data read and no audit", async () => {
    activeYear = null;
    const res = await exportMosyReport(form());
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(getActiveSchoolYear).toHaveBeenCalledWith(SCHOOL_ID);
    expect(learnerFindMany).not.toHaveBeenCalled();
    expect(renderReport).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("the scope is the session teacher's advisory sections, never the input", async () => {
    const res = await exportMosyReport(
      form({ teacherId: "someone-else", tutorId: "someone-else", sectionIds: "section-z" })
    );
    expect(res).toMatchObject({ ok: true });
    expect(resolveMosyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID, schoolId: SCHOOL_ID })
    );
    const json = JSON.stringify(listWhere());
    expect(json).toContain('"sectionId":{"in":["section-a","section-b"]}');
    expect(json).not.toContain("someone-else");
    expect(json).not.toContain("section-z");
    expect(json).not.toContain(USER_ID);
  });

  it("still exports while MOSY submissions are locked", async () => {
    const res = await exportMosyReport(form());
    expect(res).toMatchObject({ ok: true });
    expect(isMosySubmissionLocked).not.toHaveBeenCalled();
  });

  it.each([
    ["volunteer", "MOSY Report is for DepEd teachers who advise a section."],
    ["floating", "Floating teachers do not advise a section, so there is no MOSY Report."],
    ["no_advisory", "You have no advisory section yet."],
  ])("a %s teacher is refused and nothing is loaded, rendered or audited", async (reason, message) => {
    access = { ok: false, reason, message };
    const res = await exportMosyReport(form());
    expect(res).toMatchObject({ ok: false, error: message });
    expect(learnerFindMany).not.toHaveBeenCalled();
    expect(renderReport).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
  it("schoolId is pinned to the session even if the form posts another", async () => {
    await exportMosyReport(form({ schoolId: "school-2" }));
    expect(listWhere()).toMatchObject({ schoolId: SCHOOL_ID });
    expect(JSON.stringify(listWhere())).not.toContain("school-2");
    expect(loadReportFrame).toHaveBeenCalledWith(expect.objectContaining({ schoolId: SCHOOL_ID }));
  });

  it("a Super Admin session gets the whole-school scope (no section filter), still on the session school", async () => {
    access = { ok: true, sectionIds: null };
    requireSchoolUser.mockResolvedValue({ id: "sa-1", schoolId: SCHOOL_ID, role: "SUPER_ADMIN", fullName: "Admin" });
    const res = await exportMosyReport(form());
    expect(res).toMatchObject({ ok: true });
    expect(listWhere()).toMatchObject({ schoolId: SCHOOL_ID });
    expect(JSON.stringify(listWhere())).not.toContain("sa-1");
    expect(JSON.stringify(listWhere())).not.toContain('"sectionId":{');
  });

  it("a foreign grade/section id is scoped to the session school: lookups pinned, no labels leak", async () => {
    // Prisma would return null for a grade/section outside schoolId; the fake honours the where.
    gradeFindFirst.mockImplementation(async ({ where }: { where: { schoolId: string } }) =>
      where.schoolId === "school-2" ? { type: "G4" } : null
    );
    sectionFindFirst.mockImplementation(async ({ where }: { where: { schoolId: string } }) =>
      where.schoolId === "school-2" ? { name: "Secret" } : null
    );
    learnerFindMany.mockResolvedValue([]);
    learnerCount.mockResolvedValue(0);
    const res = await exportMosyReport(form({ grade: FOREIGN_GRADE, section: FOREIGN_SECTION }));
    expect(res).toMatchObject({ ok: true });
    expect(gradeFindFirst.mock.calls[0]![0]).toMatchObject({ where: { id: FOREIGN_GRADE, schoolId: SCHOOL_ID } });
    expect(sectionFindFirst.mock.calls[0]![0]).toMatchObject({ where: { id: { equals: FOREIGN_SECTION, in: ["section-a", "section-b"] }, schoolId: SCHOOL_ID } });
    expect(listWhere()).toMatchObject({ schoolId: SCHOOL_ID, gradeLevelId: FOREIGN_GRADE });
    const t = renderedTable();
    const learners = t.blocks.find((b) => b.heading === "Learners")!;
    expect(learners.rows).toHaveLength(0);
    // no label resolved -> header falls back to the unlabelled scope
    expect(t.gradeSection).toEqual({ label: "All Classes" });
    expect(JSON.stringify(t)).not.toContain("Secret");
  });

  it("selects the BOSY profiles on the learner, prints them under 'BOSY level', and reads no monthly records", async () => {
    await exportMosyReport(form());
    const select = (learnerFindMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    expect(select.filipinoReadingProfile).toBe(true);
    expect(select.englishReadingProfile).toBe(true);
    expect(select).not.toHaveProperty("readingLevels");
    const learners = renderedTable().blocks.find((b) => b.heading === "Learners")! as unknown as {
      columns: { header: string }[];
      rows: unknown[][];
    };
    expect(learners.columns.map((c) => c.header)).toContain("BOSY level");
    expect(learners.columns.map((c) => c.header)).not.toContain("Previous level");
    expect(learners.rows[0]![3]).toBe("Fil: Frustration · Eng: Instructional");
  });

  it("the Summary block carries the five stats", async () => {
    await exportMosyReport(form());
    const summary = renderedTable().blocks.find((b) => b.heading === "Summary")!;
    expect(summary.rows).toHaveLength(5);
  });

  it("audits ARAL_MOSY_EXPORT with counts and ids, never the search text or remarks", async () => {
    const res = await exportMosyReport(form({ q: "  cruz  ", status: "stay", grade: "grade-4", section: "section-a" }));
    expect(res).toMatchObject({ ok: true });
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const call = writeAudit.mock.calls[0]![0] as { action: string; userId: string; schoolId: string; metadata: Record<string, unknown> };
    expect(call).toMatchObject({ action: "ARAL_MOSY_EXPORT", userId: USER_ID, schoolId: SCHOOL_ID });
    expect(call.metadata).toMatchObject({
      schoolId: SCHOOL_ID,
      schoolYearId: YEAR.id,
      format: "EXCEL",
      status: "stay",
      gradeLevelId: "grade-4",
      section: "section-a",
      hasSearch: true,
      rows: 1,
      totalMatching: 1,
      truncated: false,
    });
    expect(call.metadata).not.toHaveProperty("q");
    expect(call.metadata).not.toHaveProperty("remarks");
    const json = JSON.stringify(call);
    expect(json).not.toContain("cruz");
    expect(json).not.toContain("epilepsy");
  });

  it("ARAL_MOSY_EXPORT is a security audit action, so writeAudit will not drop it", async () => {
    const { SECURITY_AUDIT_ACTIONS } = await import("@/lib/audit-actions");
    expect(SECURITY_AUDIT_ACTIONS).toContain("ARAL_MOSY_EXPORT");
  });

  it("writes no Report history row", async () => {
    await exportMosyReport(form());
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("unfiltered export sends null grade in the audit and no search flag", async () => {
    await exportMosyReport(form());
    const call = writeAudit.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(call.metadata).toMatchObject({ gradeLevelId: null, section: "all", hasSearch: false, status: "all" });
  });
});
