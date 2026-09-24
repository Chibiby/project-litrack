import { beforeEach, describe, expect, it, vi } from "vitest";
// Real, pure — used both by the `loadSchoolInScope` fake below and directly
// by assertions in this file.
import { resourceNotFound as resourceNotFoundReal } from "@/lib/errors/app-error";

/**
 * The three school-management actions district admins now share with the
 * Super Admin: `setSchoolActive` and `updateSchoolAsAdmin`
 * (`src/lib/actions/school-management.ts`), and `regenerateSchoolHeadCredential`
 * (`src/lib/actions/school.ts`).
 *
 * T3 (docs/specs/district-admin.md 8): for each action, a district admin
 * targeting an out-of-scope school gets NOT_FOUND, and — the part that
 * actually matters — no `school.update`/`user.update`, no Supabase Admin
 * call, and no `writeAudit` call happens either. `loadSchoolInScope` is
 * mocked here as a fake that enforces the scope itself (see `SCHOOLS` and
 * `loadSchoolInScope` below): if any action under test stopped calling it and
 * read straight from `prisma.school.findFirst` instead (whose fake below is
 * deliberately dumb and returns any fixture unconditionally), the
 * out-of-scope case would silently succeed and these tests would go red —
 * that dumb/faithful split is what makes "remove the scope check" a red
 * build rather than a no-op.
 */

const ADMIN_ID = "admin-1";
const DA_ID = "da-1";

type SchoolFixture = {
  id: string;
  district: string;
  isActive: boolean;
  schoolIdCode: string;
};

// Valid UUIDs: `regenerateSchoolHeadCredential`'s schema requires `z.string().uuid()`.
const SCHOOL_IN_SCOPE: SchoolFixture = {
  id: "11111111-1111-4111-8111-111111111111",
  district: "Alabel 1",
  isActive: true,
  schoolIdCode: "111111",
};
const SCHOOL_OUT_OF_SCOPE: SchoolFixture = {
  id: "22222222-2222-4222-8222-222222222222",
  district: "Glan 1",
  isActive: true,
  schoolIdCode: "222222",
};
const SCHOOLS: Record<string, SchoolFixture> = {
  [SCHOOL_IN_SCOPE.id]: SCHOOL_IN_SCOPE,
  [SCHOOL_OUT_OF_SCOPE.id]: SCHOOL_OUT_OF_SCOPE,
};

type Scope = { kind: "division" } | { kind: "districts"; districts: readonly string[] };

/** Mirrors `schoolWhereForScope`'s rule without importing the module under test's own dependency. */
function schoolInScope(scope: Scope, school: SchoolFixture): boolean {
  if (scope.kind === "division") return true;
  return scope.districts.includes(school.district);
}

let scope: Scope = { kind: "districts", districts: ["Alabel 1"] };
let actor: { id: string; role: "SUPER_ADMIN" | "DISTRICT_ADMIN"; schoolId: null } = {
  id: DA_ID,
  role: "DISTRICT_ADMIN",
  schoolId: null,
};

const requireAdminScope = vi.fn(async () => ({ user: actor, scope }));

/**
 * The scope check under test. Throws the same NOT_FOUND a missing row gets
 * (`resourceNotFound`, real — pure, not mocked) for a school outside `scope`,
 * exactly like the real `loadSchoolInScope`.
 */
const loadSchoolInScope = vi.fn(async (s: Scope, schoolId: string, _select?: unknown) => {
  const school = SCHOOLS[schoolId];
  if (!school || !schoolInScope(s, school)) {
    throw resourceNotFoundReal("School", { crossTenant: true });
  }
  return school;
});

vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: (...a: unknown[]) => requireAdminScope(...(a as [])),
  loadSchoolInScope: (...a: unknown[]) => loadSchoolInScope(...(a as [Scope, string, unknown])),
}));

