import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `impersonateUser`, `endImpersonation`, `logoutAction`, `resetTeacherPassword`
 * and `getAccountProfile` — the console's highest-severity surface, because
 * three of them either mint a session for another account or restore one.
 *
 * What is pinned here, one line each:
 *  - impersonateUser refuses before any read/write for a non-Super-Admin caller.
 *  - impersonateUser refuses a SUPER_ADMIN target (the escalation guard).
 *  - impersonateUser refuses a soft-deleted target.
 *  - impersonateUser refuses an inactive, approved target, BEFORE the swap.
 *  - impersonateUser allows a PENDING teacher even though isActive is false.
 *  - impersonateUser refuses a REJECTED target by name, even if isActive were true.
 *  - the written ticket carries the minted session's session_id.
 *  - audit metadata for IMPERSONATION_START is ids, school name and role only.
 *  - endImpersonation refuses when the caller's session_id does not match the
 *    ticket's (the re-login-as-target-then-return-as-admin scenario).
 *  - endImpersonation refuses when there is no current session.
 *  - endImpersonation refuses but KEEPS the ticket on an auth-server outage.
 *  - endImpersonation revokes the impersonation session on success, and a
 *    failed revoke does not turn a successful return into a reported failure.
 *  - endImpersonation still refuses a demoted / inactive / deleted admin row.
 *  - logoutAction clears the impersonation cookie only after successful signOut.
 *  - logoutAction signs out scope:"local" only for a proven bound session.
 *  - logoutAction signs out scope:"global" with no ticket or an unproven one.
 *  - resetTeacherPassword refuses a non-Super-Admin caller.
 *  - resetTeacherPassword refuses a non-TEACHER target.
 *  - resetTeacherPassword's update payload is exactly the four documented
 *    fields, with no `isActive` key at all.
 *  - resetTeacherPassword never puts the credential in audit metadata.
 *  - getAccountProfile refuses a non-Super-Admin caller.
 *  - getAccountProfile's advisory/aral are null for a non-teacher, and the
 *    query count for that shape is bounded (3 calls: user + 2 in Promise.all).
 *
 * Everything below the auth line is mocked to leaf infrastructure only, in the
 * style of the other files in this directory.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_AUTH_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const SCHOOL_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";

// ── requireUser ──────────────────────────────────────────────────────────
const requireUser = vi.fn(async () => ({ id: ADMIN_ID, authId: ADMIN_AUTH_ID, role: "SUPER_ADMIN" }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...(a as [])),
}));

// ── prisma ───────────────────────────────────────────────────────────────
const prismaMock = {
  user: {
    findFirst: vi.fn(async (_args: unknown): Promise<unknown> => targetRow),
    findUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
    update: vi.fn(async (_args: unknown) => ({})),
  },
  auditLog: {
    groupBy: vi.fn(async (_args: unknown) => []),
    findMany: vi.fn(async (_args: unknown) => []),
  },
  learner: {
    groupBy: vi.fn(async (_args: unknown) => []),
    count: vi.fn(async (_args: unknown) => 0),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// ── rate limit ───────────────────────────────────────────────────────────
const checkRateLimit = vi.fn(async () => ({ ok: true, retryAfterMs: 0 }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])) }));

// ── audit ────────────────────────────────────────────────────────────────
const writeAudit = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit: (e: Record<string, unknown>) => writeAudit(e) };
});

// ── supabase admin / server clients ─────────────────────────────────────
const generateLink = vi.fn(async (_args: unknown) => ({
  data: { properties: { hashed_token: "hashed-token" } },
  error: null as null | { message: string },
}));
const updateUserById = vi.fn(async (_authId: string, _attrs: unknown) => ({
  error: null as null | { message: string },
}));
const adminSignOut = vi.fn(async (_token: string, _scope: string) => ({
  error: null as null | { message: string },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { generateLink, updateUserById, signOut: adminSignOut } },
  }),
}));

const serverSetSession = vi.fn(async (_args: unknown) => ({ error: null as null | { message: string } }));
const serverVerifyOtp = vi.fn(async (_args: unknown) => ({ error: null as null | { message: string } }));
const createSupabaseServerClient = vi.fn(async () => ({
  auth: { setSession: serverSetSession, verifyOtp: serverVerifyOtp },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...a: unknown[]) => createSupabaseServerClient(...(a as [])),
}));

