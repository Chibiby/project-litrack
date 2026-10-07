import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Super Admin / district admin sign-in by username.
 *
 * Two identifiers are in play and only one of them is a secret-adjacent lookup
 * key: the person types a *username*, but the identity authenticates an
 * *email*. The properties worth pinning are about the seam between them:
 *
 * - **The email that reaches the password check comes from the row, never from
 *   the form.** If the typed handle could ever influence the address, the
 *   username field would become a way to attempt a password against an
 *   arbitrary account.
 * - **The lookup is scoped to a live admin-console account.** A handle left
 *   behind on a deactivated, soft-deleted, or lower-privileged row must not even
 *   reach a password check, or a stale username becomes a password oracle.
 * - **Unknown handle and wrong password are indistinguishable** — same message,
 *   same fields, same minimum time, and an unknown handle still spends a real
 *   bcrypt verify (against `DUMMY_BCRYPT_HASH`) so it is not cheaper to refuse.
 * - **A failed attempt does not write the typed username into an audit row.**
 *
 * Everything is mocked at the module boundary; `signInWithPassword` stands in
 * for Better Auth's `signInEmail` (its own behaviour is covered elsewhere).
 */

const userFindFirst = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const signInWithPassword = vi.fn();
const revokeAllSessions = vi.fn();
const verifyPasswordMock = vi.fn();
const verifyAccountPassword = vi.fn();
const setPassword = vi.fn();
const hashPasswordMock = vi.fn();
const peekResetToken = vi.fn();
const consumeResetToken = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();
const redirect = vi.fn();
const requireUser = vi.fn();
const warmAdminRoutes = vi.fn();
const warmDistrictRoutes = vi.fn();
const recordLastLogin = vi.fn();
const cookieSet = vi.fn();
let requestHeaders: Record<string, string> = {};
let cookieJar: Record<string, string> = {};

const tx = {
  user: {
    get findUnique() {
      return userFindUnique;
    },
    get update() {
      return userUpdate;
    },
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get findFirst() {
        return userFindFirst;
      },
      get findUnique() {
        return userFindUnique;
      },
      get update() {
        return userUpdate;
      },
    },
  },
  prismaFresh: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

vi.mock("@/lib/auth/auth-session", () => ({
  get signInWithPassword() {
    return signInWithPassword;
  },
  get revokeAllSessions() {
    return revokeAllSessions;
  },
  getAuthSession: vi.fn(async () => null),
  endCurrentSession: vi.fn(async () => true),
}));

vi.mock("@/lib/auth/identity", () => ({
  get verifyAccountPassword() {
    return verifyAccountPassword;
  },
  get setPassword() {
    return setPassword;
  },
  createIdentity: vi.fn(),
  findIdentityByEmail: vi.fn(),
  setEmail: vi.fn(),
}));

// The real DUMMY hash constant (the unknown-handle path is asserted against it);
// the real bcrypt functions are replaced so nothing here waits on a hash.
vi.mock("@/lib/auth/password-hash", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/password-hash")>(
    "@/lib/auth/password-hash"
  );
  return {
    DUMMY_BCRYPT_HASH: actual.DUMMY_BCRYPT_HASH,
    get hashPassword() {
      return hashPasswordMock;
    },
    get verifyPassword() {
      return verifyPasswordMock;
    },
  };
});

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
  requireActiveSchool: vi.fn(async (id: string) => ({ id })),
  LOGIN_RATE: { limit: 10, windowMs: 300_000 },
}));

vi.mock("@/lib/auth/lookup-throttle", () => ({
  assertLookupAllowed: vi.fn(async () => undefined),
  recordFailedLookup: vi.fn(async () => undefined),
}));

// `vi.mock` factories are hoisted above the `const`s above, so every reference
// to one has to be deferred behind a getter or a function body.
vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: {
    LOGIN_DENIED: "LOGIN_DENIED",
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
    PASSWORD_CHANGE: "PASSWORD_CHANGE",
  },
}));