// ── prisma: deliberately dumb school.findFirst (see file docstring) ────────
const schoolFindFirst = vi.fn(async (args: { where?: { id?: string } }): Promise<unknown> => {
  const id = args?.where?.id;
  return id ? (SCHOOLS[id] ?? null) : null;
});
const schoolUpdate = vi.fn(async (_args: unknown) => ({}));
const userFindFirst = vi.fn(async (_args: unknown): Promise<unknown> => null);
const userUpdate = vi.fn(async (_args: unknown) => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findFirst: (...a: unknown[]) => schoolFindFirst(...(a as [never])),
      update: (...a: unknown[]) => schoolUpdate(...(a as [never])),
    },
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...(a as [never])),
      update: (...a: unknown[]) => userUpdate(...(a as [never])),
    },
  },
}));

const findSignInSchoolHead = vi.fn(async (schoolId: string) => ({
  id: "head-1",
  authId: "auth-head-1",
  email: "head@school.local",
  schoolId,
}));
vi.mock("@/lib/auth/school-head-sign-in", () => ({
  findSignInSchoolHead: (...a: unknown[]) => findSignInSchoolHead(...(a as [string])),
}));

const updateUserById = vi.fn(async (_authId: string, _attrs: unknown) => ({
  error: null as null | { message: string },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById } } }),
}));

const checkRateLimit = vi.fn(async () => ({ ok: true, retryAfterMs: 0 }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])),
}));

const writeAudit = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    AUDIT_ACTIONS: actual.AUDIT_ACTIONS,
    writeAudit: (e: Record<string, unknown>) => writeAudit(e),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const revalidateSchoolDashboard = vi.fn();
const revalidateSchoolsList = vi.fn();
const revalidateDivisionSummary = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: (...a: unknown[]) => revalidateSchoolDashboard(...(a as [])),
  revalidateSchoolsList: (...a: unknown[]) => revalidateSchoolsList(...(a as [])),
  revalidateDivisionSummary: (...a: unknown[]) => revalidateDivisionSummary(...(a as [])),
}));

const reportError = vi.fn(() => "E-TESTREF");
vi.mock("@/lib/errors/report", () => ({
  reportError: (...a: unknown[]) => reportError(...(a as [])),
}));

const { setSchoolActive, updateSchoolAsAdmin } = await import("@/lib/actions/school-management");
const { regenerateSchoolHeadCredential } = await import("@/lib/actions/school");

function setActiveForm(schoolId: string, isActive = "true"): FormData {
  const fd = new FormData();
  fd.set("schoolId", schoolId);
  fd.set("isActive", isActive);
  return fd;
}

function regenForm(schoolId: string): FormData {
  const fd = new FormData();
  fd.set("schoolId", schoolId);
  return fd;
}

function editForm(schoolId: string, name = "Renamed School"): FormData {
  const fd = new FormData();
  fd.set("schoolId", schoolId);
  fd.set("name", name);
  fd.set("address", "New address");
  return fd;
}

function noWritesHappened() {
  expect(schoolUpdate).not.toHaveBeenCalled();
  expect(userUpdate).not.toHaveBeenCalled();
  expect(updateUserById).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  scope = { kind: "districts", districts: ["Alabel 1"] };
  actor = { id: DA_ID, role: "DISTRICT_ADMIN", schoolId: null };
  requireAdminScope.mockImplementation(async () => ({ user: actor, scope }));
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  updateUserById.mockResolvedValue({ error: null });
  findSignInSchoolHead.mockImplementation(async (schoolId: string) => ({
    id: "head-1",
    authId: "auth-head-1",
    email: "head@school.local",
    schoolId,
  }));
});