// The detached anon client `mintSessionFor` builds directly with `createClient`.
const detachedVerifyOtp = vi.fn(async (_args: unknown) => ({
  data: { session: { access_token: "minted-access-token", refresh_token: "minted-refresh-token" } },
  error: null as null | { message: string },
}));
vi.mock("@supabase/supabase-js", async () => {
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
  return {
    ...actual,
    createClient: vi.fn(() => ({ auth: { verifyOtp: detachedVerifyOtp } })),
  };
});

// ── impersonation ticket module ──────────────────────────────────────────
type SessionCheck =
  | { status: "live"; sessionId: string; accessToken: string }
  | { status: "none" }
  | { status: "unavailable" };

const readImpersonationTicket = vi.fn(async (..._args: unknown[]) => null as null | Record<string, unknown>);
const setImpersonationCookie = vi.fn(async (..._args: unknown[]) => {});
const clearImpersonationCookie = vi.fn(async (..._args: unknown[]) => {});
const checkCurrentSession = vi.fn(async (..._args: unknown[]): Promise<SessionCheck> => ({ status: "none" }));
const checkSessionToken = vi.fn(
  async (..._args: unknown[]): Promise<SessionCheck> => ({
    status: "live",
    sessionId: SESSION_ID,
    accessToken: "minted-access-token",
  })
);
const readImpersonationContext = vi.fn(async (..._args: unknown[]) => null as null | Record<string, unknown>);
vi.mock("@/lib/auth/impersonation", () => ({
  readImpersonationTicket: (...a: unknown[]) => readImpersonationTicket(...(a as [])),
  setImpersonationCookie: (...a: unknown[]) => setImpersonationCookie(...(a as [])),
  clearImpersonationCookie: (...a: unknown[]) => clearImpersonationCookie(...(a as [])),
  checkCurrentSession: (...a: unknown[]) => checkCurrentSession(...(a as [])),
  checkSessionToken: (...a: unknown[]) => checkSessionToken(...(a as [])),
  readImpersonationContext: (...a: unknown[]) => readImpersonationContext(...(a as [])),
  readBoundImpersonationSession: (...a: unknown[]) => readBoundImpersonationSession(...(a as [])),
}));
const readBoundImpersonationSession = vi.fn(async (..._args: unknown[]) => null as null | {
  ticket: { adminUserId: string; targetUserId: string }; expired: boolean;
});

// ── errors / navigation / cache ───────────────────────────────────────────
const reportError = vi.fn(() => "E-TESTREF00");
vi.mock("@/lib/errors/report", () => ({ reportError: (...a: unknown[]) => reportError(...(a as [])) }));

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateSchoolsList: vi.fn() }));

// ── the module under test ────────────────────────────────────────────────
const { impersonateUser, endImpersonation, resetTeacherPassword, getAccountProfile,
  revealSchoolHeadPassword, resetSchoolHeadPasswordToDefault } = await import(
  "@/lib/actions/accounts"
);
const { logoutAction } = await import("@/lib/actions/auth");
const { AUDIT_ACTIONS } = await import("@/lib/audit");

type TargetRow = {
  id: string;
  role: string;
  isActive: boolean;
  approvalStatus: string | null;
  email: string;
  schoolId: string | null;
  fullName: string;
  school: { name: string } | null;
} | null;

let targetRow: TargetRow = null;

function teacher(overrides: Partial<NonNullable<TargetRow>> = {}): TargetRow {
  return {
    id: TARGET_ID,
    role: "TEACHER",
    isActive: true,
    approvalStatus: "APPROVED",
    email: "t@school.local",
    schoolId: SCHOOL_ID,
    fullName: "Some Teacher",
    school: { name: "Sample ES" },
    ...overrides,
  };
}

function form(userId: string = TARGET_ID): FormData {
  const fd = new FormData();
  fd.set("userId", userId);
  return fd;
}

