import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test Lab dry-run coverage (docs/test-lab-spec.md, T5) for the four
 * self-bound account saves in `src/lib/actions/auth.ts`:
 * `setPasswordAction`, `skipPasswordChange`, `changePasswordAction`, and
 * `changeEmailAction`.
 *
 * In a Test Lab session (`readTestLabSession(user)` true) each must validate
 * input, return `{ ok: true, data: { dryRun: true, preview } }`, and touch
 * neither Prisma nor Supabase. Outside a Test Lab session, behaviour is the
 * existing real write (pinned in `auth-password-vault-wiring.test.ts`; this
 * file only adds a smoke check that the real path still runs).
 *
 * Mocking style copied from tests/unit/actions/auth-password-vault-wiring.test.ts.
 */

const userUpdate = vi.fn();
const userFindFirst = vi.fn();
const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const adminUpdateUserById = vi.fn();
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
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword,
      updateUser,
      getUser: vi.fn(),
      signOut: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { updateUserById: adminUpdateUserById } },
  }),
}));

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

// No impersonation ticket in this browser: `skipPasswordChange` reads the
// ticket cookie, and the real `cookies()` throws outside a request.
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
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
  role: "SCHOOL_HEAD" as const,
  schoolId: "school-1",
  email: "sh@example.test",
};

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  roleHomePath.mockImplementation((..._args: unknown[]) => "/home");
  readTestLabSession.mockResolvedValue(false);
  userFindFirst.mockResolvedValue(null);
  signInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
  updateUser.mockResolvedValue({ error: null });
  adminUpdateUserById.mockResolvedValue({ error: null });
});

describe("setPasswordAction — Test Lab dry run", () => {
  it("returns a preview and touches neither Prisma nor Supabase in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => setPasswordAction(setPasswordForm()));

    expect(result).toEqual({ ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } });
    expect(updateUser).not.toHaveBeenCalled();
    expect(adminUpdateUserById).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("still returns the validation error in a Test Lab session for a mismatched confirmation", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const fd = new FormData();
    fd.set("password", NEW_PASSWORD);
    fd.set("confirmPassword", "something-else");

    const result = await run(() => setPasswordAction(fd));
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("performs the real write and redirects outside a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);

    const result = await run(() => setPasswordAction(setPasswordForm()));
    expect(result).toEqual({ redirected: "/home" });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("skipPasswordChange — Test Lab dry run", () => {
  it("returns a preview and writes nothing in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => skipPasswordChange());

    expect(result).toEqual({ ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("performs the real write and redirects outside a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);

    const result = await run(() => skipPasswordChange());
    expect(result).toEqual({ redirected: "/home" });
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("changePasswordAction — Test Lab dry run", () => {
  it("returns a preview and touches neither Prisma nor Supabase in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => changePasswordAction(changePasswordForm()));

    expect(result).toEqual({ ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("still returns the validation error in a Test Lab session for a mismatched confirmation", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() =>
      changePasswordAction(changePasswordForm({ confirmPassword: "nope" }))
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("performs the real write outside a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);

    const result = await run(() => changePasswordAction(changePasswordForm()));
    expect(result).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("changeEmailAction — Test Lab dry run", () => {
  it("returns a preview naming the new address and touches neither Prisma nor Supabase in a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(true);

    const result = await run(() => changeEmailAction(changeEmailForm()));

    expect(result).toEqual({
      ok: true,
      data: { dryRun: true, preview: { validated: true, changed: false, newEmail: "new@example.test" } },
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(adminUpdateUserById).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
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
    expect(adminUpdateUserById).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("performs the real write outside a Test Lab session", async () => {
    requireUser.mockResolvedValue(HEAD_USER);
    readTestLabSession.mockResolvedValue(false);
    userUpdate.mockResolvedValue({});

    const result = await run(() => changeEmailAction(changeEmailForm()));
    expect(result).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(adminUpdateUserById).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});
