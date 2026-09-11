import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser-side sign-in's server halves.
 *
 * What is worth pinning here is what the person is told, and what it costs an
 * attacker: a School Head at a school with no head account gets the real reason
 * instead of "contact your administrator"; a teacher at the wrong school gets
 * "no teacher account"; and the per-address throttle is charged only when a
 * lookup fails, but refuses everything — including lookups that would have
 * succeeded — once it is spent.
 */

const schoolFindUnique = vi.fn();
const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const getUser = vi.fn();
const signOut = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();
const reportError = vi.fn((..._args: unknown[]) => "E-TESTREF3");

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findUnique() {
        return schoolFindUnique;
      },
    },
    user: {
      get findUnique() {
        return userFindUnique;
      },
      get findFirst() {
        return userFindFirst;
      },
    },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser, signOut } }),
}));
vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: () => true,
  SUPABASE_NOT_CONFIGURED_MESSAGE: "supabase env missing",
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
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/auth/warm-routes", () => ({
  warmSchoolHeadRoutes: vi.fn(),
  warmTeacherRoutes: vi.fn(),
}));
vi.mock("@/lib/auth/synthetic-email", () => ({
  isSyntheticEmail: (email: string) => email.startsWith("sh@"),
}));

import {
  beginSchoolHeadLogin,
  beginTeacherLogin,
  finishSchoolHeadLogin,
  finishTeacherLogin,
  reportLoginFailure,
} from "@/lib/actions/login";

const SCHOOL = { id: "school-1", isActive: true, deletedAt: null };
const HEAD = { id: "head-1", email: "sh@0001.litrack.local", schoolId: "school-1" };
const TEACHER = {
  id: "teacher-1",
  role: "TEACHER" as const,
  schoolId: "school-1",
  isActive: true,
  deletedAt: null,
  approvalStatus: "APPROVED" as const,
};

const LOOKUP_KEY = "login:lookup-miss:ip:203.0.113.9";

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  schoolFindUnique.mockResolvedValue(SCHOOL);
  userFindFirst.mockResolvedValue(HEAD);
  userFindUnique.mockResolvedValue(TEACHER);
  reportError.mockReturnValue("E-TESTREF3");
});

describe("beginSchoolHeadLogin", () => {
  it("hands the synthetic address to the browser", async () => {
    await expect(beginSchoolHeadLogin("school-1")).resolves.toEqual({
      ok: true,
      mode: "browser",
      email: "sh@0001.litrack.local",
    });
  });

  it("keeps a real address on the server, where it cannot be enumerated", async () => {
    userFindFirst.mockResolvedValue({ ...HEAD, email: "head@deped.gov.ph" });
    await expect(beginSchoolHeadLogin("school-1")).resolves.toEqual({ ok: true, mode: "server" });
  });

  it("says the school has no School Head account instead of blaming the password", async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await beginSchoolHeadLogin("school-1");
    expect(res).toMatchObject({ ok: false, code: "AUTH_NO_SCHOOL_HEAD_ACCOUNT" });
    expect((res as { error: string }).error).toMatch(/division office/i);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("separates a school that is missing from one that is switched off", async () => {
    schoolFindUnique.mockResolvedValue(null);
    expect(await beginSchoolHeadLogin("school-x")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    schoolFindUnique.mockResolvedValue({ ...SCHOOL, isActive: false });
    expect(await beginSchoolHeadLogin("school-1")).toMatchObject({
      ok: false,
      code: "AUTH_SCHOOL_INACTIVE",
    });
  });

  it("says how long to wait when the limiter refuses", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 4 * 60_000 });
    const res = await beginSchoolHeadLogin("school-1");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect((res as { error: string }).error).toBe("Too many attempts. Try again in 4 minutes.");
  });

  it("asks for a school before anything else", async () => {
    expect(await beginSchoolHeadLogin("")).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(schoolFindUnique).not.toHaveBeenCalled();
  });
});