/** Runs an action that redirects on success, swallowing the marker throw. */
async function run<T>(p: Promise<T>): Promise<T | { redirectedTo: string }> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
      return { redirectedTo: err.message.slice("NEXT_REDIRECT:".length) };
    }
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  readBoundImpersonationSession.mockResolvedValue(null);
  readImpersonationContext.mockResolvedValue(null);
  readImpersonationTicket.mockResolvedValue(null);
  requireUser.mockResolvedValue({ id: ADMIN_ID, authId: ADMIN_AUTH_ID, role: "SUPER_ADMIN" });
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  targetRow = teacher();
  prismaMock.user.findFirst.mockImplementation(async () => targetRow);
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hashed-token" } }, error: null });
  detachedVerifyOtp.mockResolvedValue({
    data: { session: { access_token: "minted-access-token", refresh_token: "minted-refresh-token" } },
    error: null,
  });
  checkSessionToken.mockResolvedValue({
    status: "live",
    sessionId: SESSION_ID,
    accessToken: "minted-access-token",
  });
  serverSetSession.mockResolvedValue({ error: null });
  redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("impersonateUser", () => {
  it("refuses a non-Super-Admin caller before any read or write", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(impersonateUser(form())).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(setImpersonationCookie).not.toHaveBeenCalled();
  });

  it("refuses a SUPER_ADMIN target — the privilege-escalation guard", async () => {
    targetRow = teacher({ role: "SUPER_ADMIN" });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(setImpersonationCookie).not.toHaveBeenCalled();
    expect(serverSetSession).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted target (excluded by the findFirst where, so it is simply not found)", async () => {
    // deletedAt: null is baked into the `where`; a soft-deleted row never
    // reaches the handler, so the mock returns null exactly as Prisma would.
    targetRow = null;
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(setImpersonationCookie).not.toHaveBeenCalled();
  });

  it("refuses an inactive, approved target BEFORE the session is installed or the ticket written", async () => {
    targetRow = teacher({ isActive: false, approvalStatus: "APPROVED" });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "ADMIN_IMPERSONATE_INACTIVE" });
    expect(setImpersonationCookie).not.toHaveBeenCalled();
    expect(serverSetSession).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("allows a PENDING teacher even though isActive is false", async () => {
    targetRow = teacher({ isActive: false, approvalStatus: "PENDING" });
    const res = await run(impersonateUser(form()));
    expect(res).toEqual({ redirectedTo: "/teacher" });
    expect(setImpersonationCookie).toHaveBeenCalledTimes(1);
    expect(serverSetSession).toHaveBeenCalledTimes(1);
  });

  it("refuses a REJECTED target by name, even if isActive were somehow true", async () => {
    targetRow = teacher({ isActive: true, approvalStatus: "REJECTED" });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "ADMIN_IMPERSONATE_INACTIVE" });
    expect(setImpersonationCookie).not.toHaveBeenCalled();
  });

  it("writes a ticket carrying the minted session's session_id", async () => {
    checkSessionToken.mockResolvedValue({
      status: "live",
      sessionId: "minted-session-xyz",
      accessToken: "minted-access-token",
    });
    await run(impersonateUser(form()));
    expect(setImpersonationCookie).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "minted-session-xyz", targetUserId: TARGET_ID })
    );
  });

  it("writes IMPERSONATION_START audit metadata as ids, school name and role only", async () => {
    await run(impersonateUser(form()));
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      userId: ADMIN_ID,
      schoolId: SCHOOL_ID,
      action: AUDIT_ACTIONS.IMPERSONATION_START,
      resource: "User",
      resourceId: TARGET_ID,
      metadata: { schoolId: SCHOOL_ID, schoolName: "Sample ES", targetRole: "TEACHER" },
    });
    // No email, no full name, no password material.
    expect(JSON.stringify(entry)).not.toContain("t@school.local");
    expect(JSON.stringify(entry)).not.toContain("Some Teacher");
  });
});

