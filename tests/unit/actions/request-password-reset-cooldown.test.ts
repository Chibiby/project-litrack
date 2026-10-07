import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exactly one live recovery token exists per identity — each new
 * `issueResetToken` invalidates the previous email's link. Production data
 * showed most resends land within minutes of the last one (median gap 3.3
 * min), so `requestPasswordReset` skips sending again when the user's
 * current token is younger than the cooldown. The check is best-effort: a
 * query failure must never block sending, and the caller must see the exact
 * same `{ ok: true }` result whether the email was actually sent or skipped
 * — anything else would be an account-enumeration / behavior oracle.
 */

const userFindUnique = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const sendPasswordRecoveryEmail = vi.fn();
const hasRecentRecoveryToken = vi.fn();
const headersMock = vi.fn();

vi.mock("@/lib/prisma", () => {
  const client = {
    user: {
      get findUnique() {
        return userFindUnique;
      },
    },
  };
  return { prisma: client, prismaFresh: client };
});

// Better Auth is the only auth backend: configured, never actually called here.
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
  isVerifiedImpersonationOf: vi.fn(),
  readImpersonation: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: { PASSWORD_RESET_REQUEST: "PASSWORD_RESET_REQUEST" },
}));

vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(),
  roleHomePath: vi.fn(),
  roleSecurityPath: vi.fn(),
}));

vi.mock("@/lib/auth/warm-routes", () => ({
  warmAdminRoutes: vi.fn(),
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

vi.mock("@/lib/auth/synthetic-email", () => ({ isSyntheticEmail: () => false }));

vi.mock("@/lib/auth/recovery-email", () => ({
  RESET_COOKIE: "litrack_reset",
  RESET_COOKIE_PATH: "/auth",
  get sendPasswordRecoveryEmail() {
    return sendPasswordRecoveryEmail;
  },
  get hasRecentRecoveryToken() {
    return hasRecentRecoveryToken;
  },
}));

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect should not run for requestPasswordReset");
  },
  unstable_rethrow: () => {},
}));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF-COOLDOWN") }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requestPasswordReset } from "@/lib/actions/auth";

function form(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  sendPasswordRecoveryEmail.mockResolvedValue(undefined);
  process.env.NEXT_PUBLIC_APP_URL = "https://litrack.example.org";
  headersMock.mockResolvedValue(new Headers());
  userFindUnique.mockResolvedValue({
    id: "user-1",
    authId: "11111111-1111-1111-1111-111111111111",
    schoolId: "school-1",
    isActive: true,
    deletedAt: null,
  });
});

describe("requestPasswordReset — resend cooldown", () => {
  it("skips generating/sending when the current token is younger than the cooldown", async () => {
    hasRecentRecoveryToken.mockResolvedValue(true);

    const result = await requestPasswordReset(form("teacher@example.com"));

    expect(hasRecentRecoveryToken).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.any(Number)
    );
    expect(sendPasswordRecoveryEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("sends when the token is older than the cooldown", async () => {
    hasRecentRecoveryToken.mockResolvedValue(false);

    const result = await requestPasswordReset(form("teacher@example.com"));

    expect(sendPasswordRecoveryEmail).toHaveBeenCalledWith(
      "teacher@example.com",
      "https://litrack.example.org",
      "11111111-1111-1111-1111-111111111111"
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns the identical result whether skipped or sent — no oracle for account existence or cooldown state", async () => {
    hasRecentRecoveryToken.mockResolvedValue(true);
    const skipped = await requestPasswordReset(form("teacher@example.com"));

    hasRecentRecoveryToken.mockResolvedValue(false);
    const sent = await requestPasswordReset(form("teacher@example.com"));

    expect(skipped).toEqual(sent);
    expect(skipped).toEqual({ ok: true });
  });
});