describe("beginTeacherLogin", () => {
  it("hands back the address the teacher typed", async () => {
    await expect(beginTeacherLogin("school-1", " Teacher@School.edu ")).resolves.toEqual({
      ok: true,
      mode: "browser",
      email: "teacher@school.edu",
    });
  });

  it("does not charge the throttle for an account that exists", async () => {
    await beginTeacherLogin("school-1", "teacher@school.edu");
    expect(checkRateLimit).not.toHaveBeenCalledWith(LOOKUP_KEY, expect.anything());
  });

  it("charges the throttle when no account matches", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await beginTeacherLogin("school-1", "guess@school.edu");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TEACHER_NOT_FOUND" });
    expect(checkRateLimit).toHaveBeenCalledWith(LOOKUP_KEY, expect.any(Object));
  });

  it("treats a teacher from another school as no account here", async () => {
    userFindUnique.mockResolvedValue({ ...TEACHER, schoolId: "school-2" });
    expect(await beginTeacherLogin("school-1", "teacher@school.edu")).toMatchObject({
      ok: false,
      code: "AUTH_TEACHER_NOT_FOUND",
    });
  });

  it("refuses every lookup once the address is over the limit — even a real one", async () => {
    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });
    const res = await beginTeacherLogin("school-1", "teacher@school.edu");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("explains a declined or deactivated account before a password is sent", async () => {
    userFindUnique.mockResolvedValue({ ...TEACHER, approvalStatus: "REJECTED" });
    expect(await beginTeacherLogin("school-1", "teacher@school.edu")).toMatchObject({
      ok: false,
      code: "AUTH_REGISTRATION_DECLINED",
    });

    userFindUnique.mockResolvedValue({ ...TEACHER, isActive: false });
    const res = await beginTeacherLogin("school-1", "teacher@school.edu");
    expect(res).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DEACTIVATED" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        metadata: expect.objectContaining({ reason: "deactivated" }),
      })
    );
  });
});

describe("finishTeacherLogin", () => {
  it("admits an approved teacher and records the sign-in", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue(TEACHER);
    await expect(finishTeacherLogin("school-1")).resolves.toEqual({
      ok: true,
      redirectTo: "/teacher",
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN_SUCCESS" })
    );
  });

  it("sends a pending teacher to the waiting page", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue({
      ...TEACHER,
      approvalStatus: "PENDING",
      isActive: false,
    });
    await expect(finishTeacherLogin("school-1")).resolves.toEqual({
      ok: true,
      redirectTo: "/pending-approval",
    });
  });

  it("signs out a session that does not belong to this school", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue({ ...TEACHER, schoolId: "school-2" });
    const res = await finishTeacherLogin("school-1");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TEACHER_NOT_FOUND" });
    expect(signOut).toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          reason: "not_authorized",
          cause: "school_mismatch",
        }),
      })
    );
  });

  it("calls a missing session what it is", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    expect(await finishTeacherLogin("school-1")).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_EXPIRED",
    });
  });
});

describe("finishSchoolHeadLogin", () => {
  it("admits the school's head", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-2" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      isActive: true,
      deletedAt: null,
    });
    await expect(finishSchoolHeadLogin("school-1")).resolves.toEqual({
      ok: true,
      redirectTo: "/school-head",
    });
  });

  it("refuses and signs out a deactivated head", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-2" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      isActive: false,
      deletedAt: null,
    });
    expect(await finishSchoolHeadLogin("school-1")).toMatchObject({
      ok: false,
      code: "AUTH_ACCOUNT_DISABLED",
    });
    expect(signOut).toHaveBeenCalled();
  });
});

describe("reportLoginFailure", () => {
  it("normalizes a reason it does not recognize", async () => {
    await reportLoginFailure({
      schoolId: "school-1",
      role: "SCHOOL_HEAD",
      reason: "whatever-the-client-says",
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: "incorrect_credentials" }),
      })
    );
  });

  it("keeps the new reasons the browser can now tell apart", async () => {
    await reportLoginFailure({
      schoolId: "school-1",
      role: "SCHOOL_HEAD",
      reason: "service_unreachable",
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: "service_unreachable" }),
      })
    );
  });

  it("does not credit a teacher from another school to this one", async () => {
    userFindUnique.mockResolvedValue({ id: "teacher-9", email: "t@x.edu", schoolId: "school-2" });
    await reportLoginFailure({
      schoolId: "school-1",
      role: "TEACHER",
      email: "t@x.edu",
      reason: "incorrect_credentials",
    });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it("records a provider failure for admins, but never as a system alert", async () => {
    await reportLoginFailure({ schoolId: "school-1", role: "TEACHER", reason: "provider_error" });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toMatchObject({ severity: "security" });
  });
});
