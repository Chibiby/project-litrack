import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test Lab dry-run coverage (docs/test-lab-spec.md, T5) for the four
 * self-bound account saves in `src/lib/actions/auth.ts`:
 * `setPasswordAction`, `skipPasswordChange`, `changePasswordAction`, and
 * `changeEmailAction`.
 *
 * In a Test Lab session (`readTestLabSession(user)` true) each must validate
 * input, return `{ ok: true, data: { dryRun: true, preview } }`, and touch
 * nothing: no password hash computed, no identity write, no transaction, no
 * `User` write, no audit row. Outside a Test Lab session the real write runs
 * (pinned in depth in `auth-password-vault-wiring.test.ts`; this file only adds
 * a smoke check that the real path still runs and writes the identity and the
 * `User` row together).
 */

const userUpdate = vi.fn();
const userFindFirst = vi.fn();
const transaction = vi.fn();
const signInWithPassword = vi.fn();
const revokeAllSessions = vi.fn(async (..._args: unknown[]) => 0);
const revokeOtherSessions = vi.fn(async (..._args: unknown[]) => 0);
const getAuthSession = vi.fn(async (..._args: unknown[]) => ({ session: { token: "tok-current" } }) as unknown);
const verifyAccountPassword = vi.fn();
const setPassword = vi.fn();
const setEmail = vi.fn();
const hashPassword = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const requireUser = vi.fn();
const roleHomePath = vi.fn((..._args: unknown[]) => "/home");
const readTestLabSession = vi.fn(async () => false);
const passwordChangeFields = vi.fn((role: string, plaintext: string) => ({
  __sentinel: true,
  role,
  plaintext,
}));

const tx = {
  user: {
    get update() {
      return userUpdate;
    },
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get update() {
        return userUpdate;
      },
      get findFirst() {
        return userFindFirst;
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
  get setEmail() {
    return setEmail;
  },
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

vi.mock("@/lib/auth/password-reset", () => ({ consumeResetToken: vi.fn(), peekResetToken: vi.fn() }));

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
    EMAIL_CHANGE: "EMAIL_CHANGE",
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

vi.mock("@/lib/auth/test-lab", () => ({
  get readTestLabSession() {
    return readTestLabSession;
  },
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

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    // The real `redirect` throws to unwind the action; mirroring that keeps
    // the code after it unreachable here too.
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  // `action()` calls this first so Next's own control-flow throws (redirect /
  // notFound) escape the wrapper instead of being classified as failures.
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF-DRYRUN") }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));

import {
  setPasswordAction,
  skipPasswordChange,
  changePasswordAction,
  changeEmailAction,
} from "@/lib/actions/auth";

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

function setPasswordForm(password = NEW_PASSWORD): FormData {
  const fd = new FormData();
  fd.set("password", password);
  fd.set("confirmPassword", password);
  return fd;
}

function changePasswordForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("currentPassword", CURRENT_PASSWORD);
  fd.set("password", NEW_PASSWORD);
  fd.set("confirmPassword", NEW_PASSWORD);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function changeEmailForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("newEmail", "new@example.test");
  fd.set("confirmEmail", "new@example.test");
  fd.set("currentPassword", CURRENT_PASSWORD);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

const HEAD_USER = {
  id: "head-1",
  authId: "auth-head-1",
  role: "SCHOOL_HEAD" as const,
  schoolId: "school-1",
  email: "sh@example.test",
};

/** Nothing that could change a credential, an identity, or a User row ran. */
function expectNothingTouched() {
  expect(hashPassword).not.toHaveBeenCalled();
  expect(verifyAccountPassword).not.toHaveBeenCalled();
  expect(signInWithPassword).not.toHaveBeenCalled();
  expect(setPassword).not.toHaveBeenCalled();
  expect(setEmail).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
  expect(userUpdate).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
  expect(revokeOtherSessions).not.toHaveBeenCalled();
  expect(revokeAllSessions).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  roleHomePath.mockImplementation((..._args: unknown[]) => "/home");
  readTestLabSession.mockResolvedValue(false);
  userFindFirst.mockResolvedValue(null);
  verifyAccountPassword.mockResolvedValue(true);
  hashPassword.mockResolvedValue("$2b$10$hashed");
  setPassword.mockResolvedValue(undefined);
  setEmail.mockResolvedValue(undefined);
});

describe("setPasswordAction — Test Lab dry run", () => {
  it("returns a preview and touches no identity, hash, transaction or User row", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => setPasswordAction(setPasswordForm()));

    expect(result).toEqual({ ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } });
    expectNothingTouched();
  });

  it("never puts the password in the preview", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => setPasswordAction(setPasswordForm()));
    expect(JSON.stringify(result)).not.toContain(NEW_PASSWORD);
  });

  it("still returns the validation error in a Test Lab session for a mismatched confirmation", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const fd = new FormData();
    fd.set("password", NEW_PASSWORD);
    fd.set("confirmPassword", "something-else");

    const result = await run(() => setPasswordAction(fd));
    expect((result as { ok: boolean }).ok).toBe(false);
    expectNothingTouched();
  });

  it("still rejects a password over 72 bytes in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const tooLong = `${"a1".repeat(37)}`; // 74 bytes
    const result = await run(() => setPasswordAction(setPasswordForm(tooLong)));
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expectNothingTouched();
  });

  it("performs the real write and redirects outside a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);

    const result = await run(() => setPasswordAction(setPasswordForm()));
    expect(result).toEqual({ redirected: "/home" });
    expect(hashPassword).toHaveBeenCalledWith(NEW_PASSWORD);
    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    // The other devices are signed out; this one (its token) stays.
    expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
    expect(revokeOtherSessions).toHaveBeenCalledWith("auth-head-1", "tok-current");
    expect(revokeAllSessions).not.toHaveBeenCalled();
    // ...and only after the credential and User row committed.
    expect(revokeOtherSessions.mock.invocationCallOrder[0]).toBeGreaterThan(
      userUpdate.mock.invocationCallOrder[0]
    );
  });
});

