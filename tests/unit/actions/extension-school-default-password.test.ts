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
 * Only leaf infrastructure is mocked (Prisma, session, identity writes, audit, cache).
 * The passwords are real bcrypt hashes, checked with `verifyPassword`, so what
 * is pinned is the password the identity would actually accept.
 */

const SCHOOL_ID = "3f1c2b8e-7d4a-4e6b-9c1f-2a5d8e7b6c40";
const HEAD_ID = "9c4d1f77-2b36-4a80-9d5e-61c0a7f3e8b2";

const setPassword = vi.fn(async (..._args: unknown[]) => {});
const setRole = vi.fn(async (..._args: unknown[]) => {});
const createIdentity = vi.fn(
  async (..._args: unknown[]): Promise<{ authId: string }> => ({ authId: "auth-new" })
);
vi.mock("@/lib/auth/identity", () => ({ setPassword, setRole, createIdentity }));
const revokeAllSessions = vi.fn(async (..._args: unknown[]) => 0);
vi.mock("@/lib/auth/auth-session", () => ({
  revokeAllSessions: (...a: unknown[]) => revokeAllSessions(...a),
  revokeOtherSessions: vi.fn(async () => 0),
  getAuthSession: vi.fn(async () => null),
  endCurrentSession: vi.fn(async () => true),
}));
vi.mock("@/lib/auth/impersonation-session", () => ({
  expireImpersonationCookies: vi.fn(),
  readImpersonation: vi.fn(async () => null),
  startImpersonationSession: vi.fn(),
  stopImpersonationSession: vi.fn(),
}));

/** The plain-text password a recorded `{ hash }` input would accept, or null. */
async function acceptedPassword(hash: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await verifyPassword({ hash, password: candidate })) return candidate;
  }
  return null;
}

const tx = {
  school: { create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: SCHOOL_ID, ...args.data })) },
  user: {
    create: vi.fn(async (_args: unknown) => ({})),
    update: vi.fn(async (_args: unknown) => ({})),
  },
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
const writeAudit = vi.fn(async (_entry: unknown) => {});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, prismaFresh: prismaMock }));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "admin-1", role: "SUPER_ADMIN" })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit: (e: unknown) => writeAudit(e) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: () => undefined }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF-SCHOOL") }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolsList: vi.fn(),
  revalidateAdminAccountPages: vi.fn(),
}));
vi.mock("@/lib/settings/system-settings", () => ({
  demoSchoolFilter: vi.fn(async () => ({})),
  isDemoEnabled: vi.fn(async () => false),
}));

const { verifyPassword } = await import("@/lib/auth/password-hash");
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
    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(setPassword.mock.calls[0][0]).toBe("auth-head-1");
    const { hash } = setPassword.mock.calls[0][1] as { hash: string };
    // The identity accepts the bare ID, and not the stored extension code.
    expect(await acceptedPassword(hash, ["130554-2", "130554"])).toBe("130554");
  });

  it("revokes every session of the head, after the credential transaction commits", async () => {
    const fd = new FormData();
    fd.set("userId", HEAD_ID);

    const res = await resetSchoolHeadPasswordToDefault(fd);

    expect(res.ok).toBe(true);
    expect(revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(revokeAllSessions).toHaveBeenCalledWith("auth-head-1");
    expect(revokeAllSessions.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.user.update.mock.invocationCallOrder[0]
    );
    expect(revokeAllSessions.mock.invocationCallOrder[0]).toBeLessThan(
      writeAudit.mock.invocationCallOrder[0]
    );
  });

  it("does not revoke when the credential write fails", async () => {
    setPassword.mockRejectedValueOnce(new Error("db down"));
    const fd = new FormData();
    fd.set("userId", HEAD_ID);

    const res = await resetSchoolHeadPasswordToDefault(fd);

    expect(res.ok).toBe(false);
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });
});

