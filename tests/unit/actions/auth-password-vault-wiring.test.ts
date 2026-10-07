import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The School Head password vault merge (`src/lib/auth/password-vault.ts`)
 * put `passwordChangeFields(role, newPassword)` behind every place a person
 * sets their own password: `setPasswordAction`, `changePasswordAction`, and
 * `completePasswordReset`. Before that merge those call sites wrote the literal
 * `{ mustChangePassword: false, passwordIsSchoolId: false }` by hand.
 *
 * This file pins the seam so a future edit that reintroduces the literal, or
 * that passes the wrong role or the wrong password (e.g. `currentPassword`
 * instead of the new one, the bcrypt hash instead of the plaintext, or a stale
 * `user`/`appUser` object) fails loudly: `passwordChangeFields` is mocked to a
 * sentinel, and the `User` update inside the transaction is asserted to receive
 * exactly that sentinel and nothing else.
 *
 * It also pins the transactional shape (spec section 2): the identity's new
 * hash and the `User` update commit in ONE `prismaFresh.$transaction`, and for
 * a reset the single-use token is consumed in that same transaction.
 */

const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const transaction = vi.fn();
const signInWithPassword = vi.fn();
const revokeAllSessions = vi.fn(async (..._args: unknown[]) => 0);
const revokeOtherSessions = vi.fn(async (..._args: unknown[]) => 0);
const getAuthSession = vi.fn(async (..._args: unknown[]) => ({ session: { token: "tok-current" } }) as unknown);
const verifyAccountPassword = vi.fn();
const setPassword = vi.fn();
const hashPassword = vi.fn();
const peekResetToken = vi.fn();
const consumeResetToken = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const redirect = vi.fn();
const requireUser = vi.fn();
const roleHomePath = vi.fn((..._args: unknown[]) => "/home");
const cookieSet = vi.fn();
const passwordChangeFields = vi.fn((role: string, plaintext: string) => ({
  __sentinel: true,
  role,
  plaintext,
}));
let cookieJar: Record<string, string> = {};

const tx = {
  user: {
    get update() {
      return userUpdate;
    },
    get findUnique() {
      return userFindUnique;
    },
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get update() {
        return userUpdate;
      },
      get findUnique() {
        return userFindUnique;
      },
    },
  },
  prismaFresh: {
    $transaction: async (fn: (t: typeof tx) => unknown) => {
      transaction();
      return fn(tx);
    },
  },
}));

vi.mock("@/lib/auth/auth-session", () => ({
  get signInWithPassword() {
    return signInWithPassword;
  },
  get revokeAllSessions() {
    return revokeAllSessions;
  },
  get revokeOtherSessions() {
    return revokeOtherSessions;
  },
  get getAuthSession() {
    return getAuthSession;
  },
  endCurrentSession: vi.fn(async () => true),
}));

vi.mock("@/lib/auth/identity", () => ({
  get verifyAccountPassword() {
    return verifyAccountPassword;
  },
  get setPassword() {
    return setPassword;
  },
  setEmail: vi.fn(),
  createIdentity: vi.fn(),
  findIdentityByEmail: vi.fn(),
}));

vi.mock("@/lib/auth/password-hash", () => ({
  DUMMY_BCRYPT_HASH: "$2b$10$dummy",
  get hashPassword() {
    return hashPassword;
  },
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/auth/password-reset", () => ({
  get peekResetToken() {
    return peekResetToken;
  },
  get consumeResetToken() {
    return consumeResetToken;
  },
}));

