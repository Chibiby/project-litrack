import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Super Admin sign-in by username.
 *
 * The whole point of this action is that two identifiers are in play and only
 * one of them is a secret-adjacent lookup key: the person types a *username*,
 * but Supabase Auth only authenticates an *email*. So the properties worth
 * pinning down are about the seam between them:
 *
 * - **The email that reaches Supabase comes from the row, never from the form.**
 *   If the typed handle could ever influence the address, the username field
 *   would become a way to attempt a password against an arbitrary account.
 * - **The lookup is scoped to a live Super Admin.** A handle left behind on a
 *   deactivated, soft-deleted, or lower-privileged row must not even reach
 *   Supabase, or a stale username becomes a password oracle.
 * - **Unknown handle and wrong password are indistinguishable.** Otherwise the
 *   field enumerates which usernames exist.
 * - **A failed attempt does not write the typed username into an audit row.**
 *
 * Everything is mocked at the module boundary, matching the other action tests
 * in this directory.
 */

const userFindFirst = vi.fn();
const userFindUnique = vi.fn();
const signInWithPassword = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const redirect = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get findFirst() {
        return userFindFirst;
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
      signOut: vi.fn(),
      getUser: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: () => true,
  SUPABASE_NOT_CONFIGURED_MESSAGE: "not configured",
}));

// `vi.mock` factories are hoisted above the `const`s above, so every reference
// to one has to be deferred behind a getter or a function body.
vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: { LOGIN_DENIED: "LOGIN_DENIED", LOGIN_SUCCESS: "LOGIN_SUCCESS" },
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

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    // The real `redirect` throws to unwind the action; mirroring that keeps the
    // code after it unreachable here too.
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  // The action wrapper calls this first so Next's control flow escapes intact.
  // Mirroring it here is what keeps the redirect assertions below meaningful.
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF4") }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { loginAdmin } from "@/lib/actions/auth";

const ADMIN_ROW = {
  id: "user-1",
  email: "hugosbrandanleesoliza@gmail.com",
  username: "admin",
};

function form(username: string, password: string): FormData {
  const fd = new FormData();
  fd.set("username", username);
  fd.set("password", password);
  return fd;
}

/** Run the action, swallowing the throw that a successful redirect performs. */
async function run(fd: FormData) {
  try {
    return await loginAdmin(fd);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) return { redirected: true };
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
});

describe("loginAdmin", () => {
  it("signs in with the email on the row, never anything from the form", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "user-1",
      role: "SUPER_ADMIN",
      isActive: true,
      deletedAt: null,
    });

    const result = await run(form("admin", "s3cret"));

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "hugosbrandanleesoliza@gmail.com",
      password: "s3cret",
    });
    expect(result).toEqual({ redirected: true });
    expect(redirect).toHaveBeenCalledWith("/admin");
  });

  it("scopes the lookup to a live Super Admin", async () => {
    userFindFirst.mockResolvedValue(null);

    await run(form("admin", "s3cret"));

    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          username: "admin",
          role: "SUPER_ADMIN",
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

  it("never reaches Supabase for an unknown handle", async () => {
    userFindFirst.mockResolvedValue(null);

    const result = await run(form("nobody", "s3cret"));

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      code: "AUTH_INCORRECT_CREDENTIALS",
      error: "Incorrect username or password.",
    });
  });

  it("gives an unknown handle and a wrong password the same message", async () => {
    userFindFirst.mockResolvedValue(null);
    const unknown = await run(form("nobody", "s3cret"));

    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ ok: true });
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });
    const wrongPassword = await run(form("admin", "wrong"));

    expect(unknown).toEqual(wrongPassword);
  });

  it("still names a rate limit for what it is, rather than collapsing it too", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 429, message: "Request rate limit reached" },
    });

    const result = await run(form("admin", "s3cret"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_PROVIDER_RATE_LIMITED" });
  });

  it("does not write the typed username into the audit row for a failed attempt", async () => {
    userFindFirst.mockResolvedValue(null);

    await run(form("some-guessed-handle", "s3cret"));

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const serialised = JSON.stringify(writeAudit.mock.calls[0][0]);
    expect(serialised).not.toContain("some-guessed-handle");
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
});
