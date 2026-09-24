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
const userUpdate = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const redirect = vi.fn();
const requireUser = vi.fn();
const warmAdminRoutes = vi.fn();
const warmDistrictRoutes = vi.fn();

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
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword,
      get signOut() {
        return signOut;
      },
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

// The real role → home mapping: where each admin role lands is under test.
vi.mock("@/lib/auth/session", async () => {
  const roles = await vi.importActual<typeof import("@/lib/auth/roles")>("@/lib/auth/roles");
  return {
    requireUser: (...args: unknown[]) => requireUser(...args),
    roleHomePath: roles.roleHomePath,
    roleSecurityPath: roles.roleSecurityPath,
  };
});

vi.mock("@/lib/auth/warm-routes", () => ({
  warmAdminRoutes: (...args: unknown[]) => warmAdminRoutes(...args),
  warmDistrictRoutes: (...args: unknown[]) => warmDistrictRoutes(...args),
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

import { loginAdmin, skipPasswordChange } from "@/lib/actions/auth";

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

  it("warms the division dashboard for a Super Admin, not the district one", async () => {
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "user-1",
      role: "SUPER_ADMIN",
      isActive: true,
      deletedAt: null,
    });

    await run(form("admin", "s3cret"));

    expect(warmAdminRoutes).toHaveBeenCalledTimes(1);
    expect(warmDistrictRoutes).not.toHaveBeenCalled();
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
    signInWithPassword.mockResolvedValue({ data: { user: { id: "auth-da" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "da-1",
      role: "DISTRICT_ADMIN",
      isActive: true,
      deletedAt: null,
    });

    const result = await run(form("ferdinand.simon", "k7mp-x3qa-9d2r-hn4w"));

    expect(result).toEqual({ redirected: true });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: DA_ROW.email,
      password: "k7mp-x3qa-9d2r-hn4w",
    });
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

  it("never reaches Supabase for a teacher's username, and says the generic thing", async () => {
    usersTable([{ id: "t-1", email: "t@example.com", username: "maria.cruz", role: "TEACHER" }]);

    const result = await run(form("maria.cruz", "s3cret"));

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(result).toEqual({
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

  it("signs out and refuses when the signed-in row is not an admin role", async () => {
    // The row changed between the lookup and sign-in: the post-sign-in check is
    // the second gate and must hold on its own.
    usersTable([DA_ROW]);
    signInWithPassword.mockResolvedValue({ data: { user: { id: "auth-t" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "da-1",
      role: "TEACHER",
      isActive: true,
      deletedAt: null,
    });

    const result = await run(form("ferdinand.simon", "s3cret"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("records a district admin's wrong password under their role", async () => {
    usersTable([DA_ROW]);
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });

    const result = await run(form("ferdinand.simon", "wrong"));

    expect(result).toMatchObject({ ok: false, code: "AUTH_INCORRECT_CREDENTIALS" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN_DENIED",
        metadata: expect.objectContaining({ role: "DISTRICT_ADMIN" }),
      })
    );
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