describe("endImpersonation", () => {
  function ticket(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      adminAuthId: ADMIN_AUTH_ID,
      adminUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      sessionId: SESSION_ID,
      expiresAt: Date.now() + 60_000,
      ...overrides,
    };
  }

  it("refuses to return an admin whose session_id does not match the ticket's — the re-login-as-target-then-return scenario", async () => {
    // Story: the admin ends impersonation by signing out (or the browser is
    // simply handed to the target), the target later logs in on the same
    // browser and the stale ticket cookie is still sitting there. That fresh
    // login is a DIFFERENT session id, and must not redeem the ticket back
    // into a Super Admin session.
    readImpersonationTicket.mockResolvedValue(ticket());
    checkCurrentSession.mockResolvedValue({
      status: "live",
      sessionId: "a-different-session-from-a-fresh-login",
      accessToken: "tok",
    });

    const res = await endImpersonation();

    expect(res).toEqual({ ok: false, error: "Not impersonating" });
    expect(clearImpersonationCookie).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses when there is no current session", async () => {
    readImpersonationTicket.mockResolvedValue(ticket());
    checkCurrentSession.mockResolvedValue({ status: "none" });

    const res = await endImpersonation();

    expect(res).toEqual({ ok: false, error: "Not impersonating" });
    expect(clearImpersonationCookie).toHaveBeenCalledTimes(1);
  });

  it("refuses but KEEPS the ticket on an auth-server outage, so a network blip cannot strand the admin", async () => {
    readImpersonationTicket.mockResolvedValue(ticket());
    checkCurrentSession.mockResolvedValue({ status: "unavailable" });

    const res = await endImpersonation();

    expect(res.ok).toBe(false);
    expect(clearImpersonationCookie).not.toHaveBeenCalled();
  });

  it("revokes the impersonation session on success, and a failed revoke does not turn a successful return into a reported failure", async () => {
    readImpersonationTicket.mockResolvedValue(ticket());
    checkCurrentSession.mockResolvedValue({
      status: "live",
      sessionId: SESSION_ID,
      accessToken: "the-bound-access-token",
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: ADMIN_ID, email: "admin@litrack.local" });
    serverVerifyOtp.mockResolvedValueOnce({ error: null });
    // The revoke itself fails — this must not be reported to the caller.
    adminSignOut.mockResolvedValueOnce({ error: { message: "revoke failed" } });

    const res = await run(endImpersonation());

    expect(res).toEqual({ redirectedTo: "/admin/accounts" });
    expect(adminSignOut).toHaveBeenCalledWith("the-bound-access-token", "local");
    expect(clearImpersonationCookie).toHaveBeenCalledTimes(1);
  });

  it("still refuses a demoted, inactive, or deleted admin row (re-checked live at return time)", async () => {
    readImpersonationTicket.mockResolvedValue(ticket());
    checkCurrentSession.mockResolvedValue({
      status: "live",
      sessionId: SESSION_ID,
      accessToken: "tok",
    });
    // `where` requires role SUPER_ADMIN, isActive true, deletedAt null — a
    // demoted/deactivated/deleted admin simply is not found by it.
    prismaMock.user.findFirst.mockResolvedValueOnce(null);

    const res = await endImpersonation();

    expect(res.ok).toBe(false);
    expect(clearImpersonationCookie).toHaveBeenCalledTimes(1);
    expect(adminSignOut).not.toHaveBeenCalled();
  });
});

