import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `revealSchoolHeadPassword` — the one place in LITRACK where an admin reads a
 * credential another person chose.
 *
 * What is worth holding here is not the happy path but the guard rails around
 * it: Super Admin only, rate limited, one audit row per reveal with no password
 * in it, and a flat refusal when the sealed copy cannot be opened — because the
 * alternative to refusing is telling an admin a password that no longer works.
 */

const SCHOOL_ID = "3f1c2b8e-7d4a-4e6b-9c1f-2a5d8e7b6c40";
const SCHOOL_ID_CODE = "208027";
const VAULT_KEY = Buffer.alloc(32, 3).toString("base64");

process.env.PASSWORD_VAULT_KEY = VAULT_KEY;

const prismaMock = {
  school: {
    findFirst: vi.fn(async () => ({ id: SCHOOL_ID, schoolIdCode: SCHOOL_ID_CODE })),
  },
  user: {
    findFirst: vi.fn(async (_args: unknown) => headRow),
    update: vi.fn(async (_args: unknown) => ({})),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const requireUser = vi.fn(async () => ({ id: "admin-1", role: "SUPER_ADMIN" }));
vi.mock("@/lib/auth/session", () => ({ requireUser: (...a: unknown[]) => requireUser(...(a as [])) }));

const checkRateLimit = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => checkRateLimit() }));

const writeAudit = vi.fn(async (_entry: Record<string, unknown>) => {});
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    AUDIT_ACTIONS: actual.AUDIT_ACTIONS,
    writeAudit: (e: Record<string, unknown>) => writeAudit(e),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: {} } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/auth/impersonation", () => ({
  clearImpersonationCookie: vi.fn(),
  readImpersonationTicket: vi.fn(),
  setImpersonationCookie: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateSchoolsList: vi.fn() }));

const { sealPassword } = await import("@/lib/auth/password-vault");
const { revealSchoolHeadPassword } = await import("@/lib/actions/school-accounts");
const { AUDIT_ACTIONS } = await import("@/lib/audit");

const SEALED_AT = new Date("2026-09-11T04:00:00.000Z");

type HeadRow = {
  id: string;
  passwordIsSchoolId: boolean;
  passwordVaultCipher: string | null;
  passwordVaultSetAt: Date | null;
} | null;

let headRow: HeadRow = null;

function form(schoolId: string = SCHOOL_ID) {
  const fd = new FormData();
  fd.set("schoolId", schoolId);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN" });
  checkRateLimit.mockResolvedValue({ ok: true });
  prismaMock.school.findFirst.mockResolvedValue({
    id: SCHOOL_ID,
    schoolIdCode: SCHOOL_ID_CODE,
  });
  headRow = {
    id: "head-1",
    passwordIsSchoolId: false,
    passwordVaultCipher: sealPassword("Gerlita!2026"),
    passwordVaultSetAt: SEALED_AT,
  };
  prismaMock.user.findFirst.mockImplementation(async () => headRow);
});

describe("revealSchoolHeadPassword", () => {
  it("returns the password the School Head chose", async () => {
    const res = await revealSchoolHeadPassword(form());
    expect(res).toEqual({
      ok: true,
      data: {
        password: "Gerlita!2026",
        setAt: SEALED_AT.toISOString(),
        isSchoolId: false,
      },
    });
  });

  it("writes one audit row per reveal, without the password in it", async () => {
    await revealSchoolHeadPassword(form());
    await revealSchoolHeadPassword(form());

    expect(writeAudit).toHaveBeenCalledTimes(2);
    const entry = writeAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: "admin-1",
      schoolId: SCHOOL_ID,
      action: AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_VIEWED,
      resource: "User",
      resourceId: "head-1",
    });
    expect(JSON.stringify(entry)).not.toContain("Gerlita");
  });

  it("is Super Admin only", async () => {
    // `requireUser("SUPER_ADMIN")` is the gate; a rejection must surface rather
    // than be swallowed into a generic failure the caller could retry past.
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(revealSchoolHeadPassword(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses once the reveal rate limit is spent, before reading anything", async () => {
    checkRateLimit.mockResolvedValueOnce({ ok: false });
    const res = await revealSchoolHeadPassword(form());
    expect(res.ok).toBe(false);
    expect(prismaMock.school.findFirst).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("returns the School ID, unaudited, when that is the live password", async () => {
    headRow = {
      id: "head-1",
      passwordIsSchoolId: true,
      passwordVaultCipher: null,
      passwordVaultSetAt: null,
    };
    const res = await revealSchoolHeadPassword(form());
    expect(res).toEqual({
      ok: true,
      data: { password: SCHOOL_ID_CODE, setAt: null, isSchoolId: true },
    });
    // Nothing personal was disclosed — the School ID is printed in the row next
    // to it and in the schools table.
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses when no sealed copy exists", async () => {
    headRow = {
      id: "head-1",
      passwordIsSchoolId: false,
      passwordVaultCipher: null,
      passwordVaultSetAt: null,
    };
    const res = await revealSchoolHeadPassword(form());
    expect(res).toEqual({
      ok: false,
      error: "This password is not on record. Use Reset to put the School ID back.",
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses, rather than guessing, when the sealed copy will not open", async () => {
    headRow = {
      id: "head-1",
      passwordIsSchoolId: false,
      // The shape a key rotation leaves behind.
      passwordVaultCipher: "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAA",
      passwordVaultSetAt: SEALED_AT,
    };
    const res = await revealSchoolHeadPassword(form());
    expect(res.ok).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid school without touching the database", async () => {
    const res = await revealSchoolHeadPassword(form("not-a-uuid"));
    expect(res).toEqual({ ok: false, error: "Invalid school" });
    expect(prismaMock.school.findFirst).not.toHaveBeenCalled();
  });

  it("reports a school with no School Head row instead of throwing", async () => {
    headRow = null;
    const res = await revealSchoolHeadPassword(form());
    expect(res).toEqual({ ok: false, error: "School Head account not found" });
  });
});
