import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The key icon on /admin/schools (`regenerateSchoolHeadCredential`) puts the
 * School Head's password back to the School ID.
 *
 * It used to set a random one-time credential. On 2026-09-10 Salimama IS logged
 * over a hundred failed sign-ins after one regeneration, because the head kept
 * typing the School ID they had always been told to use. These tests hold the
 * replacement behaviour: the password the admin is shown is the School ID, the
 * console flag agrees, and the audit row is the one the `passwordIsSchoolId`
 * replay reads as "readable again".
 *
 * Only leaf infrastructure is mocked (Prisma, session, Supabase admin, audit, cache).
 */

const SCHOOL_ID = "3f1c2b8e-7d4a-4e6b-9c1f-2a5d8e7b6c40";
const SCHOOL_ID_CODE = "500648";

const updateUserById = vi.fn(async (_authId: string, _attrs: Record<string, unknown>) => ({
  error: null as null | { message: string },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById } } }),
}));

const prismaMock = {
  school: {
    findFirst: vi.fn(async () => ({ id: SCHOOL_ID, schoolIdCode: SCHOOL_ID_CODE })),
  },
  user: {
    findFirst: vi.fn(async (_args: unknown) => ({ id: "head-1", authId: "auth-head-1" })),
    update: vi.fn(async (_args: unknown) => ({})),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "admin-1", role: "SUPER_ADMIN" })),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));

const writeAudit = vi.fn(async (_entry: Record<string, unknown>) => {});
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit: (e: Record<string, unknown>) => writeAudit(e) };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolsList: vi.fn(),
}));

const { regenerateSchoolHeadCredential } = await import("@/lib/actions/school");

function form() {
  const fd = new FormData();
  fd.set("schoolId", SCHOOL_ID);
  return fd;
}

describe("regenerateSchoolHeadCredential — back to the School ID", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the Supabase password to the School ID and returns it", async () => {
    const res = await regenerateSchoolHeadCredential(form());

    expect(res).toEqual({ ok: true, data: { password: SCHOOL_ID_CODE } });
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(updateUserById.mock.calls[0][0]).toBe("auth-head-1");
    expect(updateUserById.mock.calls[0][1]).toMatchObject({ password: SCHOOL_ID_CODE });
  });

  it("records that the live password is the School ID, with no forced change", async () => {
    await regenerateSchoolHeadCredential(form());

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "head-1" },
      data: {
        mustChangePassword: false,
        isActive: true,
        passwordIsSchoolId: true,
        // Any password the head had chosen no longer opens the account, so the
        // sealed copy the accounts console reveals is deleted with it —
        // otherwise the console would show a credential that fails at login.
        passwordVaultCipher: null,
        passwordVaultSetAt: null,
      },
    });
  });

  it("targets the same head row the sign-in uses (oldest first)", async () => {
    await regenerateSchoolHeadCredential(form());

    expect(prismaMock.user.findFirst.mock.calls[0][0]).toMatchObject({
      orderBy: { createdAt: "asc" },
    });
  });

  it("audits a reset-to-default, never a regeneration, and never the password", async () => {
    await regenerateSchoolHeadCredential(form());

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0];
    expect(entry.action).toBe("SCHOOL_HEAD_PASSWORD_RESET_DEFAULT");
    expect(entry.resourceId).toBe("head-1");
    expect(JSON.stringify(entry.metadata)).not.toContain(SCHOOL_ID_CODE);
  });

  it("gives an extension school the same default password as its mother school", async () => {
    // Naidas T. Opong ES (Banlas Extension) is stored as 130554-2 and signs in
    // with the bare 130554, same as Naidas T. Opong ES itself.
    prismaMock.school.findFirst.mockResolvedValueOnce({ id: SCHOOL_ID, schoolIdCode: "130554-2" });

    const res = await regenerateSchoolHeadCredential(form());

    expect(res).toEqual({ ok: true, data: { password: "130554" } });
    expect(updateUserById.mock.calls[0][1]).toMatchObject({ password: "130554" });
  });

  it("changes nothing locally when Supabase refuses the update", async () => {
    updateUserById.mockResolvedValueOnce({ error: { message: "boom" } });

    const res = await regenerateSchoolHeadCredential(form());

    expect(res).toEqual({ ok: false, error: "Failed to reset password" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
