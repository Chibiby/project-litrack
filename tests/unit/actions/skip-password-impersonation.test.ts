import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `skipPasswordChange` during a Super Admin impersonation.
 *
 * `mustChangePassword` is the real person's first-sign-in prompt. An admin
 * signed in as them must never clear it: an impersonation of this account that
 * the session row proves is sent to the role home with no write and no audit
 * row, and one that is shown (cookie cache) but cannot be proven against the
 * session row is refused outright. With no impersonation of this account in
 * play the ordinary skip (the account holder's own choice) still writes.
 *
 * Impersonation state is Better Auth session state now, read through
 * `readImpersonation` (cheap, cookie-cached) and proven with
 * `isVerifiedImpersonationOf` (fresh session row); both are faked here, as
 * their own behavior is pinned in tests/unit/auth-flows.
 */

const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";

const userUpdate = vi.fn();
const writeAudit = vi.fn();
const requireUser = vi.fn();
const readImpersonation = vi.fn();
const isVerifiedImpersonationOf = vi.fn();

vi.mock("@/lib/prisma", () => {
  const client = {
    user: {
      get update() {
        return userUpdate;
      },
    },
  };
  return { prisma: client, prismaFresh: client };
});

vi.mock("@/lib/auth/better-auth", () => ({
  isAuthConfigured: () => true,
  getAuth: vi.fn(),
}));
vi.mock("@/lib/auth/auth-session", () => ({
  endCurrentSession: vi.fn(),
  getAuthSession: vi.fn(),
  revokeAllSessions: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock("@/lib/auth/identity", () => ({
  createIdentity: vi.fn(),
  findIdentityByEmail: vi.fn(),
  setEmail: vi.fn(),
  setPassword: vi.fn(),
  verifyAccountPassword: vi.fn(),
}));
vi.mock("@/lib/auth/password-hash", () => ({
  DUMMY_BCRYPT_HASH: "dummy",
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/auth/password-reset", () => ({
  consumeResetToken: vi.fn(),
  peekResetToken: vi.fn(),
}));
vi.mock("@/lib/auth/impersonation-session", () => ({
  expireImpersonationCookies: vi.fn(),
  isVerifiedImpersonationOf: (...args: unknown[]) => isVerifiedImpersonationOf(...args),
  readImpersonation: (...args: unknown[]) => readImpersonation(...args),
}));
vi.mock("@/lib/auth/recovery-email", () => ({
  RESET_COOKIE: "litrack_reset",
  RESET_COOKIE_PATH: "/auth",
  sendPasswordRecoveryEmail: vi.fn(),
  hasRecentRecoveryToken: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: { PASSWORD_CHANGE: "PASSWORD_CHANGE" },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));
vi.mock("@/lib/auth/session", async () => {
  const roles = await vi.importActual<typeof import("@/lib/auth/roles")>("@/lib/auth/roles");
  return {
    requireUser: (...args: unknown[]) => requireUser(...args),
    roleHomePath: roles.roleHomePath,
    roleSecurityPath: roles.roleSecurityPath,
  };
});
// Real accounts, not demo: never a Test Lab dry-run session.
vi.mock("@/lib/auth/test-lab", () => ({ readTestLabSession: vi.fn(async () => false) }));
vi.mock("@/lib/auth/warm-routes", () => ({
  warmAdminRoutes: vi.fn(),
  warmDistrictRoutes: vi.fn(),
  warmSchoolHeadRoutes: vi.fn(),
  warmTeacherRoutes: vi.fn(),
}));
vi.mock("@/lib/auth/teacher-registration", () => ({ completeTeacherAuthAfterVerify: vi.fn() }));
vi.mock("@/lib/auth/teacher-registration-helpers", () => ({
  DECLINED_REGISTRATION_MESSAGE: "declined",
  DEACTIVATED_TEACHER_MESSAGE: "deactivated",
  isDeactivatedTeacher: vi.fn(),
  isPendingTeacherAtSchool: vi.fn(),
  registerConflictCode: vi.fn(),
  registerConflictError: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: vi.fn(), has: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF-SKIP") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { skipPasswordChange } = await import("@/lib/actions/auth");

function impersonationOf(targetUserId: string) {
  return {
    adminAuthId: "11111111-1111-4111-8111-111111111111",
    adminUserId: "22222222-2222-4222-8222-222222222222",
    targetUserId,
    returnTo: null,
    expired: false,
  };
}

async function run(): Promise<unknown> {
  try {
    return await skipPasswordChange();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
      return { redirected: err.message.slice("NEXT_REDIRECT:".length) };
    }
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  readImpersonation.mockResolvedValue(null);
  isVerifiedImpersonationOf.mockResolvedValue(false);
});

describe("skipPasswordChange while a Super Admin is signed in as the account", () => {
  it.each([
    ["DISTRICT_ADMIN", "/district"],
    ["SCHOOL_HEAD", "/school-head"],
  ])("a verified impersonation of a %s goes to %s without clearing the flag", async (role, home) => {
    requireUser.mockResolvedValue({ id: USER_ID, role, schoolId: null, mustChangePassword: true });
    readImpersonation.mockResolvedValue(impersonationOf(USER_ID));
    isVerifiedImpersonationOf.mockResolvedValue(true);

    expect(await run()).toEqual({ redirected: home });
    expect(isVerifiedImpersonationOf).toHaveBeenCalledWith(USER_ID);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses when the impersonation is shown but the session row cannot prove it", async () => {
    requireUser.mockResolvedValue({ id: USER_ID, role: "DISTRICT_ADMIN", schoolId: null, mustChangePassword: true });
    readImpersonation.mockResolvedValue(impersonationOf(USER_ID));
    isVerifiedImpersonationOf.mockResolvedValue(false);

    expect(await run()).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("still lets the real account holder skip when no impersonation is in play (control)", async () => {
    requireUser.mockResolvedValue({ id: USER_ID, role: "DISTRICT_ADMIN", schoolId: null, mustChangePassword: true });

    expect(await run()).toEqual({ redirected: "/district" });
    expect(isVerifiedImpersonationOf).not.toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID }, data: { mustChangePassword: false } })
    );
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("an impersonation of a different account proves nothing about this one: it is the holder's own skip", async () => {
    requireUser.mockResolvedValue({ id: USER_ID, role: "DISTRICT_ADMIN", schoolId: null, mustChangePassword: true });
    readImpersonation.mockResolvedValue(impersonationOf(OTHER_USER_ID));
    isVerifiedImpersonationOf.mockResolvedValue(true);

    expect(await run()).toEqual({ redirected: "/district" });
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it("still refuses a teacher, impersonation or not (they must choose a new password)", async () => {
    requireUser.mockResolvedValue({ id: USER_ID, role: "TEACHER", schoolId: "school-1", mustChangePassword: true });

    expect(await run()).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
