import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may move a school between districts — the write side of I11
 * (docs/specs/district-admin.md 3.5, 3.7, T6).
 *
 * `School.district` decides which district admin supervises a school, so
 * three different actors reach the same underlying write
 * (`applySchoolInfoUpdate` in `src/lib/actions/school-management.ts`) with
 * three different amounts of trust:
 *
 *  - the School Head (`updateSchoolInfo`) may no longer set it at all — not
 *    even by including it in the posted `FormData`;
 *  - a district admin (`updateSchoolAsAdmin`, `scope.kind === "districts"`)
 *    may edit `name` and `address` only, for the same reason;
 *  - the Super Admin (`updateSchoolAsAdmin`, `scope.kind === "division"`) is
 *    the only actor who may move a school's district, and every such write is
 *    audited with the old and new value.
 */

const HEAD_ID = "head-1";
const ADMIN_ID = "admin-1";
const DA_ID = "da-1";
const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";

let currentDistrict = "Alabel 1";

const schoolFindFirst = vi.fn(async (args: { where?: { id?: string; name?: string } }) => {
  // Called twice by `applySchoolInfoUpdate`: once for the current row (by id,
  // for `districtFrom`), once for the name-uniqueness probe (never taken here).
  if (args?.where?.id === SCHOOL_ID) return { district: currentDistrict };
  return null;
});
const schoolUpdate = vi.fn(async (_args: unknown) => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findFirst: (...a: unknown[]) => schoolFindFirst(...(a as [never])),
      update: (...a: unknown[]) => schoolUpdate(...(a as [never])),
    },
  },
}));

const requireSchoolUser = vi.fn(async () => ({ id: HEAD_ID, schoolId: SCHOOL_ID }));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...(a as [])),
  requireUser: vi.fn(),
}));

type Scope = { kind: "division" } | { kind: "districts"; districts: readonly string[] };
let scope: Scope = { kind: "division" };
let actor: { id: string; role: "SUPER_ADMIN" | "DISTRICT_ADMIN" } = { id: ADMIN_ID, role: "SUPER_ADMIN" };

const requireAdminScope = vi.fn(async () => ({ user: actor, scope }));
const loadSchoolInScope = vi.fn(async (_s: Scope, schoolId: string, _select?: unknown) => ({
  id: schoolId,
}));
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: (...a: unknown[]) => requireAdminScope(...(a as [])),
  loadSchoolInScope: (...a: unknown[]) => loadSchoolInScope(...(a as [Scope, string, unknown])),
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
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolsList: vi.fn(),
  revalidateDivisionSummary: vi.fn(),
}));
const reportError = vi.fn(() => "E-TESTREF");
vi.mock("@/lib/errors/report", () => ({ reportError: (...a: unknown[]) => reportError(...(a as [])) }));

const { updateSchoolInfo, updateSchoolAsAdmin } = await import("@/lib/actions/school-management");

function shForm(): FormData {
  const fd = new FormData();
  fd.set("name", "Sample Central ES");
  fd.set("address", "Purok 1");
  // A stale cached School Head form still posting district/division/region —
  // exactly the "loaded before the deploy" scenario spec 10.3 names.
  fd.set("district", "Somewhere Else");
  fd.set("division", "Some Division");
  fd.set("region", "Some Region");
  return fd;
}

function adminForm(district?: string): FormData {
  const fd = new FormData();
  fd.set("schoolId", SCHOOL_ID);
  fd.set("name", "Sample Central ES");
  fd.set("address", "Purok 1");
  if (district !== undefined) fd.set("district", district);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDistrict = "Alabel 1";
  requireSchoolUser.mockResolvedValue({ id: HEAD_ID, schoolId: SCHOOL_ID });
  scope = { kind: "division" };
  actor = { id: ADMIN_ID, role: "SUPER_ADMIN" };
  requireAdminScope.mockImplementation(async () => ({ user: actor, scope }));
});

describe("updateSchoolInfo (School Head) — T6", () => {
  it("never writes district, division or region, even when a stale form posts them", async () => {
    const res = await updateSchoolInfo(shForm());

    expect(res).toMatchObject({ ok: true });
    expect(schoolUpdate).toHaveBeenCalledTimes(1);
    const data = (schoolUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ name: "Sample Central ES", address: "Purok 1" });
    expect(data).not.toHaveProperty("district");
    expect(data).not.toHaveProperty("division");
    expect(data).not.toHaveProperty("region");
  });

  it("audits with no district-move metadata for a School Head's own edit", async () => {
    await updateSchoolInfo(shForm());
    const entry = writeAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
    // districtFrom/districtTo are still present (spec: the audit row always
    // carries them) but must be equal — nothing moved.
    expect(entry.metadata.districtFrom).toBe(entry.metadata.districtTo);
    expect(entry.metadata).not.toHaveProperty("actorRole");
  });
});

describe("updateSchoolAsAdmin as a district admin — T6", () => {
  beforeEach(() => {
    scope = { kind: "districts", districts: ["Alabel 1"] };
    actor = { id: DA_ID, role: "DISTRICT_ADMIN" };
  });

  it("does not write district even when the posted form carries one", async () => {
    const res = await updateSchoolAsAdmin(adminForm("Somewhere Else"));

    expect(res).toMatchObject({ ok: true });
    const data = (schoolUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ name: "Sample Central ES", address: "Purok 1" });
    expect(data).not.toHaveProperty("district");
  });

  it("audit row shows no district move, and carries actorRole", async () => {
    await updateSchoolAsAdmin(adminForm("Somewhere Else"));
    const entry = writeAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(entry.metadata.districtFrom).toBe("Alabel 1");
    expect(entry.metadata.districtTo).toBe("Alabel 1");
    expect(entry.metadata.actorRole).toBe("DISTRICT_ADMIN");
  });
});

describe("updateSchoolAsAdmin as the Super Admin — T6, I11", () => {
  it("writes the new district and audits the old and new value", async () => {
    const res = await updateSchoolAsAdmin(adminForm("Glan 1"));

    expect(res).toMatchObject({ ok: true });
    const data = (schoolUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      name: "Sample Central ES",
      address: "Purok 1",
      district: "Glan 1",
    });

    const entry = writeAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(entry.metadata).toMatchObject({ districtFrom: "Alabel 1", districtTo: "Glan 1" });
    expect(entry.metadata).not.toHaveProperty("actorRole");
  });

  it("blanking the district writes null and audits it as such", async () => {
    await updateSchoolAsAdmin(adminForm(""));

    const data = (schoolUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.district).toBeNull();
    const entry = writeAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(entry.metadata.districtTo).toBeNull();
  });
});
