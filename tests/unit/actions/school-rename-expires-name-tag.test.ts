import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rename must expire `tags.schoolName(schoolId)`, the tag on `getSchoolName`'s
 * 900s cache entry. `revalidateSchoolDashboard` no longer emits it, so each
 * rename path has to call `revalidateSchoolName` itself. This drives the real
 * actions and the real `@/lib/cache/revalidate`, mocking only `next/cache`.
 */

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";

const schoolFindFirst = vi.fn(async (args: { where?: { id?: string } }) =>
  args?.where?.id === SCHOOL_ID ? { district: "Alabel 1" } : null
);
const schoolUpdate = vi.fn(async (_args: unknown) => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findFirst: (...a: unknown[]) => schoolFindFirst(...(a as [never])),
      update: (...a: unknown[]) => schoolUpdate(...(a as [never])),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: vi.fn(async () => ({ id: "head-1", schoolId: SCHOOL_ID })),
  requireUser: vi.fn(),
}));

type Scope = { kind: "division" } | { kind: "districts"; districts: readonly string[] };
let scope: Scope = { kind: "division" };
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: vi.fn(async () => ({ user: { id: "admin-1", role: "SUPER_ADMIN" }, scope })),
  loadSchoolInScope: vi.fn(async (_s: Scope, schoolId: string) => ({ id: schoolId })),
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit: vi.fn(async () => {}) };
});

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: (...a: unknown[]) => revalidateTag(...a),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF") }));

const { updateSchoolInfo, updateSchoolAsAdmin } = await import("@/lib/actions/school-management");
const tags = await import("@/lib/cache/tags");

function expiredTags(): string[] {
  return revalidateTag.mock.calls.map((c) => c[0] as string);
}

function adminForm(): FormData {
  const fd = new FormData();
  fd.set("schoolId", SCHOOL_ID);
  fd.set("name", "Renamed Central ES");
  fd.set("address", "Purok 1");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  scope = { kind: "division" };
});

describe("renaming a school expires the cached school name", () => {
  it("updateSchoolInfo (School Head)", async () => {
    const fd = new FormData();
    fd.set("name", "Renamed Central ES");
    fd.set("address", "Purok 1");

    expect(await updateSchoolInfo(fd)).toMatchObject({ ok: true });
    expect(expiredTags()).toContain(tags.schoolName(SCHOOL_ID));
  });

  it("updateSchoolAsAdmin (Super Admin)", async () => {
    expect(await updateSchoolAsAdmin(adminForm())).toMatchObject({ ok: true });
    expect(expiredTags()).toContain(tags.schoolName(SCHOOL_ID));
  });

  it("updateSchoolAsAdmin (district admin)", async () => {
    scope = { kind: "districts", districts: ["Alabel 1"] };
    expect(await updateSchoolAsAdmin(adminForm())).toMatchObject({ ok: true });
    expect(expiredTags()).toContain(tags.schoolName(SCHOOL_ID));
  });
});
