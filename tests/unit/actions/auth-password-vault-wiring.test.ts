import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The School Head password vault merge (`src/lib/auth/password-vault.ts`)
 * put `passwordChangeFields(role, newPassword)` behind every place a person
 * sets their own password: `setPasswordAction`, `changePasswordAction`, and
 * `completePasswordReset`. Before this merge those three call sites wrote the
 * literal `{ mustChangePassword: false, passwordIsSchoolId: false }` by hand.
 *
 * This file pins the seam so a future edit that reintroduces the literal, or
 * that passes the wrong role or the wrong password (e.g. `currentPassword`
 * instead of the new one, or a stale `user`/`appUser` object) fails loudly:
 * `passwordChangeFields` is mocked to a sentinel, and `prisma.user.update` is
 * asserted to receive exactly that sentinel and nothing else.
 *
 * Mocking style copied from tests/unit/actions/admin-login.test.ts.
 */

const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const getUser = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const redirect = vi.fn();
const requireUser = vi.fn();
const roleHomePath = vi.fn((..._args: unknown[]) => "/home");
const passwordChangeFields = vi.fn((role: string, plaintext: string) => ({
  __sentinel: true,
  role,
  plaintext,
}));

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
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword,
      updateUser,
      getUser,
      signOut: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: () => true,
  SUPABASE_NOT_CONFIGURED_MESSAGE: "not configured",
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

import {
  setPasswordAction,
  changePasswordAction,
  completePasswordReset,
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

function changePasswordForm(): FormData {
  const fd = new FormData();
  fd.set("currentPassword", CURRENT_PASSWORD);
  fd.set("password", NEW_PASSWORD);
  fd.set("confirmPassword", NEW_PASSWORD);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  roleHomePath.mockImplementation((..._args: unknown[]) => "/home");
});

describe("setPasswordAction — vault wiring", () => {
  it("writes exactly passwordChangeFields(role, newPassword) for a SCHOOL_HEAD", async () => {
    requireUser.mockResolvedValue({
      id: "head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      email: "sh@example.test",
    });
    updateUser.mockResolvedValue({ error: null });

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
});

describe("changePasswordAction — vault wiring", () => {
  it("writes exactly passwordChangeFields(role, NEW password — not currentPassword) for a TEACHER", async () => {
    requireUser.mockResolvedValue({
      id: "teacher-1",
      role: "TEACHER",
      schoolId: "school-1",
      email: "teacher@example.test",
    });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    updateUser.mockResolvedValue({ error: null });

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
});

describe("completePasswordReset — vault wiring", () => {
  it("writes exactly passwordChangeFields(appUser.role, newPassword) for a SCHOOL_HEAD", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-reset-1" } }, error: null });
    updateUser.mockResolvedValue({ error: null });
    userFindUnique.mockResolvedValue({
      id: "head-2",
      role: "SCHOOL_HEAD",
      schoolId: "school-2",
      email: "sh2@example.test",
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
    getUser.mockResolvedValue({ data: { user: { id: "auth-reset-2" } }, error: null });
    updateUser.mockResolvedValue({ error: null });
    userFindUnique.mockResolvedValue({
      id: "teacher-2",
      role: "TEACHER",
      schoolId: "school-3",
      email: "t2@example.test",
    });

    await run(() => completePasswordReset(setPasswordForm()));

    expect(passwordChangeFields).toHaveBeenCalledWith("TEACHER", NEW_PASSWORD);
    const expectedSentinel = passwordChangeFields.mock.results[0].value;
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "teacher-2" },
      data: expectedSentinel,
    });
  });
});