vi.mock("@/lib/auth/last-login", () => ({
  get recordLastLogin() {
    return recordLastLogin;
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  get peekRateLimit() {
    return peekRateLimit;
  },
}));

// The real role -> home mapping: where each admin role lands is under test.
vi.mock("@/lib/auth/session", async () => {
  const roles = await vi.importActual<typeof import("@/lib/auth/roles")>("@/lib/auth/roles");
  return {
    requireUser: (...args: unknown[]) => requireUser(...args),
    roleHomePath: roles.roleHomePath,
    roleSecurityPath: roles.roleSecurityPath,
  };
});

vi.mock("@/lib/auth/test-lab", () => ({ readTestLabSession: vi.fn(async () => false) }));

vi.mock("@/lib/auth/warm-routes", () => ({
  warmAdminRoutes: (...args: unknown[]) => warmAdminRoutes(...args),
  warmDistrictRoutes: (...args: unknown[]) => warmDistrictRoutes(...args),
  warmSchoolHeadRoutes: vi.fn(),
  warmTeacherRoutes: vi.fn(),
}));

vi.mock("@/lib/auth/teacher-registration", () => ({ completeTeacherAuthAfterVerify: vi.fn() }));
vi.mock("@/lib/auth/school-head-sign-in", () => ({ findSignInSchoolHead: vi.fn() }));
vi.mock("@/lib/auth/recovery-email", () => ({
  RESET_COOKIE: "litrack_reset",
  RESET_COOKIE_PATH: "/auth",
  sendPasswordRecoveryEmail: vi.fn(),
  hasRecentRecoveryToken: vi.fn(),
}));
vi.mock("@/lib/demo/session", () => ({ clearDemoSessionCookie: vi.fn(async () => undefined) }));

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
    redirect(path);
    // The real `redirect` throws to unwind the action; mirroring that keeps the
    // code after it unreachable here too.
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  // The action wrapper calls this first so Next's control flow escapes intact.
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF4") }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  headers: async () => new Headers(requestHeaders),
  cookies: async () => ({
    get: (name: string) => (name in cookieJar ? { value: cookieJar[name] } : undefined),
    has: (name: string) => name in cookieJar,
    set: (...args: unknown[]) => cookieSet(...args),
    delete: vi.fn(),
  }),
}));

import {
  changePasswordAction,
  completePasswordReset,
  loginAdmin,
  skipPasswordChange,
} from "@/lib/actions/auth";
import { DUMMY_BCRYPT_HASH } from "@/lib/auth/password-hash";

const ADMIN_ROW = {
  id: "user-1",
  email: "hugosbrandanleesoliza@gmail.com",
  role: "SUPER_ADMIN",
  username: "admin",
};