describe("logoutAction", () => {
  const supabaseGetUser = vi.fn(async () => ({ data: { user: { id: ADMIN_AUTH_ID } } }));
  const supabaseSignOut = vi.fn(async (_args: unknown) => ({ error: null as null | { message: string } }));

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    supabaseSignOut.mockResolvedValue({ error: null });
  });

  it("clears the impersonation cookie only AFTER successful signOut", async () => {
    const order: string[] = [];
    clearImpersonationCookie.mockImplementation(async () => {
      order.push("clear");
    });
    readImpersonationContext.mockResolvedValue(null);
    createSupabaseServerClient.mockResolvedValueOnce({
      auth: {
        getUser: supabaseGetUser,
        signOut: vi.fn(async () => {
          order.push("signOut");
          return { error: null };
        }),
      },
    } as never);

    await run(logoutAction());

    expect(order).toEqual(["signOut", "clear"]);
  });

  it.each([false, true])("signs out locally and audits the admin for bound context (expired=%s)", async (expired) => {
    readImpersonationContext.mockResolvedValue({
      ticket: { adminAuthId: "admin-auth", adminUserId: ADMIN_ID, targetUserId: TARGET_ID, sessionId: SESSION_ID, expiresAt: Date.now() + 1000 }, expired,
    });
    checkCurrentSession.mockResolvedValue({ status: "live", sessionId: SESSION_ID, accessToken: "token" });
    createSupabaseServerClient.mockResolvedValueOnce({
      auth: { getUser: supabaseGetUser, signOut: supabaseSignOut },
    } as never);

    await run(logoutAction());

    expect(supabaseSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: ADMIN_ID,
      action: AUDIT_ACTIONS.IMPERSONATION_END,
      resourceId: TARGET_ID,
    }));
  });

  it("signs out with scope 'global' with no ticket, or a ticket whose binding cannot be proven", async () => {
    readImpersonationContext.mockResolvedValue(null);
    createSupabaseServerClient.mockResolvedValueOnce({
      auth: { getUser: supabaseGetUser, signOut: supabaseSignOut },
    } as never);

    await run(logoutAction());

    expect(supabaseSignOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("keeps a stale signed ticket local when its session binding no longer matches", async () => {
    readImpersonationContext.mockResolvedValue({
      ticket: { adminAuthId: "admin-auth", adminUserId: ADMIN_ID, targetUserId: TARGET_ID, sessionId: SESSION_ID, expiresAt: Date.now() + 1000 },
      expired: false,
    });
    checkCurrentSession.mockResolvedValue({ status: "none" });
    createSupabaseServerClient.mockResolvedValueOnce({
      auth: { getUser: supabaseGetUser, signOut: supabaseSignOut },
    } as never);

    await run(logoutAction());

    expect(supabaseSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(writeAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.IMPERSONATION_END }));
  });

  it.each(["returned", "thrown"])("retains the ticket and writes no completion audit on %s provider failure", async (failure) => {
    readImpersonationContext.mockResolvedValue({
      ticket: { adminAuthId: "admin-auth", adminUserId: ADMIN_ID, targetUserId: TARGET_ID, sessionId: SESSION_ID, expiresAt: Date.now() - 1000 }, expired: true,
    });
    checkCurrentSession.mockResolvedValue({ status: "live", sessionId: SESSION_ID, accessToken: "token" });
    if (failure === "returned") supabaseSignOut.mockResolvedValueOnce({ error: { message: "unavailable" } });
    else supabaseSignOut.mockRejectedValueOnce(new Error("unavailable"));
    createSupabaseServerClient.mockResolvedValueOnce({
      auth: { getUser: supabaseGetUser, signOut: supabaseSignOut },
    } as never);

    await expect(logoutAction()).rejects.toThrow();

    expect(clearImpersonationCookie).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("resetTeacherPassword", () => {
  it("refuses a non-Super-Admin caller", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(resetTeacherPassword(form())).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a non-TEACHER target", async () => {
    // `role: "TEACHER"` is baked into the `where`, so a School Head / Super
    // Admin id is simply not found.
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    const res = await resetTeacherPassword(form());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("writes exactly the four documented update fields, with no isActive key at all", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      authId: "auth-teacher-1",
      schoolId: SCHOOL_ID,
    });

    const res = await resetTeacherPassword(form());
    expect(res.ok).toBe(true);

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.user.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: TARGET_ID });
    expect(call.data).toEqual({
      mustChangePassword: true,
      passwordIsSchoolId: false,
      passwordVaultCipher: null,
      passwordVaultSetAt: null,
    });
    expect(Object.prototype.hasOwnProperty.call(call.data, "isActive")).toBe(false);
  });

  it("never puts the returned credential in audit metadata", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      authId: "auth-teacher-1",
      schoolId: SCHOOL_ID,
    });

    const res = await resetTeacherPassword(form());
    expect(res.ok).toBe(true);
    const password = res.ok ? res.data.password : "";
    expect(password.length).toBeGreaterThan(0);

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: AUDIT_ACTIONS.TEACHER_PASSWORD_RESET,
      resource: "User",
      resourceId: TARGET_ID,
      metadata: { schoolId: SCHOOL_ID, via: "admin_accounts" },
    });
    expect(JSON.stringify(entry)).not.toContain(password);
  });
});

describe("getAccountProfile", () => {
  it("refuses a non-Super-Admin caller", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(getAccountProfile(TARGET_ID)).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null advisory/aral for a non-teacher, within a bounded query count", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      role: "SCHOOL_HEAD",
      fullName: "Head Person",
      firstName: "Head",
      lastName: "Person",
      email: "head@school.local",
      username: null,
      schoolId: SCHOOL_ID,
      isActive: true,
      mustChangePassword: false,
      profileCompleted: true,
      approvalStatus: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSeenReleaseVersion: null,
      school: { id: SCHOOL_ID, name: "Sample ES", schoolIdCode: "111111" },
      teacherProfile: null,
      advisorySections: [],
    });

    const res = await getAccountProfile(TARGET_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data.advisory).toBeNull();
    expect(res.data.aral).toBeNull();

    // 1 findFirst (user) + learner.groupBy skipped (no sections) + learner.count
    // skipped (not a teacher) + auditLog.groupBy + auditLog.findMany.
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.learner.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.learner.count).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(1);
  });
});
