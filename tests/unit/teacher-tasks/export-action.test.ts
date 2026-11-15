import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import type { TeacherTaskRow, TeacherTaskSummary } from "@/lib/teacher-tasks/types";

/**
 * `exportTeacherTasks`: authorization, which school the export reads, the
 * Super Admin school checks, the audit row, and the filters it forwards.
 * `resolveSchoolContext` is the REAL one (its Prisma, audit, redirect and
 * `after` dependencies are faked), so "a School Head's schoolId is ignored" is
 * proven against the real resolver and not against a mock that agrees.
 */

type Role = "SCHOOL_HEAD" | "TEACHER" | "SUPER_ADMIN";
let sessionUser: { id: string; role: Role; schoolId: string | null; fullName: string } | null;

vi.mock("server-only", () => ({}));

const requireUser = vi.fn(async (roles?: Role | Role[]) => {
  if (!sessionUser) throw new AppError("AUTH_NOT_SIGNED_IN");
  const allowed = roles === undefined ? null : Array.isArray(roles) ? roles : [roles];
  // Mirrors the real guard: Super Admin passes every role check.
  if (allowed && sessionUser.role !== "SUPER_ADMIN" && !allowed.includes(sessionUser.role)) {
    throw new AppError("AUTH_FORBIDDEN", { params: { what: "this page" } });
  }
  return sessionUser;
});
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...(a as [])),
  requireSchoolUser: vi.fn(),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-actions")>("@/lib/audit-actions");
  return { writeAudit: (...a: unknown[]) => writeAudit(...a), AUDIT_ACTIONS: actual.AUDIT_ACTIONS };
});
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "REF-1") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateTeacherTasks: vi.fn() }));

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  unstable_rethrow: () => {},
}));
vi.mock("next/server", () => ({
  after: () => {
    // No request scope: the real resolver falls back to running it inline.
    throw new Error("no request scope");
  },
}));

let schoolRow: { id: string } | null;
const schoolFindFirst = vi.fn(async () => schoolRow);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findFirst: (...a: unknown[]) => schoolFindFirst(...(a as [])) },
    auditLog: { findFirst: vi.fn(async () => null) },
  },
}));

const renderExcel = vi.fn(async () => Buffer.from("xlsx-bytes"));
vi.mock("@/lib/reports/render", () => ({ renderExcel: (...a: unknown[]) => renderExcel(...(a as [])) }));
const loadReportFrame = vi.fn(async () => ({ frame: true }));
vi.mock("@/lib/reports/sheet-header", () => ({
  loadReportFrame: (...a: unknown[]) => loadReportFrame(...(a as [])),
}));
const buildTable = vi.fn((_input: unknown) => ({ table: true }));
vi.mock("@/lib/teacher-tasks/export", () => ({
  buildTeacherTasksExportTable: (input: unknown) => buildTable(input),
}));

function row(teacherId: string, pendingKinds: TeacherTaskRow["pendingKinds"]): TeacherTaskRow {
  return {
    teacherId,
    name: teacherId,
    advisorySections: [],
    tasks: {} as TeacherTaskRow["tasks"],
    pendingKinds,
    remindedToday: false,
  };
}

let summaryRows: TeacherTaskRow[];
const loadSummary = vi.fn(async (_schoolId: string, _todayKey: string) => {
  return {
    todayKey: _todayKey,
    rows: summaryRows,
    teachersWithPending: summaryRows.filter((r) => r.pendingKinds.length > 0).length,
  } as unknown as TeacherTaskSummary;
});
vi.mock("@/lib/teacher-tasks/queries", () => ({
  loadTeacherTaskSummaryFresh: (...a: unknown[]) => loadSummary(...(a as [string, string])),
}));

import { exportTeacherTasks } from "@/lib/actions/teacher-tasks";

const SCHOOL = "school-1";

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = { id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL, fullName: "Head One" };
  schoolRow = { id: "school-9" };
  summaryRows = [row("t-a", ["MOSY", "ATTENDANCE"]), row("t-b", ["ATTENDANCE"]), row("t-c", [])];
});