const WRONG_PASSWORD = {
  ok: false,
  code: "AUTH_INCORRECT_PASSWORD",
  error: { name: "APIError", statusCode: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD" } },
};

const SIGNED_IN = { ok: true, authId: "auth-1" };

function form(username: string, password: string): FormData {
  const fd = new FormData();
  fd.set("username", username);
  fd.set("password", password);
  return fd;
}

/**
 * Run the action, swallowing the throw that a successful redirect performs.
 *
 * Timers are fake (see beforeEach), so the failure padding costs no real time:
 * the loop jumps the clock to each timer the action schedules until it settles.
 */
async function run(fd: FormData) {
  let settled = false;
  const pending = (async () => {
    try {
      return await loginAdmin(fd);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
        return { redirected: true };
      }
      throw err;
    } finally {
      settled = true;
    }
  })();
  pending.catch(() => undefined);
  while (!settled) await vi.advanceTimersToNextTimerAsync();
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  requestHeaders = { "x-forwarded-for": "198.51.100.7" };
  cookieJar = {};
  checkRateLimit.mockResolvedValue({ ok: true });
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  // Default: the credentials are rejected.
  signInWithPassword.mockReset();
  signInWithPassword.mockResolvedValue(WRONG_PASSWORD);
  verifyPasswordMock.mockResolvedValue(false);
  hashPasswordMock.mockResolvedValue("$2b$10$hashed");
  revokeAllSessions.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("loginAdmin", () => {
  it("signs in with the email on the row, never anything from the form", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue(SIGNED_IN);
    userFindUnique.mockResolvedValue({
      id: "user-1",
      role: "SUPER_ADMIN",
      isActive: true,
      deletedAt: null,
    });

    const result = await run(form("admin", "s3cret"));

    expect(signInWithPassword).toHaveBeenCalledWith("hugosbrandanleesoliza@gmail.com", "s3cret");
    expect(result).toEqual({ redirected: true });
    expect(redirect).toHaveBeenCalledWith("/admin");
  });

  it("looks the signed-in row up by the identity that actually signed in", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({ ok: true, authId: "auth-xyz" });
    userFindUnique.mockResolvedValue({ id: "user-1", role: "SUPER_ADMIN", isActive: true, deletedAt: null });

    await run(form("admin", "s3cret"));

    expect(userFindUnique).toHaveBeenCalledWith({ where: { authId: "auth-xyz" } });
  });

  it("scopes the lookup to a live Super Admin or district admin", async () => {
    userFindFirst.mockResolvedValue(null);

    await run(form("admin", "s3cret"));

    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          username: "admin",
          role: { in: ["SUPER_ADMIN", "DISTRICT_ADMIN"] },
          isActive: true,
          deletedAt: null,
        },
      })
    );
  });

  it("folds case and surrounding space so the handle matches one stored row", async () => {
    userFindFirst.mockResolvedValue(null);

    await run(form("  ADMIN  ", "s3cret"));

    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ username: "admin" }) })
    );
  });

  it("never reaches the password check for an unknown handle, and spends a real bcrypt verify instead", async () => {
    userFindFirst.mockResolvedValue(null);

    const result = await run(form("nobody", "s3cret"));

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
    expect(verifyPasswordMock).toHaveBeenCalledWith({ hash: DUMMY_BCRYPT_HASH, password: "s3cret" });
    expect(result).toEqual({
      ok: false,
      code: "AUTH_INCORRECT_CREDENTIALS",
      error: "Incorrect username or password.",
      fieldErrors: {
        username: "Incorrect username or password.",
        password: "Incorrect username or password.",
      },
    });
  });

  it("puts the wrong-password message on both inputs, identical to an unknown handle", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue(WRONG_PASSWORD);
    expect(await run(form("admin", "wrong"))).toMatchObject({
      code: "AUTH_INCORRECT_CREDENTIALS",
      fieldErrors: {
        username: "Incorrect username or password.",
        password: "Incorrect username or password.",
      },
    });
  });

  it("gives an unknown handle and a wrong password the same message", async () => {
    userFindFirst.mockResolvedValue(null);
    const unknown = await run(form("nobody", "s3cret"));

    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ ok: true });
    peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue(WRONG_PASSWORD);
    const wrongPassword = await run(form("admin", "wrong"));

    expect(unknown).toEqual(wrongPassword);
  });

  it("still names a rate limit for what it is, rather than collapsing it too", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({
      ok: false,
      code: "AUTH_PROVIDER_RATE_LIMITED",
      error: { name: "APIError", statusCode: 429 },
    });

    const result = await run(form("admin", "s3cret"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_PROVIDER_RATE_LIMITED" });
  });

  it("names an auth outage for what it is, and does not charge the address for it", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({
      ok: false,
      code: "AUTH_PROVIDER_ERROR",
      error: { name: "APIError", statusCode: 500 },
    });

    const result = await run(form("admin", "s3cret"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR" });
    expect(checkRateLimit).not.toHaveBeenCalledWith(
      "login:admin-fail:ip:198.51.100.7",
      expect.anything()
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "provider_error" }) })
    );
  });

  it("does not write the typed username into the audit row for a failed attempt", async () => {
    userFindFirst.mockResolvedValue(null);

    await run(form("some-guessed-handle", "s3cret"));

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const serialised = JSON.stringify(writeAudit.mock.calls[0][0]);
    expect(serialised).not.toContain("some-guessed-handle");
  });

  it("does not write the password into any audit row, success or failure", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    await run(form("admin", "hunter2-secret"));
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("hunter2-secret");
  });

  it("rejects a blank username before hitting the database", async () => {
    const result = await run(form("   ", "s3cret"));

    expect(userFindFirst).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "Username required",
    });
  });

  it("warms the division dashboard for a Super Admin, not the district one", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue(SIGNED_IN);
    userFindUnique.mockResolvedValue({
      id: "user-1",
      role: "SUPER_ADMIN",
      isActive: true,
      deletedAt: null,
    });

    await run(form("admin", "s3cret"));

    expect(warmAdminRoutes).toHaveBeenCalledTimes(1);
    expect(warmDistrictRoutes).not.toHaveBeenCalled();
    expect(recordLastLogin).toHaveBeenCalledWith("user-1");
  });
});

