import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `requestPasswordReset`'s recovery link used to be built from
 * `NEXT_PUBLIC_APP_URL`, which defaults to `http://localhost:3000` — so on
 * any deploy where that env var isn't set, the emailed link pointed at
 * localhost no matter what site the person was actually using.
 *
 * A later change trusted the request's `Origin` header instead, which let a
 * non-browser caller (who controls Origin and x-forwarded-host) mint a genuine
 * recovery link pointing at their own host. The link is now built only from
 * the canonical `NEXT_PUBLIC_APP_URL`; localhost is allowed only outside
 * production. Pinned here so neither regression comes back.
 */

const userFindUnique = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const sendPasswordRecoveryEmail = vi.fn();
const headersMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get findUnique() {
        return userFindUnique;
      },
    },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: {} }),
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
  get sendPasswordRecoveryEmail() {
    return sendPasswordRecoveryEmail;
  },
  hasRecentRecoveryToken: vi.fn(async () => false),
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

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF-ORIGIN") }));

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
  userFindUnique.mockResolvedValue({
    id: "user-1",
    authId: "11111111-1111-1111-1111-111111111111",
    schoolId: "school-1",
    isActive: true,
    deletedAt: null,
  });
});

describe("requestPasswordReset — origin resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ignores a client-supplied Origin/Host and uses NEXT_PUBLIC_APP_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://from-env.example");
    headersMock.mockResolvedValue(
      new Headers({
        origin: "https://evil.example",
        host: "evil.example",
        "x-forwarded-host": "evil.example",
      })
    );

    const result = await requestPasswordReset(form("teacher@example.com"));

    expect(result).toEqual({ ok: true });
    expect(sendPasswordRecoveryEmail).toHaveBeenCalledWith(
      "teacher@example.com",
      "https://from-env.example"
    );
  });

  it("strips trailing slashes from NEXT_PUBLIC_APP_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://from-env.example//");
    headersMock.mockResolvedValue(new Headers());

    await requestPasswordReset(form("teacher@example.com"));

    expect(sendPasswordRecoveryEmail).toHaveBeenCalledWith(
      "teacher@example.com",
      "https://from-env.example"
    );
  });

  it("falls back to localhost outside production when the env var is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    headersMock.mockResolvedValue(new Headers({ origin: "https://evil.example" }));

    await requestPasswordReset(form("teacher@example.com"));

    expect(sendPasswordRecoveryEmail).toHaveBeenCalledWith(
      "teacher@example.com",
      "http://localhost:3000"
    );
  });

  it("uses the canonical fallback in production when the env var is missing, never an attacker origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    headersMock.mockResolvedValue(
      new Headers({ origin: "https://evil.example", host: "evil.example" })
    );

    const result = await requestPasswordReset(form("teacher@example.com"));

    expect(result).toEqual({ ok: true });
    expect(sendPasswordRecoveryEmail).toHaveBeenCalledWith(
      "teacher@example.com",
      "https://arallitrack.com"
    );
  });
});
