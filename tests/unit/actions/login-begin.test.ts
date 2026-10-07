import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * School Head and teacher sign-in, now verified entirely on the server.
 *
 * The browser-side `begin*` / `finish*` / `reportLoginFailure` halves (which
 * existed only to dodge the old hosted provider's per-IP limit) are gone;
 * `loginSchoolHead` and `loginTeacher` do the whole job. What is worth pinning
 * is what the person is told, and what it costs an attacker: a School Head at a
 * school with no head account gets the real reason instead of "contact your
 * administrator"; a teacher at the wrong school gets "no teacher account"; the
 * per-address allowance is charged only by a WRONG PASSWORD (never by a success
 * or an outage) and, once spent, refuses everything — including logins that
 * would have succeeded.
 *
 * `signInWithPassword` stands in for Better Auth's `signInEmail`, which has its
 * own coverage; here it returns the same `{ ok }` / `{ ok:false, code }` shape.
 */

const userFindUnique = vi.fn();
const findSignInSchoolHead = vi.fn();
const requireActiveSchool = vi.fn();
const signInWithPassword = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();
const assertLookupAllowed = vi.fn();
const recordFailedLookup = vi.fn();
const recordLastLogin = vi.fn();
const warmSchoolHeadRoutes = vi.fn();
const warmTeacherRoutes = vi.fn();
const redirect = vi.fn();
const reportError = vi.fn((..._args: unknown[]) => "E-TESTREF3");

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get findUnique() {
        return userFindUnique;
      },
    },
  },
  prismaFresh: {},
}));
vi.mock("@/lib/auth/auth-session", () => ({
  get signInWithPassword() {
    return signInWithPassword;
  },
  revokeAllSessions: vi.fn(),
  getAuthSession: vi.fn(async () => null),
  endCurrentSession: vi.fn(async () => true),
}));
vi.mock("@/lib/auth/school-head-sign-in", () => ({
  get findSignInSchoolHead() {
    return findSignInSchoolHead;
  },
}));
vi.mock("@/lib/auth/login-gates", () => ({
  assertAuthConfigured: vi.fn(),
  get requireActiveSchool() {
    return requireActiveSchool;
  },
  LOGIN_RATE: { limit: 10, windowMs: 300_000 },
}));
vi.mock("@/lib/auth/lookup-throttle", () => ({
  get assertLookupAllowed() {
    return assertLookupAllowed;
  },
  get recordFailedLookup() {
    return recordFailedLookup;
  },
}));
vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: { LOGIN_SUCCESS: "LOGIN_SUCCESS", LOGIN_DENIED: "LOGIN_DENIED" },
}));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  get peekRateLimit() {
    return peekRateLimit;
  },
}));
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));
vi.mock("@/lib/auth/last-login", () => ({
  get recordLastLogin() {
    return recordLastLogin;
  },
}));
vi.mock("@/lib/auth/warm-routes", () => ({
  get warmSchoolHeadRoutes() {
    return warmSchoolHeadRoutes;
  },
  get warmTeacherRoutes() {
    return warmTeacherRoutes;
  },
  warmAdminRoutes: vi.fn(),
  warmDistrictRoutes: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(),
  roleHomePath: vi.fn(),
  roleSecurityPath: vi.fn(),
}));
vi.mock("@/lib/auth/test-lab", () => ({ readTestLabSession: vi.fn(async () => false) }));
vi.mock("@/lib/auth/identity", () => ({
  createIdentity: vi.fn(),
  findIdentityByEmail: vi.fn(),
  setEmail: vi.fn(),
  setPassword: vi.fn(),
  verifyAccountPassword: vi.fn(),
}));
vi.mock("@/lib/auth/password-hash", () => ({
  DUMMY_BCRYPT_HASH: "$2b$10$dummy",
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/auth/password-reset", () => ({ consumeResetToken: vi.fn(), peekResetToken: vi.fn() }));
vi.mock("@/lib/auth/impersonation-session", () => ({
  readImpersonation: vi.fn(async () => null),
  isVerifiedImpersonationOf: vi.fn(async () => false),
  expireImpersonationCookies: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/recovery-email", () => ({
  RESET_COOKIE: "litrack_reset",
  RESET_COOKIE_PATH: "/auth",
  sendPasswordRecoveryEmail: vi.fn(),
  hasRecentRecoveryToken: vi.fn(),
}));
vi.mock("@/lib/auth/teacher-registration", () => ({ completeTeacherAuthAfterVerify: vi.fn() }));
vi.mock("@/lib/demo/session", () => ({ clearDemoSessionCookie: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/synthetic-email", () => ({
  isSyntheticEmail: (email: string) => email.startsWith("sh@"),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({ get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { loginSchoolHead, loginTeacher } from "@/lib/actions/auth";
import { AppError, resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";

const SCHOOL_ID = "school-1";
const HEAD = { id: "head-1", authId: "auth-head", email: "sh@0001.litrack.local", schoolId: SCHOOL_ID };
const TEACHER = {
  id: "teacher-1",
  role: "TEACHER" as const,
  schoolId: SCHOOL_ID,
  isActive: true,
  deletedAt: null,
  approvalStatus: "APPROVED" as const,
};

const IP_KEY = "login:school-fail:ip:203.0.113.9";
const WRONG_PASSWORD = {
  ok: false,
  code: "AUTH_INCORRECT_PASSWORD",
  error: { name: "APIError", statusCode: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD" } },
};

function headForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("schoolId", SCHOOL_ID);
  fd.set("password", "123456");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function teacherForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("schoolId", SCHOOL_ID);
  fd.set("email", " Teacher@School.edu ");
  fd.set("password", "hunter22");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

/** Run an action that ends in `redirect()`, resolving to where it went. */
async function run(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
      return { redirected: err.message.slice("NEXT_REDIRECT:".length) };
    }
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  assertLookupAllowed.mockResolvedValue(undefined);
  recordFailedLookup.mockResolvedValue(undefined);
  requireActiveSchool.mockImplementation(async (id: string) => ({ id }));
  findSignInSchoolHead.mockResolvedValue(HEAD);
  userFindUnique.mockResolvedValue(TEACHER);
  signInWithPassword.mockResolvedValue({ ok: true, authId: "auth-1" });
  reportError.mockReturnValue("E-TESTREF3");
});

describe("loginSchoolHead", () => {
  it("signs in with the head account's stored email and sends them to the dashboard", async () => {
    const result = await run(() => loginSchoolHead(headForm()));

    expect(signInWithPassword).toHaveBeenCalledWith("sh@0001.litrack.local", "123456");
    expect(result).toEqual({ redirected: "/school-head" });
    expect(warmSchoolHeadRoutes).toHaveBeenCalledWith(SCHOOL_ID);
  });

  it("uses a real address the same way, so changing a head's email keeps sign-in working", async () => {
    findSignInSchoolHead.mockResolvedValue({ ...HEAD, email: "head@deped.gov.ph" });
    await run(() => loginSchoolHead(headForm()));
    expect(signInWithPassword).toHaveBeenCalledWith("head@deped.gov.ph", "123456");
  });

  it("records the success, the last sign-in, and never the password", async () => {
    await run(() => loginSchoolHead(headForm({ password: "my-secret-pw" })));

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN_SUCCESS", userId: "head-1", schoolId: SCHOOL_ID })
    );
    expect(recordLastLogin).toHaveBeenCalledWith("head-1");
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("my-secret-pw");
  });

  it("does not charge the address for a success", async () => {
    await run(() => loginSchoolHead(headForm()));
    expect(checkRateLimit).not.toHaveBeenCalledWith(IP_KEY, expect.anything());
  });

  it("says the school has no School Head account instead of blaming the password", async () => {
    findSignInSchoolHead.mockResolvedValue(null);
    const res = (await run(() => loginSchoolHead(headForm()))) as { ok: false; code: string; error: string };

    expect(res).toMatchObject({ ok: false, code: "AUTH_NO_SCHOOL_HEAD_ACCOUNT" });
    expect(res.error).toMatch(/division office/i);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("separates a school that is missing from one that is switched off, and never tries a password", async () => {
    requireActiveSchool.mockRejectedValue(resourceNotFound("School"));
    expect(await run(() => loginSchoolHead(headForm({ schoolId: "school-x" })))).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });

    requireActiveSchool.mockRejectedValue(new AppError("AUTH_SCHOOL_INACTIVE"));
    expect(await run(() => loginSchoolHead(headForm()))).toMatchObject({
      ok: false,
      code: "AUTH_SCHOOL_INACTIVE",
    });
    expect(findSignInSchoolHead).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("says how long to wait when the per-school limiter refuses", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 4 * 60_000 });
    const res = (await run(() => loginSchoolHead(headForm()))) as { code: string; error: string };

    expect(res).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(res.error).toBe("Too many attempts. Try again in 4 minutes.");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("asks for a school and a password before anything else", async () => {
    expect(await run(() => loginSchoolHead(headForm({ schoolId: "" })))).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await run(() => loginSchoolHead(headForm({ password: "" })))).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(requireActiveSchool).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("refuses everything once the address has spent its failed-sign-in budget — even a correct password", async () => {
    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });

    const res = await run(() => loginSchoolHead(headForm()));

    expect(res).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(peekRateLimit).toHaveBeenCalledWith(IP_KEY, { limit: 20, windowMs: 15 * 60 * 1000 });
    expect(findSignInSchoolHead).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("puts a wrong password on the password field, charges the address, and audits the denial", async () => {
    signInWithPassword.mockResolvedValue(WRONG_PASSWORD);

    const res = (await run(() => loginSchoolHead(headForm()))) as {
      ok: false;
      code: string;
      error: string;
      fieldErrors?: Record<string, string>;
    };

    expect(res).toMatchObject({ ok: false, code: "AUTH_INCORRECT_PASSWORD" });
    expect(res.fieldErrors).toEqual({ password: res.error });
    expect(checkRateLimit).toHaveBeenCalledWith(IP_KEY, { limit: 20, windowMs: 15 * 60 * 1000 });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        userId: "head-1",
        metadata: expect.objectContaining({ role: "SCHOOL_HEAD", reason: "incorrect_credentials" }),
      })
    );
    expect(recordLastLogin).not.toHaveBeenCalled();
    expect(warmSchoolHeadRoutes).not.toHaveBeenCalled();
  });

  it("does not charge the address when the auth service is what failed", async () => {
    signInWithPassword.mockResolvedValue({
      ok: false,
      code: "AUTH_PROVIDER_ERROR",
      error: { name: "APIError", statusCode: 500 },
    });

    const res = (await run(() => loginSchoolHead(headForm()))) as { code: string; fieldErrors?: unknown };

    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR" });
    expect(res.fieldErrors).toBeUndefined();
    expect(checkRateLimit).not.toHaveBeenCalledWith(IP_KEY, expect.anything());
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "provider_error" }) })
    );
  });

  it("names a deactivated account without calling it a wrong password", async () => {
    signInWithPassword.mockResolvedValue({
      ok: false,
      code: "AUTH_ACCOUNT_DISABLED",
      error: { name: "APIError", statusCode: 403, body: { code: "BANNED_USER" } },
    });
    expect(await run(() => loginSchoolHead(headForm()))).toMatchObject({
      ok: false,
      code: "AUTH_ACCOUNT_DISABLED",
    });
    expect(checkRateLimit).not.toHaveBeenCalledWith(IP_KEY, expect.anything());
  });

  it("says what it was doing when the database does not answer", async () => {
    findSignInSchoolHead.mockRejectedValue(Object.assign(new Error("pool"), { code: "P2024" }));
    const res = (await run(() => loginSchoolHead(headForm()))) as { code: string; error: string };
    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
    expect(res.error).toMatch(/Couldn't sign you in/);
  });
});

describe("loginTeacher", () => {
  it("signs in with the address the teacher typed, trimmed and lowercased, and goes to /teacher", async () => {
    const result = await run(() => loginTeacher(teacherForm()));

    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "teacher@school.edu" } })
    );
    expect(signInWithPassword).toHaveBeenCalledWith("teacher@school.edu", "hunter22");
    expect(result).toEqual({ redirected: "/teacher" });
    expect(warmTeacherRoutes).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      teacherId: "teacher-1",
      isSuperAdmin: false,
    });
  });

  it("records the success with the method, and the last sign-in", async () => {
    await run(() => loginTeacher(teacherForm()));

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_SUCCESS",
        userId: "teacher-1",
        metadata: { role: "TEACHER", schoolId: SCHOOL_ID, method: "password" },
      })
    );
    expect(recordLastLogin).toHaveBeenCalledWith("teacher-1");
  });

  it("does not charge the lookup throttle for an account that exists", async () => {
    await run(() => loginTeacher(teacherForm()));
    expect(recordFailedLookup).not.toHaveBeenCalled();
  });

  it("charges the lookup throttle when no account matches", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await run(() => loginTeacher(teacherForm({ email: "guess@school.edu" })));

    expect(res).toMatchObject({ ok: false, code: "AUTH_TEACHER_NOT_FOUND" });
    expect(recordFailedLookup).toHaveBeenCalledTimes(1);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("puts the no-account message on the email field and never echoes the address", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = (await run(() => loginTeacher(teacherForm({ email: "guess@school.edu" })))) as {
      error: string;
      fieldErrors?: Record<string, string>;
    };

    expect(res.fieldErrors).toEqual({ email: res.error });
    expect(JSON.stringify(res)).not.toContain("guess@school.edu");
  });

  it("treats a teacher from another school, a soft-deleted one, and a non-teacher as no account here", async () => {
    for (const row of [
      { ...TEACHER, schoolId: "school-2" },
      { ...TEACHER, deletedAt: new Date() },
      { ...TEACHER, role: "SCHOOL_HEAD" as const },
    ]) {
      userFindUnique.mockResolvedValue(row);
      expect(await run(() => loginTeacher(teacherForm()))).toMatchObject({
        ok: false,
        code: "AUTH_TEACHER_NOT_FOUND",
      });
    }
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(recordFailedLookup).toHaveBeenCalledTimes(3);
  });

  it("refuses every lookup once the address is over the lookup limit — even a real one", async () => {
    assertLookupAllowed.mockRejectedValue(tooManyAttempts(60_000));

    const res = await run(() => loginTeacher(teacherForm()));

    expect(res).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("refuses everything once the address has spent its failed-password budget", async () => {
    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });

    expect(await run(() => loginTeacher(teacherForm()))).toMatchObject({
      ok: false,
      code: "AUTH_TOO_MANY_ATTEMPTS",
    });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("explains a declined account before a password is tried", async () => {
    userFindUnique.mockResolvedValue({ ...TEACHER, approvalStatus: "REJECTED" });

    expect(await run(() => loginTeacher(teacherForm()))).toMatchObject({
      ok: false,
      code: "AUTH_REGISTRATION_DECLINED",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("explains a deactivated account before a password is tried, and audits it", async () => {
    userFindUnique.mockResolvedValue({ ...TEACHER, isActive: false });

    expect(await run(() => loginTeacher(teacherForm()))).toMatchObject({
      ok: false,
      code: "AUTH_ACCOUNT_DEACTIVATED",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        metadata: expect.objectContaining({ reason: "deactivated" }),
      })
    );
  });

  it("sends a pending teacher to the waiting page and does not warm the app shell", async () => {
    userFindUnique.mockResolvedValue({ ...TEACHER, approvalStatus: "PENDING", isActive: false });

    expect(await run(() => loginTeacher(teacherForm()))).toEqual({ redirected: "/pending-approval" });
    expect(warmTeacherRoutes).not.toHaveBeenCalled();
    expect(recordLastLogin).toHaveBeenCalledWith("teacher-1");
  });

  it("puts a wrong password on the password field, charges the address, and audits the denial", async () => {
    signInWithPassword.mockResolvedValue(WRONG_PASSWORD);

    const res = (await run(() => loginTeacher(teacherForm()))) as {
      code: string;
      error: string;
      fieldErrors?: Record<string, string>;
    };

    expect(res).toMatchObject({ ok: false, code: "AUTH_INCORRECT_PASSWORD" });
    expect(res.fieldErrors).toEqual({ password: res.error });
    expect(checkRateLimit).toHaveBeenCalledWith(IP_KEY, { limit: 20, windowMs: 15 * 60 * 1000 });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        userId: "teacher-1",
        metadata: expect.objectContaining({ role: "TEACHER", reason: "incorrect_credentials" }),
      })
    );
    expect(recordLastLogin).not.toHaveBeenCalled();
  });

  it("does not charge the address, and shows no field error, when the auth service is rate limited", async () => {
    signInWithPassword.mockResolvedValue({
      ok: false,
      code: "AUTH_PROVIDER_RATE_LIMITED",
      error: { name: "APIError", statusCode: 429 },
    });

    const res = (await run(() => loginTeacher(teacherForm()))) as { code: string; fieldErrors?: unknown };

    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_RATE_LIMITED" });
    expect(res.fieldErrors).toBeUndefined();
    expect(checkRateLimit).not.toHaveBeenCalledWith(IP_KEY, expect.anything());
  });

  it("charges the per-school-per-address allowance before looking anything up", async () => {
    await run(() => loginTeacher(teacherForm()));
    expect(checkRateLimit).toHaveBeenCalledWith(
      `login:teacher:${SCHOOL_ID}:teacher@school.edu`,
      expect.any(Object)
    );
  });

  it("rejects a malformed address or a blank password before any lookup", async () => {
    expect(await run(() => loginTeacher(teacherForm({ email: "not-an-email" })))).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await run(() => loginTeacher(teacherForm({ password: "" })))).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("says what it was doing when the database does not answer", async () => {
    userFindUnique.mockRejectedValue(Object.assign(new Error("pool"), { code: "P2024" }));
    const res = (await run(() => loginTeacher(teacherForm()))) as { code: string; error: string };
    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
    expect(res.error).toMatch(/Couldn't sign you in/);
  });
});