/**
 * District admins sign in on the same form (docs/specs/district-admin.md 3.3,
 * T15). What must hold: they land on `/district`, never `/admin`; a School
 * Head or teacher who happens to have a username still cannot use this form;
 * and a district admin cannot keep the one-time password they were handed.
 */
describe("loginAdmin — district admins", () => {
  const DA_ROW = {
    id: "da-1",
    email: "ferdinand.simon@accounts.litrack.invalid",
    username: "ferdinand.simon",
    role: "DISTRICT_ADMIN",
  };

  /**
   * A tiny users table that honours the lookup's `where`, so a test fails if
   * the role filter is dropped rather than only if its spelling changes.
   */
  function usersTable(rows: Array<{ id: string; email: string; username: string; role: string }>) {
    userFindFirst.mockImplementation(
      async ({ where }: { where: { username: string; role: { in: string[] } } }) =>
        rows.find((r) => r.username === where.username && where.role.in.includes(r.role)) ?? null
    );
  }

  it("redirects a district admin to /district and records their role", async () => {
    usersTable([DA_ROW]);
    signInWithPassword.mockResolvedValue({ ok: true, authId: "auth-da" });
    userFindUnique.mockResolvedValue({
      id: "da-1",
      role: "DISTRICT_ADMIN",
      isActive: true,
      deletedAt: null,
    });

    const result = await run(form("ferdinand.simon", "k7mp-x3qa-9d2r-hn4w"));

    expect(result).toEqual({ redirected: true });
    expect(signInWithPassword).toHaveBeenCalledWith(DA_ROW.email, "k7mp-x3qa-9d2r-hn4w");
    expect(redirect).toHaveBeenCalledWith("/district");
    expect(redirect).not.toHaveBeenCalledWith("/admin");
    expect(warmDistrictRoutes).toHaveBeenCalledTimes(1);
    expect(warmAdminRoutes).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_SUCCESS",
        metadata: { role: "DISTRICT_ADMIN" },
      })
    );
  });

  it("never signs a teacher's own address in, and says the generic thing", async () => {
    usersTable([{ id: "t-1", email: "t@example.com", username: "maria.cruz", role: "TEACHER" }]);

    const result = await run(form("maria.cruz", "s3cret"));

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_INCORRECT_CREDENTIALS",
      error: "Incorrect username or password.",
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        metadata: { role: "ADMIN_CONSOLE", reason: "unknown_username" },
      })
    );
  });

  it("discards the new session and refuses when the signed-in row is not an admin role", async () => {
    // The row changed between the lookup and sign-in: the post-sign-in check is
    // the second gate and must hold on its own.
    usersTable([DA_ROW]);
    signInWithPassword.mockResolvedValue({ ok: true, authId: "auth-t" });
    userFindUnique.mockResolvedValue({
      id: "da-1",
      role: "TEACHER",
      isActive: true,
      deletedAt: null,
    });

    const result = await run(form("ferdinand.simon", "s3cret"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(revokeAllSessions).toHaveBeenCalledWith("auth-t");
    // The session cookies the sign-in just set are expired on the response.
    const expired = cookieSet.mock.calls.filter(([, value, opts]) => value === "" && opts?.maxAge === 0);
    expect(expired.map(([name]) => String(name))).toEqual(
      expect.arrayContaining([expect.stringContaining("session_token"), expect.stringContaining("session_data")])
    );
    expect(redirect).not.toHaveBeenCalled();
    expect(recordLastLogin).not.toHaveBeenCalled();
  });

  it("discards the new session when the signed-in row is deactivated or deleted", async () => {
    usersTable([DA_ROW]);
    signInWithPassword.mockResolvedValue({ ok: true, authId: "auth-da" });

    userFindUnique.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN", isActive: false, deletedAt: null });
    expect(await run(form("ferdinand.simon", "s3cret"))).toMatchObject({ code: "AUTH_FORBIDDEN" });

    userFindUnique.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN", isActive: true, deletedAt: new Date() });
    expect(await run(form("ferdinand.simon", "s3cret"))).toMatchObject({ code: "AUTH_FORBIDDEN" });

    userFindUnique.mockResolvedValue(null);
    expect(await run(form("ferdinand.simon", "s3cret"))).toMatchObject({ code: "AUTH_FORBIDDEN" });

    expect(revokeAllSessions).toHaveBeenCalledTimes(3);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("records a district admin's wrong password under their role", async () => {
    usersTable([DA_ROW]);
    signInWithPassword.mockResolvedValue(WRONG_PASSWORD);

    const result = await run(form("ferdinand.simon", "wrong"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_INCORRECT_CREDENTIALS" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        metadata: expect.objectContaining({ role: "DISTRICT_ADMIN", reason: "incorrect_credentials" }),
      })
    );
  });
});

describe("loginAdmin — per-address failure limit", () => {
  it("refuses with the too-many-attempts error before touching the database", async () => {
    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });

    const result = await run(form("admin", "s3cret"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(peekRateLimit).toHaveBeenCalledWith("login:admin-fail:ip:198.51.100.7", {
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("keys on the Cloudflare address, not a client-supplied x-forwarded-for", async () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "cloudflare");
    requestHeaders = { "cf-connecting-ip": "192.0.2.44", "x-forwarded-for": "6.6.6.6" };
    userFindFirst.mockResolvedValue(null);

    await run(form("nobody", "s3cret"));

    expect(peekRateLimit).toHaveBeenCalledWith(
      "login:admin-fail:ip:192.0.2.44",
      expect.anything()
    );
  });

  it("charges the address for a failure but not for a success", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue(WRONG_PASSWORD);
    await run(form("admin", "wrong"));
    expect(checkRateLimit).toHaveBeenCalledWith(
      "login:admin-fail:ip:198.51.100.7",
      expect.anything()
    );

    checkRateLimit.mockClear();
    signInWithPassword.mockResolvedValue(SIGNED_IN);
    userFindUnique.mockResolvedValue({
      id: "user-1",
      role: "SUPER_ADMIN",
      isActive: true,
      deletedAt: null,
    });
    await run(form("admin", "s3cret"));
    expect(checkRateLimit).not.toHaveBeenCalledWith(
      "login:admin-fail:ip:198.51.100.7",
      expect.anything()
    );
  });

  it("also charges the per-account allowance, keyed on the typed username", async () => {
    userFindFirst.mockResolvedValue(null);
    await run(form("admin", "s3cret"));
    expect(checkRateLimit).toHaveBeenCalledWith("login:admin:admin", expect.anything());
  });

  it("refuses once the per-account allowance is spent, without checking the password", async () => {
    checkRateLimit.mockImplementation(async (key: string) =>
      key === "login:admin:admin" ? { ok: false, retryAfterMs: 120_000 } : { ok: true }
    );
    const result = await run(form("admin", "s3cret"));
    expect(result).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled();
  });
});

describe("loginAdmin — failure timing", () => {
  const FLOOR_MS = 800;

  async function elapsedFor(fd: FormData): Promise<number> {
    const start = Date.now();
    await run(fd);
    return Date.now() - start;
  }

  it("holds an unknown handle to the minimum time", async () => {
    userFindFirst.mockResolvedValue(null);
    expect(await elapsedFor(form("nobody", "s3cret"))).toBeGreaterThanOrEqual(FLOOR_MS);
  });

  it("holds a wrong password to the minimum time", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue(WRONG_PASSWORD);
    expect(await elapsedFor(form("admin", "wrong"))).toBeGreaterThanOrEqual(FLOOR_MS);
  });

  it("holds a not-authorized account to the minimum time", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({ ok: true, authId: "auth-t" });
    userFindUnique.mockResolvedValue({ id: "user-1", role: "TEACHER", isActive: true, deletedAt: null });
    expect(await elapsedFor(form("admin", "s3cret"))).toBeGreaterThanOrEqual(FLOOR_MS);
  });

  it("does not delay a success, a rate-limit refusal, or a validation failure", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue(SIGNED_IN);
    userFindUnique.mockResolvedValue({ id: "user-1", role: "SUPER_ADMIN", isActive: true, deletedAt: null });
    expect(await elapsedFor(form("admin", "s3cret"))).toBeLessThan(FLOOR_MS);

    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1000 });
    expect(await elapsedFor(form("admin", "s3cret"))).toBeLessThan(FLOOR_MS);

    peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
    expect(await elapsedFor(form("   ", "s3cret"))).toBeLessThan(FLOOR_MS);
  });
});

