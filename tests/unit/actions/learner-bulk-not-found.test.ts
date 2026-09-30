import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bulk archive/delete must not reveal whether a learner id exists in another
 * school. A missing id and a cross-tenant id have to read identically to the
 * caller; only the admin record (severity "security") tells them apart.
 */

const SCHOOL_ID = "school-1";
const TEACHER_ID = "teacher-1";

type Row = { id: string; schoolId: string; teacherId: string; aralTeacherId: null };
let rows: Row[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        rows.filter((r) => args.where.id.in.includes(r.id)),
      updateMany: vi.fn(),
    },
    enrollment: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: async () => ({ id: TEACHER_ID, schoolId: SCHOOL_ID, role: "TEACHER" }),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  writeAuditMany: vi.fn(),
  AUDIT_ACTIONS: {},
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateLearnerScoped: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyAralAssigned: vi.fn() }));

const { archiveLearners, deleteLearners } = await import("@/lib/actions/learner");

function form(ids: string[]) {
  const fd = new FormData();
  for (const id of ids) fd.append("learnerIds", id);
  return fd;
}

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  rows = [
    { id: MINE, schoolId: SCHOOL_ID, teacherId: TEACHER_ID, aralTeacherId: null },
    { id: THEIRS, schoolId: "school-2", teacherId: "teacher-9", aralTeacherId: null },
  ];
});

describe.each([
  ["archiveLearners", archiveLearners],
  ["deleteLearners", deleteLearners],
])("%s — id existence does not leak", (_name, run) => {
  it("gives the same message for a missing id and another school's id", async () => {
    const missing = await run(form([MINE, MISSING]));
    const crossTenant = await run(form([MINE, THEIRS]));

    expect(missing.ok).toBe(false);
    expect(crossTenant.ok).toBe(false);
    expect((missing as { error: string }).error).toBe(
      (crossTenant as { error: string }).error
    );
    expect((missing as { code?: string }).code).toBe("NOT_FOUND");
    expect((missing as { error: string }).error).not.toContain("Some selected");
  });
});