describe("skipPasswordChange — Test Lab dry run", () => {
  it("returns a preview and writes nothing in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => skipPasswordChange());

    expect(result).toEqual({ ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } });
    expectNothingTouched();
  });

  it("performs the real write and redirects outside a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);

    const result = await run(() => skipPasswordChange());
    expect(result).toEqual({ redirected: "/home" });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    // Skipping changes no credential: the identity is never written.
    expect(setPassword).not.toHaveBeenCalled();
  });
});

describe("changePasswordAction — Test Lab dry run", () => {
  it("returns a preview and touches no identity, hash, transaction or User row", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => changePasswordAction(changePasswordForm()));

    expect(result).toEqual({ ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } });
    expectNothingTouched();
  });

  it("does not even check the current password in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    await run(() => changePasswordAction(changePasswordForm({ currentPassword: "definitely-wrong" })));
    expect(verifyAccountPassword).not.toHaveBeenCalled();
  });

  it("still returns the validation error in a Test Lab session for a mismatched confirmation", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() =>
      changePasswordAction(changePasswordForm({ confirmPassword: "nope" }))
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expectNothingTouched();
  });

  it("performs the real write outside a Test Lab session, without creating a session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);

    const result = await run(() => changePasswordAction(changePasswordForm()));
    expect(result).toEqual({ ok: true });
    expect(verifyAccountPassword).toHaveBeenCalledWith("auth-head-1", CURRENT_PASSWORD);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
    expect(revokeOtherSessions).toHaveBeenCalledWith("auth-head-1", "tok-current");
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it("keeps nothing when the current session token is unknown (null keepToken)", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);
    getAuthSession.mockResolvedValueOnce(null);

    await run(() => changePasswordAction(changePasswordForm()));
    expect(revokeOtherSessions).toHaveBeenCalledWith("auth-head-1", null);
  });
});

describe("changeEmailAction — Test Lab dry run", () => {
  it("returns a preview naming the new address and touches nothing in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => changeEmailAction(changeEmailForm()));

    expect(result).toEqual({
      ok: true,
      data: { dryRun: true, preview: { validated: true, changed: false, newEmail: "new@example.test" } },
    });
    expectNothingTouched();
    // Not even the "is this address taken" lookup.
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it("still returns the validation error in a Test Lab session for an unchanged address", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() =>
      changeEmailAction(
        changeEmailForm({ newEmail: HEAD_USER.email, confirmEmail: HEAD_USER.email })
      )
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expectNothingTouched();
  });

  it("performs the real write outside a Test Lab session: identity and User row in one transaction", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);
    userUpdate.mockResolvedValue({});

    const result = await run(() => changeEmailAction(changeEmailForm()));
    expect(result).toEqual({ ok: true });
    expect(verifyAccountPassword).toHaveBeenCalledWith("auth-head-1", CURRENT_PASSWORD);
    expect(setEmail).toHaveBeenCalledWith("auth-head-1", "new@example.test", tx);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "head-1" }, data: { email: "new@example.test" } });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