describe("loginAdmin — database failure", () => {
  it("says what it was doing when the database does not answer", async () => {
    userFindFirst.mockRejectedValue(Object.assign(new Error("pool"), { code: "P2024" }));
    const result = await run(form("admin", "s3cret"));
    expect(result).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
    expect((result as { error: string }).error).toMatch(/Couldn't sign you in/);
  });
});

describe("password actions", () => {
  const USER = { id: "u-1", email: "u@x.edu", role: "TEACHER", schoolId: "s-1", authId: "a-1" };
  const pwForm = () => {
    const fd = new FormData();
    fd.set("currentPassword", "old-pass-1");
    fd.set("password", "New-pass-123");
    fd.set("confirmPassword", "New-pass-123");
    return fd;
  };

  it("puts a wrong current password on the currentPassword field and changes nothing", async () => {
    requireUser.mockResolvedValue(USER);
    verifyAccountPassword.mockResolvedValue(false);

    const result = await changePasswordAction(pwForm());

    expect(verifyAccountPassword).toHaveBeenCalledWith("a-1", "old-pass-1");
    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_CURRENT_PASSWORD_INCORRECT",
      fieldErrors: { currentPassword: "Your current password is incorrect." },
    });
    expect(setPassword).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("checks the current password against the stored hash without creating a session", async () => {
    requireUser.mockResolvedValue(USER);
    verifyAccountPassword.mockResolvedValue(true);

    await changePasswordAction(pwForm());

    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  describe("completePasswordReset", () => {
    it("calls a missing reset cookie an expired link", async () => {
      expect(await completePasswordReset(pwForm())).toMatchObject({
        ok: false,
        code: "AUTH_RESET_LINK_EXPIRED",
      });
      expect(consumeResetToken).not.toHaveBeenCalled();
      expect(setPassword).not.toHaveBeenCalled();
    });

    it("calls a cookie whose token is dead an expired link", async () => {
      cookieJar = { litrack_reset: "dead-token" };
      peekResetToken.mockResolvedValue(null);

      expect(await completePasswordReset(pwForm())).toMatchObject({
        ok: false,
        code: "AUTH_RESET_LINK_EXPIRED",
      });
      expect(setPassword).not.toHaveBeenCalled();
      expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it("writes no password and signs nobody in when the token is used up between the check and the save", async () => {
      cookieJar = { litrack_reset: "raced-token" };
      peekResetToken.mockResolvedValue({ authId: "a-1", expiresAt: new Date(Date.now() + 60_000) });
      const { AppError } = await import("@/lib/errors/app-error");
      consumeResetToken.mockRejectedValue(new AppError("AUTH_RESET_LINK_EXPIRED"));

      expect(await completePasswordReset(pwForm())).toMatchObject({
        ok: false,
        code: "AUTH_RESET_LINK_EXPIRED",
      });
      expect(setPassword).not.toHaveBeenCalled();
      expect(signInWithPassword).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
    });
  });
});

describe("skipPasswordChange", () => {
  it("lets a district admin skip for now and sends them to /district", async () => {
    requireUser.mockResolvedValue({
      id: "da-1",
      role: "DISTRICT_ADMIN",
      schoolId: null,
      mustChangePassword: true,
    });

    await expect(skipPasswordChange()).rejects.toThrow("NEXT_REDIRECT:/district");

    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "da-1" }, data: { mustChangePassword: false } })
    );
    expect(redirect).toHaveBeenCalledWith("/district");
  });
});