vi.mock("@/lib/auth/impersonation-session", () => ({
  readImpersonation: vi.fn(async () => null),
  isVerifiedImpersonationOf: vi.fn(async () => false),
  expireImpersonationCookies: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/login-gates", () => ({
  assertAuthConfigured: vi.fn(),
  requireActiveSchool: vi.fn(),
  LOGIN_RATE: { limit: 10, windowMs: 300_000 },
}));
vi.mock("@/lib/auth/lookup-throttle", () => ({
  assertLookupAllowed: vi.fn(),
  recordFailedLookup: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: {
    PASSWORD_CHANGE: "PASSWORD_CHANGE",
    LOGIN_DENIED: "LOGIN_DENIED",
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));

vi.mock("@/lib/auth/session", () => ({
  get requireUser() {
    return requireUser;
  },
  get roleHomePath() {
    return roleHomePath;
  },
  roleSecurityPath: vi.fn((..._args: unknown[]) => "/security"),
}));

vi.mock("@/lib/auth/password-vault", () => ({
  get passwordChangeFields() {
    return passwordChangeFields;
  },
}));

vi.mock("@/lib/auth/last-login", () => ({ recordLastLogin: vi.fn() }));
vi.mock("@/lib/auth/school-head-sign-in", () => ({ findSignInSchoolHead: vi.fn() }));
vi.mock("@/lib/auth/recovery-email", () => ({
  RESET_COOKIE: "litrack_reset",
  RESET_COOKIE_PATH: "/auth",
  sendPasswordRecoveryEmail: vi.fn(),
  hasRecentRecoveryToken: vi.fn(),
}));
vi.mock("@/lib/demo/session", () => ({ clearDemoSessionCookie: vi.fn(async () => undefined) }));

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

vi.mock("@/lib/auth/synthetic-email", () => ({ isSyntheticEmail: () => false }));

vi.mock("@/lib/auth/test-lab", () => ({ readTestLabSession: vi.fn(async () => false) }));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    // The real `redirect` throws to unwind the action; mirroring that keeps the
    // code after it unreachable here too.
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  // `action()` calls this first so Next's own control-flow throws (redirect /
  // notFound) escape the wrapper instead of being classified as failures.
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF-VAULT") }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name in cookieJar ? { value: cookieJar[name] } : undefined),
    has: (name: string) => name in cookieJar,
    set: (...args: unknown[]) => cookieSet(...args),
    delete: vi.fn(),
  }),
}));

import {
  setPasswordAction,
  changePasswordAction,
  completePasswordReset,
} from "@/lib/actions/auth";
import { AppError } from "@/lib/errors/app-error";

/** Run a wrapped action, resolving the throw a successful redirect performs. */
async function run<T>(fn: () => Promise<T>): Promise<T | { redirected: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
      return { redirected: err.message.slice("NEXT_REDIRECT:".length) };
    }
    throw err;
  }
}

const NEW_PASSWORD = "Br4ndNewPass";
const CURRENT_PASSWORD = "Old3Password";
const HASH = "$2b$10$freshlyhashedvalue";
const RESET_TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

function setPasswordForm(password = NEW_PASSWORD): FormData {
  const fd = new FormData();
  fd.set("password", password);
  fd.set("confirmPassword", password);
  return fd;
}

function changePasswordForm(): FormData {
  const fd = new FormData();
  fd.set("currentPassword", CURRENT_PASSWORD);
  fd.set("password", NEW_PASSWORD);
  fd.set("confirmPassword", NEW_PASSWORD);
  return fd;
}

function liveReset(authId: string) {
  cookieJar = { litrack_reset: RESET_TOKEN };
  peekResetToken.mockResolvedValue({ authId, expiresAt: new Date(Date.now() + 60_000) });
  consumeResetToken.mockResolvedValue(authId);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar = {};
  checkRateLimit.mockResolvedValue({ ok: true });
  roleHomePath.mockImplementation((..._args: unknown[]) => "/home");
  hashPassword.mockResolvedValue(HASH);
  setPassword.mockResolvedValue(undefined);
  verifyAccountPassword.mockResolvedValue(true);
  signInWithPassword.mockResolvedValue({ ok: true, authId: "auth-1" });
});

