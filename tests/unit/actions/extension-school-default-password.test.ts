import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A school and its extensions share one DepEd School ID, and every one of them
 * starts on that bare ID as its School Head's default password.
 *
 * The stored `schoolIdCode` cannot be shared — it builds the head's synthetic
 * login email — so an extension is stored as `130554-2`, `130554-3`, … (the
 * roster import's rule). Every path that SETS or SHOWS the default password must
 * therefore use the bare ID, not the stored code. Before this, the import set
 * the bare ID while the console showed, and Reset set, the suffixed one: an
 * extension head could be handed a password that did not work.
 *
 * Only leaf infrastructure is mocked (Prisma, session, Supabase, audit, cache).
 */

const SCHOOL_ID = "3f1c2b8e-7d4a-4e6b-9c1f-2a5d8e7b6c40";
const HEAD_ID = "9c4d1f77-2b36-4a80-9d5e-61c0a7f3e8b2";

const updateUserById = vi.fn(async (_authId: string, _attrs: Record<string, unknown>) => ({
  error: null as null | { message: string },
}));
const createUser = vi.fn(async (_attrs: Record<string, unknown>) => ({
  data: { user: { id: "auth-new" } },
  error: null as null | { message: string },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById, createUser } } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const tx = {
  school: { create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: SCHOOL_ID, ...args.data })) },
  user: { create: vi.fn(async (_args: unknown) => ({})) },
};
const prismaMock = {
  school: {
    findFirst: vi.fn(async (_args?: unknown): Promise<unknown> => ({ id: SCHOOL_ID, schoolIdCode: "130554-2" })),
    findMany: vi.fn(async (_args?: unknown): Promise<unknown[]> => []),
    count: vi.fn(async () => 0),
  },
  user: {
    findFirst: vi.fn(async (_args?: unknown) => ({
      id: "head-1",
      role: "SCHOOL_HEAD",
      authId: "auth-head-1",
      email: "e",
      fullName: "f",
      school: { id: SCHOOL_ID, schoolIdCode: "130554-2" },
    })),
    findMany: vi.fn(async (_args?: unknown): Promise<unknown[]> => []),
    count: vi.fn(async (_args?: unknown) => 0),
    update: vi.fn(async (_args: unknown) => ({})),
  },
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "admin-1", role: "SUPER_ADMIN" })),
}));
vi.mock("@/lib/auth/impersonation", () => ({
  clearImpersonationCookie: vi.fn(),
  readImpersonationTicket: vi.fn(),
  setImpersonationCookie: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit: vi.fn(async () => {}) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolsList: vi.fn(),
}));
vi.mock("@/lib/settings/system-settings", () => ({
  demoSchoolFilter: vi.fn(async () => ({})),
  isDemoEnabled: vi.fn(async () => false),
}));

const { resetSchoolHeadPasswordToDefault } = await import("@/lib/actions/accounts");
const { createSchool } = await import("@/lib/actions/school");
const { resetAllSchoolHeadPasswords } = await import("@/lib/db/account-reset");
const { getAccountsPage, parseAccountsParams } = await import("@/lib/admin/accounts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("console Reset (resetSchoolHeadPasswordToDefault)", () => {
  it("sets and returns the bare School ID for an extension school", async () => {
    // Keyed on the account, not the school — the console lists every user.
    const fd = new FormData();
    fd.set("userId", HEAD_ID);

    const res = await resetSchoolHeadPasswordToDefault(fd);

    expect(res).toEqual({ ok: true, data: { password: "130554" } });
    expect(updateUserById.mock.calls[0][1]).toMatchObject({ password: "130554" });
  });
});

describe("database console bulk reset (resetAllSchoolHeadPasswords)", () => {
  it("puts each head on its own school's bare School ID", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "h1", authId: "a1", schoolId: "s1", fullName: "x", school: { id: "s1", name: "Naidas T. Opong ES", schoolIdCode: "130554" } },
      { id: "h2", authId: "a2", schoolId: "s2", fullName: "y", school: { id: "s2", name: "Naidas T. Opong ES (Banlas Extension)", schoolIdCode: "130554-2" } },
    ]);

    const res = await resetAllSchoolHeadPasswords();

    expect(res).toEqual({ processed: 2, failed: [] });
    const byAuth = Object.fromEntries(updateUserById.mock.calls.map(([id, attrs]) => [id, attrs.password]));
    expect(byAuth).toEqual({ a1: "130554", a2: "130554" });
  });
});

describe("createSchool", () => {
  function createForm(schoolIdCode: string) {
    const fd = new FormData();
    fd.set("name", "Naidas T. Opong ES (Litos Extension)");
    fd.set("schoolIdCode", schoolIdCode);
    return fd;
  }

  it("starts an extension school on the bare School ID, with a login email of its own", async () => {
    prismaMock.school.findFirst.mockResolvedValue(null); // neither name nor code taken

    const res = await createSchool(createForm("130554-3"));

    expect(res).toMatchObject({ ok: true, data: { initialPassword: "130554" } });
    expect(createUser.mock.calls[0][0]).toMatchObject({ password: "130554" });
    // The email stays on the stored code: that is what keeps it unique.
    expect(String(createUser.mock.calls[0][0].email)).toMatch(/^sh@130554-3\./);
    expect(tx.school.create.mock.calls[0][0].data).toMatchObject({ schoolIdCode: "130554-3" });
  });

  it("leaves an ordinary school's password as its School ID", async () => {
    prismaMock.school.findFirst.mockResolvedValue(null);

    const res = await createSchool(createForm("500648"));

    expect(res).toMatchObject({ ok: true, data: { initialPassword: "500648" } });
    expect(createUser.mock.calls[0][0]).toMatchObject({ password: "500648" });
  });
});

describe("console rows (getAccountsPage)", () => {
  it("shows an extension school's working default password, not its stored code", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      {
        id: "head-1",
        role: "SCHOOL_HEAD",
        fullName: "Head",
        firstName: "",
        lastName: "",
        email: "sh@130554-2.litrack.local",
        username: null,
        schoolId: SCHOOL_ID,
        isActive: true,
        mustChangePassword: false,
        approvalStatus: null,
        passwordIsSchoolId: true,
        passwordVaultCipher: null,
        school: {
          id: SCHOOL_ID,
          name: "Naidas T. Opong ES (Banlas Extension)",
          schoolIdCode: "130554-2",
        },
      },
    ]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const page = await getAccountsPage(parseAccountsParams({}));

    expect(page.rows[0].school?.schoolIdCode).toBe("130554-2");
    expect(page.rows[0].password).toEqual({ kind: "school_id", value: "130554" });
  });
});