describe("exportTeacherTasks - authorization", () => {
  it("rejects an unauthenticated caller before reading anything", async () => {
    sessionUser = null;
    const res = await exportTeacherTasks({});
    expect(res.ok).toBe(false);
    expect(loadSummary).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a TEACHER: no data loaded, no file, no audit row", async () => {
    sessionUser = { id: "t-1", role: "TEACHER", schoolId: SCHOOL, fullName: "T" };
    const res = await exportTeacherTasks({});
    expect(res).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(requireUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    expect(loadSummary).not.toHaveBeenCalled();
    expect(renderExcel).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("exportTeacherTasks - which school", () => {
  it("a School Head's own school is exported and a client-supplied schoolId is ignored (tenancy)", async () => {
    const res = await exportTeacherTasks({ schoolId: "school-victim" });
    expect(res.ok).toBe(true);
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadSummary.mock.calls[0]![0]).toBe(SCHOOL);
    expect(loadReportFrame).toHaveBeenCalledWith(expect.objectContaining({ schoolId: SCHOOL }));
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ schoolId: SCHOOL, resourceId: SCHOOL }));
    // The head path never looks the school up from client input.
    expect(schoolFindFirst).not.toHaveBeenCalled();
  });

  it("a Super Admin without a schoolId is refused before any school is resolved", async () => {
    sessionUser = { id: "admin-1", role: "SUPER_ADMIN", schoolId: null, fullName: "Admin" };
    const res = await exportTeacherTasks({});
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(redirect).not.toHaveBeenCalled();
    expect(loadSummary).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a Super Admin with a live school exports that school", async () => {
    sessionUser = { id: "admin-1", role: "SUPER_ADMIN", schoolId: null, fullName: "Admin" };
    schoolRow = { id: "school-9" };
    const res = await exportTeacherTasks({ schoolId: "school-9" });
    expect(res.ok).toBe(true);
    expect(schoolFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "school-9", deletedAt: null } })
    );
    expect(loadSummary.mock.calls[0]![0]).toBe("school-9");
  });

  it("a Super Admin naming a deleted or unknown school gets NOT_FOUND and no file or audit row", async () => {
    sessionUser = { id: "admin-1", role: "SUPER_ADMIN", schoolId: null, fullName: "Admin" };
    schoolRow = null;
    const res = await exportTeacherTasks({ schoolId: "school-gone" });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(schoolFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "school-gone", deletedAt: null } })
    );
    expect(loadSummary).not.toHaveBeenCalled();
    expect(renderExcel).not.toHaveBeenCalled();
    expect(
      writeAudit.mock.calls.some((c) => (c[0] as { action: string }).action === "TEACHER_TASKS_EXPORT")
    ).toBe(false);
  });
});

describe("exportTeacherTasks - audit", () => {
  it("writes one TEACHER_TASKS_EXPORT row with ids, filters and counts only", async () => {
    const res = await exportTeacherTasks({ onlyPending: true, kind: "ATTENDANCE" });
    expect(res.ok).toBe(true);
    const exportRows = writeAudit.mock.calls
      .map((c) => c[0] as Record<string, any>)
      .filter((a) => a.action === "TEACHER_TASKS_EXPORT");
    expect(exportRows).toHaveLength(1);
    expect(exportRows[0]).toEqual({
      userId: "head-1",
      schoolId: SCHOOL,
      action: "TEACHER_TASKS_EXPORT",
      resource: "School",
      resourceId: SCHOOL,
      metadata: {
        schoolId: SCHOOL,
        format: "EXCEL",
        kind: "ATTENDANCE",
        onlyPending: true,
        scope: "ALL",
        rows: 2,
        teachers: 3,
        teachersWithPending: 2,
      },
    });
    // No staff names or ids in the audit metadata.
    const json = JSON.stringify(exportRows[0]!.metadata);
    for (const id of ["t-a", "t-b", "t-c"]) expect(json).not.toContain(id);
  });
});

describe("exportTeacherTasks - filters and result", () => {
  it("defaults list every active teacher across all five tasks", async () => {
    await exportTeacherTasks({});
    const input = buildTable.mock.calls[0]![0] as { rows: TeacherTaskRow[]; kind: unknown; onlyPending: boolean };
    expect(input.kind).toBeNull();
    expect(input.onlyPending).toBe(false);
    expect(input.rows.map((r) => r.teacherId)).toEqual(["t-a", "t-b", "t-c"]);
  });

  it("onlyPending keeps teachers with any pending task", async () => {
    await exportTeacherTasks({ onlyPending: true });
    const input = buildTable.mock.calls[0]![0] as { rows: TeacherTaskRow[]; onlyPending: boolean };
    expect(input.onlyPending).toBe(true);
    expect(input.rows.map((r) => r.teacherId)).toEqual(["t-a", "t-b"]);
  });

  it("kind + onlyPending keeps only teachers pending on that kind and passes the kind through", async () => {
    await exportTeacherTasks({ onlyPending: true, kind: "MOSY" });
    const input = buildTable.mock.calls[0]![0] as { rows: TeacherTaskRow[]; kind: string };
    expect(input.kind).toBe("MOSY");
    expect(input.rows.map((r) => r.teacherId)).toEqual(["t-a"]);
  });

  it("kind without onlyPending still lists everyone (only the columns narrow)", async () => {
    await exportTeacherTasks({ kind: "READING_LEVEL" });
    const input = buildTable.mock.calls[0]![0] as { rows: TeacherTaskRow[]; kind: string };
    expect(input.kind).toBe("READING_LEVEL");
    expect(input.rows).toHaveLength(3);
  });

  it("rejects an unknown kind", async () => {
    const res = await exportTeacherTasks({ kind: "NOPE" as never });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(loadSummary).not.toHaveBeenCalled();
  });

  it("returns the rendered file as base64 under a dated .xlsx name", async () => {
    const res = await exportTeacherTasks({});
    expect(res.ok).toBe(true);
    const data = (res as { data: { base64: string; filename: string } }).data;
    expect(Buffer.from(data.base64, "base64").toString()).toBe("xlsx-bytes");
    expect(data.filename).toMatch(/^litrack-teacher-tasks-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(loadReportFrame).toHaveBeenCalledWith({ schoolId: SCHOOL, preparedBy: "Head One" });
  });
});