describe("session revocation after a password write", () => {
  const HEAD = {
    id: "head-1",
    authId: "auth-head-1",
    role: "SCHOOL_HEAD",
    schoolId: "school-1",
    email: "sh@example.test",
  };
  const live = { id: "u", role: "TEACHER", schoolId: "s", email: "t@example.test", isActive: true, deletedAt: null };

  it("setPasswordAction ends the OTHER sessions, keeping the current token, after the commit", async () => {
    requireUser.mockResolvedValue(HEAD);

    await run(() => setPasswordAction(setPasswordForm()));

    expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
    expect(revokeOtherSessions).toHaveBeenCalledWith("auth-head-1", "tok-current");
    expect(revokeAllSessions).not.toHaveBeenCalled();
    expect(revokeOtherSessions.mock.invocationCallOrder[0]).toBeGreaterThan(
      userUpdate.mock.invocationCallOrder[0]
    );
  });

  it("changePasswordAction ends the OTHER sessions, keeping the current token", async () => {
    requireUser.mockResolvedValue({ ...HEAD, role: "TEACHER" });

    const result = await run(() => changePasswordAction(changePasswordForm()));

    expect(result).toEqual({ ok: true });
    expect(revokeOtherSessions).toHaveBeenCalledWith("auth-head-1", "tok-current");
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it("changePasswordAction revokes nothing when the current password is wrong", async () => {
    requireUser.mockResolvedValue({ ...HEAD, role: "TEACHER" });
    verifyAccountPassword.mockResolvedValue(false);

    await run(() => changePasswordAction(changePasswordForm()));

    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it("setPasswordAction revokes nothing when the identity write fails", async () => {
    requireUser.mockResolvedValue(HEAD);
    setPassword.mockRejectedValue(new Error("db down"));

    await run(() => setPasswordAction(setPasswordForm()));

    expect(revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("completePasswordReset revokes EVERY session of the token's identity before the auto sign-in", async () => {
    liveReset("auth-reset-1");
    userFindUnique.mockResolvedValue(live);

    await run(() => completePasswordReset(setPasswordForm()));

    expect(revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(revokeAllSessions).toHaveBeenCalledWith("auth-reset-1");
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    // Before the sign-in: revoking afterwards would delete the session just issued.
    expect(revokeAllSessions.mock.invocationCallOrder[0]).toBeLessThan(
      signInWithPassword.mock.invocationCallOrder[0]
    );
    expect(revokeAllSessions.mock.invocationCallOrder[0]).toBeGreaterThan(
      userUpdate.mock.invocationCallOrder[0]
    );
  });

  it("completePasswordReset revokes nothing when the token was already used up", async () => {
    cookieJar = { litrack_reset: RESET_TOKEN };
    peekResetToken.mockResolvedValue({ authId: "auth-reset-1", expiresAt: new Date(Date.now() + 60_000) });
    consumeResetToken.mockRejectedValue(new AppError("AUTH_RESET_LINK_EXPIRED"));

    await run(() => completePasswordReset(setPasswordForm()));

    expect(revokeAllSessions).not.toHaveBeenCalled();
  });
});

describe("setPasswordAction — vault wiring", () => {
  it("writes exactly passwordChangeFields(role, newPassword) for a SCHOOL_HEAD", async () => {
    requireUser.mockResolvedValue({
      id: "head-1",
      authId: "auth-head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      email: "sh@example.test",
    });

    const result = await run(() => setPasswordAction(setPasswordForm()));

    expect(passwordChangeFields).toHaveBeenCalledTimes(1);
    expect(passwordChangeFields).toHaveBeenCalledWith("SCHOOL_HEAD", NEW_PASSWORD);

    const expectedSentinel = passwordChangeFields.mock.results[0].value;
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "head-1" },
      data: expectedSentinel,
    });

    expect(result).toEqual({ redirected: "/home" });
  });

  it("writes the identity's hash and the User update in the same transaction, hashed once", async () => {
    requireUser.mockResolvedValue({
      id: "head-1",
      authId: "auth-head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      email: "sh@example.test",
    });

    await run(() => setPasswordAction(setPasswordForm()));

    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledWith(NEW_PASSWORD);
    expect(transaction).toHaveBeenCalledTimes(1);
    // The pre-computed hash, not the plaintext, goes to the identity; both
    // writes use the transaction client.
    expect(setPassword).toHaveBeenCalledWith("auth-head-1", { hash: HASH }, tx);
    expect(JSON.stringify(setPassword.mock.calls)).not.toContain(NEW_PASSWORD);
  });

  it("hashes before the transaction opens, so bcrypt never holds row locks", async () => {
    requireUser.mockResolvedValue({
      id: "head-1",
      authId: "auth-head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      email: "sh@example.test",
    });

    await run(() => setPasswordAction(setPasswordForm()));

    expect(hashPassword.mock.invocationCallOrder[0]).toBeLessThan(transaction.mock.invocationCallOrder[0]);
  });

  it("writes an audit row that names the reason and never the password", async () => {
    requireUser.mockResolvedValue({
      id: "head-1",
      authId: "auth-head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      email: "sh@example.test",
    });

    await run(() => setPasswordAction(setPasswordForm()));

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PASSWORD_CHANGE", metadata: { reason: "set_password" } })
    );
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain(HASH);
  });

  it("writes nothing if the identity write fails (the transaction aborts before the User update)", async () => {
    requireUser.mockResolvedValue({
      id: "head-1",
      authId: "auth-head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      email: "sh@example.test",
    });
    setPassword.mockRejectedValue(new AppError("IDENTITY_NOT_FOUND"));

    const result = await run(() => setPasswordAction(setPasswordForm()));

    expect(result).toMatchObject({ ok: false });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("changePasswordAction — vault wiring", () => {
  it("writes exactly passwordChangeFields(role, NEW password — not currentPassword) for a TEACHER", async () => {
    requireUser.mockResolvedValue({
      id: "teacher-1",
      authId: "auth-teacher-1",
      role: "TEACHER",
      schoolId: "school-1",
      email: "teacher@example.test",
    });

    const result = await run(() => changePasswordAction(changePasswordForm()));

    expect(passwordChangeFields).toHaveBeenCalledTimes(1);
    // The seam this test exists for: the NEW password, never currentPassword.
    expect(passwordChangeFields).toHaveBeenCalledWith("TEACHER", NEW_PASSWORD);
    expect(passwordChangeFields).not.toHaveBeenCalledWith("TEACHER", CURRENT_PASSWORD);

    const expectedSentinel = passwordChangeFields.mock.results[0].value;
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "teacher-1" },
      data: expectedSentinel,
    });

    expect(result).toEqual({ ok: true });
  });

  it("verifies the current password against the stored hash before hashing or writing anything", async () => {
    requireUser.mockResolvedValue({
      id: "teacher-1",
      authId: "auth-teacher-1",
      role: "TEACHER",
      schoolId: "school-1",
      email: "teacher@example.test",
    });

    await run(() => changePasswordAction(changePasswordForm()));

    expect(verifyAccountPassword).toHaveBeenCalledWith("auth-teacher-1", CURRENT_PASSWORD);
    expect(verifyAccountPassword.mock.invocationCallOrder[0]).toBeLessThan(
      hashPassword.mock.invocationCallOrder[0]
    );
    expect(setPassword).toHaveBeenCalledWith("auth-teacher-1", { hash: HASH }, tx);
  });

  it("changes nothing and seals nothing when the current password is wrong", async () => {
    requireUser.mockResolvedValue({
      id: "teacher-1",
      authId: "auth-teacher-1",
      role: "TEACHER",
      schoolId: "school-1",
      email: "teacher@example.test",
    });
    verifyAccountPassword.mockResolvedValue(false);

    const result = await run(() => changePasswordAction(changePasswordForm()));

    expect(result).toMatchObject({ ok: false, code: "AUTH_CURRENT_PASSWORD_INCORRECT" });
    expect(passwordChangeFields).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("completePasswordReset — vault wiring", () => {
  it("writes exactly passwordChangeFields(appUser.role, newPassword) for a SCHOOL_HEAD", async () => {
    liveReset("auth-reset-1");
    userFindUnique.mockResolvedValue({
      id: "head-2",
      role: "SCHOOL_HEAD",
      schoolId: "school-2",
      email: "sh2@example.test",
      isActive: true,
      deletedAt: null,
    });

    const result = await run(() => completePasswordReset(setPasswordForm()));

    expect(passwordChangeFields).toHaveBeenCalledTimes(1);
    expect(passwordChangeFields).toHaveBeenCalledWith("SCHOOL_HEAD", NEW_PASSWORD);

    const expectedSentinel = passwordChangeFields.mock.results[0].value;
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "head-2" },
      data: expectedSentinel,
    });

    expect(result).toEqual({ redirected: "/home" });
  });

  it("writes exactly passwordChangeFields(appUser.role, newPassword) for a TEACHER, using appUser — not a stale variable", async () => {
    liveReset("auth-reset-2");
    userFindUnique.mockResolvedValue({
      id: "teacher-2",
      role: "TEACHER",
      schoolId: "school-3",
      email: "t2@example.test",
      isActive: true,
      deletedAt: null,
    });

    await run(() => completePasswordReset(setPasswordForm()));

    expect(passwordChangeFields).toHaveBeenCalledWith("TEACHER", NEW_PASSWORD);
    const expectedSentinel = passwordChangeFields.mock.results[0].value;
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "teacher-2" },
      data: expectedSentinel,
    });
  });

  it("consumes the token, writes the hash and updates the User in ONE transaction (single use)", async () => {
    liveReset("auth-reset-1");
    userFindUnique.mockResolvedValue({
      id: "head-2",
      role: "SCHOOL_HEAD",
      schoolId: "school-2",
      email: "sh2@example.test",
      isActive: true,
      deletedAt: null,
    });

    await run(() => completePasswordReset(setPasswordForm()));

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(consumeResetToken).toHaveBeenCalledWith(RESET_TOKEN, tx);
    expect(setPassword).toHaveBeenCalledWith("auth-reset-1", { hash: HASH }, tx);
    expect(userFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { authId: "auth-reset-1" } }));
    // Token first, then the credential, then the User row.
    expect(consumeResetToken.mock.invocationCallOrder[0]).toBeLessThan(setPassword.mock.invocationCallOrder[0]);
    expect(setPassword.mock.invocationCallOrder[0]).toBeLessThan(userUpdate.mock.invocationCallOrder[0]);
  });

  it("takes the identity from the token, never from the form", async () => {
    liveReset("auth-from-token");
    userFindUnique.mockResolvedValue({
      id: "u", role: "TEACHER", schoolId: "s", email: "t@example.test", isActive: true, deletedAt: null,
    });
    const fd = setPasswordForm();
    fd.set("authId", "auth-from-form");
    fd.set("userId", "someone-else");

    await run(() => completePasswordReset(fd));

    expect(setPassword).toHaveBeenCalledWith("auth-from-token", expect.anything(), tx);
    expect(JSON.stringify(setPassword.mock.calls)).not.toContain("auth-from-form");
  });

  it("expires the reset cookie with the attributes it was set with, so the browser actually drops it", async () => {
    liveReset("auth-reset-1");
    userFindUnique.mockResolvedValue({
      id: "u", role: "TEACHER", schoolId: "s", email: "t@example.test", isActive: true, deletedAt: null,
    });

    await run(() => completePasswordReset(setPasswordForm()));

    expect(cookieSet).toHaveBeenCalledWith(
      "litrack_reset",
      "",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/auth", maxAge: 0 })
    );
  });

  it("signs the person in with the NEW password, then sends them home", async () => {
    liveReset("auth-reset-1");
    userFindUnique.mockResolvedValue({
      id: "u", role: "TEACHER", schoolId: "s", email: "t@example.test", isActive: true, deletedAt: null,
    });

    const result = await run(() => completePasswordReset(setPasswordForm()));

    expect(signInWithPassword).toHaveBeenCalledWith("t@example.test", NEW_PASSWORD);
    expect(result).toEqual({ redirected: "/home" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PASSWORD_CHANGE", metadata: { reason: "password_reset" } })
    );
  });

  it("saves the password but sends a deactivated account to /login without a session", async () => {
    liveReset("auth-reset-1");
    userFindUnique.mockResolvedValue({
      id: "u", role: "TEACHER", schoolId: "s", email: "t@example.test", isActive: false, deletedAt: null,
    });

    const result = await run(() => completePasswordReset(setPasswordForm()));

    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(result).toEqual({ redirected: "/login" });
  });

  it("sends a person to /login (not the home page) when the automatic sign-in fails; the password is saved", async () => {
    liveReset("auth-reset-1");
    userFindUnique.mockResolvedValue({
      id: "u", role: "TEACHER", schoolId: "s", email: "t@example.test", isActive: true, deletedAt: null,
    });
    signInWithPassword.mockResolvedValue({ ok: false, code: "AUTH_PROVIDER_ERROR", error: {} });

    const result = await run(() => completePasswordReset(setPasswordForm()));

    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ redirected: "/login" });
  });

  it("writes nothing when the token was used up between the check and the save", async () => {
    cookieJar = { litrack_reset: RESET_TOKEN };
    peekResetToken.mockResolvedValue({ authId: "auth-reset-1", expiresAt: new Date(Date.now() + 60_000) });
    consumeResetToken.mockRejectedValue(new AppError("AUTH_RESET_LINK_EXPIRED"));

    const result = await run(() => completePasswordReset(setPasswordForm()));

    expect(result).toMatchObject({ ok: false, code: "AUTH_RESET_LINK_EXPIRED" });
    expect(setPassword).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(passwordChangeFields).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("leaves the cookie in place when the save fails, so the person can retry the same link", async () => {
    liveReset("auth-reset-1");
    setPassword.mockRejectedValue(new Error("db down"));

    const result = await run(() => completePasswordReset(setPasswordForm()));

    expect(result).toMatchObject({ ok: false });
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("charges the reset allowance to the identity, and refuses once it is spent", async () => {
    liveReset("auth-reset-1");
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 120_000 });

    const result = await run(() => completePasswordReset(setPasswordForm()));

    expect(checkRateLimit).toHaveBeenCalledWith("password:reset:auth-reset-1", expect.any(Object));
    expect(result).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(consumeResetToken).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });
});