describe("database console bulk reset (resetAllSchoolHeadPasswords)", () => {
  const twoHeads = [
    { id: "h1", authId: "a1", schoolId: "s1", fullName: "x", school: { id: "s1", name: "One ES", schoolIdCode: "111111" } },
    { id: "h2", authId: "a2", schoolId: "s2", fullName: "y", school: { id: "s2", name: "Two ES", schoolIdCode: "222222" } },
  ];

  it("revokes each head's sessions on its own authId, only after that head's transaction commits", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce(twoHeads);

    await resetAllSchoolHeadPasswords();

    expect(revokeAllSessions.mock.calls.map((c) => c[0]).sort()).toEqual(["a1", "a2"]);
    for (const authId of ["a1", "a2"]) {
      const setAt = setPassword.mock.calls.findIndex((c) => c[0] === authId);
      const revokeAt = revokeAllSessions.mock.calls.findIndex((c) => c[0] === authId);
      expect(revokeAllSessions.mock.invocationCallOrder[revokeAt]).toBeGreaterThan(
        setPassword.mock.invocationCallOrder[setAt]
      );
    }
  });

  it("does not revoke a head whose transaction failed, and still reports it", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce(twoHeads);
    setPassword.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "a1") throw new Error("db down");
    });

    try {
      const res = await resetAllSchoolHeadPasswords();

      expect(res.processed).toBe(1);
      expect(res.failed).toHaveLength(1);
      expect(res.failed[0].id).toBe("h1");
      expect(revokeAllSessions.mock.calls.map((c) => c[0])).toEqual(["a2"]);
    } finally {
      setPassword.mockImplementation(async () => {});
    }
  });

  it("puts each head on its own school's bare School ID", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "h1", authId: "a1", schoolId: "s1", fullName: "x", school: { id: "s1", name: "Naidas T. Opong ES", schoolIdCode: "130554" } },
      { id: "h2", authId: "a2", schoolId: "s2", fullName: "y", school: { id: "s2", name: "Naidas T. Opong ES (Banlas Extension)", schoolIdCode: "130554-2" } },
    ]);

    const res = await resetAllSchoolHeadPasswords();

    expect(res).toEqual({ processed: 2, failed: [] });
    const byAuth: Record<string, string | null> = {};
    for (const call of setPassword.mock.calls) {
      const { hash } = call[1] as { hash: string };
      byAuth[call[0] as string] = await acceptedPassword(hash, ["130554-2", "130554"]);
    }
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
    const input = createIdentity.mock.calls[0][0] as {
      email: string;
      password: { hash: string };
      role: string;
    };
    expect(input.role).toBe("SCHOOL_HEAD");
    expect(await acceptedPassword(input.password.hash, ["130554-3", "130554"])).toBe("130554");
    // The email stays on the stored code: that is what keeps it unique.
    expect(String(input.email)).toMatch(/^sh@130554-3\./);
    // The identity is created inside the school's own transaction.
    expect(createIdentity.mock.calls[0][1]).toBe(tx);
    expect(tx.school.create.mock.calls[0][0].data).toMatchObject({ schoolIdCode: "130554-3" });
  });

  it("does not return the provider's error text when the login cannot be created", async () => {
    prismaMock.school.findFirst.mockResolvedValue(null);
    createIdentity.mockRejectedValueOnce(new Error("Provider rejected key sb_secret_9f3a"));

    const res = await createSchool(createForm("500648"));

    expect(res).toMatchObject({ ok: false });
    expect(typeof (res as { code?: string }).code).toBe("string");
    expect(JSON.stringify(res)).not.toContain("sb_secret_9f3a");
    // The identity failure aborts the transaction (which rolls the school row
    // back): no head row and no audit row follow it.
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("leaves an ordinary school's password as its School ID", async () => {
    prismaMock.school.findFirst.mockResolvedValue(null);

    const res = await createSchool(createForm("500648"));

    expect(res).toMatchObject({ ok: true, data: { initialPassword: "500648" } });
    const input = createIdentity.mock.calls[0][0] as { password: { hash: string } };
    expect(await verifyPassword({ hash: input.password.hash, password: "500648" })).toBe(true);
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