describe("setSchoolActive — scope", () => {
  it("as a district admin, refuses an out-of-scope school: NOT_FOUND, and loadSchoolInScope is what refused it", async () => {
    const res = await setSchoolActive(setActiveForm(SCHOOL_OUT_OF_SCOPE.id));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(loadSchoolInScope).toHaveBeenCalledWith(
      scope,
      SCHOOL_OUT_OF_SCOPE.id,
      expect.anything()
    );
    noWritesHappened();
  });

  it("as a district admin, updates an in-scope school and audits with actorRole", async () => {
    const res = await setSchoolActive(setActiveForm(SCHOOL_IN_SCOPE.id, "false"));

    expect(res).toMatchObject({ ok: true });
    expect(schoolUpdate).toHaveBeenCalledWith({
      where: { id: SCHOOL_IN_SCOPE.id },
      data: { isActive: false },
    });
    const entry = writeAudit.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      userId: DA_ID,
      schoolId: SCHOOL_IN_SCOPE.id,
      action: "SCHOOL_SET_ACTIVE",
      metadata: expect.objectContaining({ actorRole: "DISTRICT_ADMIN" }),
    });
    expect(revalidateDivisionSummary).toHaveBeenCalled();
  });

  it("as the Super Admin (division scope), the same out-of-scope-elsewhere school is reachable", async () => {
    scope = { kind: "division" };
    actor = { id: ADMIN_ID, role: "SUPER_ADMIN", schoolId: null };

    const res = await setSchoolActive(setActiveForm(SCHOOL_OUT_OF_SCOPE.id));

    expect(res).toMatchObject({ ok: true });
    expect(schoolUpdate).toHaveBeenCalledTimes(1);
    // No actorRole marker for the Super Admin's own action.
    const entry = writeAudit.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(entry.metadata).not.toHaveProperty("actorRole");
  });
});

describe("regenerateSchoolHeadCredential — scope", () => {
  it("as a district admin, refuses an out-of-scope school before the rate limit, the School Head lookup, Supabase, or the audit row", async () => {
    const res = await regenerateSchoolHeadCredential(regenForm(SCHOOL_OUT_OF_SCOPE.id));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(findSignInSchoolHead).not.toHaveBeenCalled();
    noWritesHappened();
  });

  it("as a district admin, resets an in-scope School Head's password to the School ID and audits via district_portal", async () => {
    const res = await regenerateSchoolHeadCredential(regenForm(SCHOOL_IN_SCOPE.id));

    expect(res).toMatchObject({ ok: true, data: { password: SCHOOL_IN_SCOPE.schoolIdCode } });
    expect(updateUserById).toHaveBeenCalledWith(
      "auth-head-1",
      expect.objectContaining({ password: SCHOOL_IN_SCOPE.schoolIdCode })
    );
    const entry = writeAudit.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      userId: DA_ID,
      schoolId: SCHOOL_IN_SCOPE.id,
      action: "SCHOOL_HEAD_PASSWORD_RESET_DEFAULT",
      metadata: expect.objectContaining({ via: "district_portal", actorRole: "DISTRICT_ADMIN" }),
    });
  });

  it("as the Super Admin, audits via schools_table with no actorRole", async () => {
    scope = { kind: "division" };
    actor = { id: ADMIN_ID, role: "SUPER_ADMIN", schoolId: null };

    await regenerateSchoolHeadCredential(regenForm(SCHOOL_IN_SCOPE.id));

    const entry = writeAudit.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(entry.metadata).toMatchObject({ via: "schools_table" });
    expect(entry.metadata).not.toHaveProperty("actorRole");
  });
});

describe("updateSchoolAsAdmin — scope", () => {
  it("as a district admin, refuses an out-of-scope school: NOT_FOUND, no write, no audit", async () => {
    const res = await updateSchoolAsAdmin(editForm(SCHOOL_OUT_OF_SCOPE.id));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    noWritesHappened();
  });

  it("as a district admin, edits an in-scope school's name and address only", async () => {
    schoolFindFirst.mockImplementation(async (args: { where?: { id?: string } }) => {
      // `applySchoolInfoUpdate`'s own re-fetch (name-uniqueness + current district).
      if (args?.where?.id === SCHOOL_IN_SCOPE.id) return { district: SCHOOL_IN_SCOPE.district };
      return null;
    });

    const res = await updateSchoolAsAdmin(editForm(SCHOOL_IN_SCOPE.id));

    expect(res).toMatchObject({ ok: true });
    expect(schoolUpdate).toHaveBeenCalledWith({
      where: { id: SCHOOL_IN_SCOPE.id },
      data: { name: "Renamed School", address: "New address" },
    });
  });
});
