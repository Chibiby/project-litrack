import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `skipPasswordChange` during a Super Admin impersonation.
 *
 * `mustChangePassword` is the real person's first-sign-in prompt. An admin
 * signed in as them must never clear it: a verified impersonation is sent to
 * the role home with no write and no audit row, and a signed ticket for this
 * account whose session binding cannot be proven is refused outright. With no
 * ticket in play the ordinary skip (the account holder's own choice) still
 * writes.
 *
 * The real `impersonation.ts` runs, with tickets signed by the real encoder;
 * only the request edges are faked.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-hmac-tests";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_SESSION_ID = "77777777-7777-4777-8777-777777777777";

const userUpdate = vi.fn();
const writeAudit = vi.fn();
const requireUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get update() {
        return userUpdate;
      },
    },
  },
}));

let ticketCookie: string | undefined;
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  cookies: async () => ({
    get: (name: string) =>
      name === "litrack_impersonator" && ticketCookie !== undefined ? { value: ticketCookie } : undefined,
    has: (name: string) => name === "litrack_impersonator" && ticketCookie !== undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

let liveSessionId: string = SESSION_ID;
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "access-token" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "auth-target" } }, error: null }),
      getClaims: async () => ({ data: { claims: { session_id: liveSessionId } }, error: null }),
      signOut: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/env")>()),
  isSupabaseConfigured: () => true,
  SUPABASE_NOT_CONFIGURED_MESSAGE: "not configured",
}));
vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: { PASSWORD_CHANGE: "PASSWORD_CHANGE" },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));
vi.mock("@/lib/auth/session", async () => {
  const roles = await vi.importActual<typeof import("@/lib/auth/roles")>("@/lib/auth/roles");
  return {
    requireUser: (...args: unknown[]) => requireUser(...args),
    roleHomePath: roles.roleHomePath,
    roleSecurityPath: roles.roleSecurityPath,
  };
});
// Real accounts, not demo: never a Test Lab dry-run session.
vi.mock("@/lib/auth/test-lab", () => ({ readTestLabSession: vi.fn(async () => false) }));
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
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF-SKIP") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { skipPasswordChange } = await import("@/lib/actions/auth");
const { encodeImpersonationTicket } = await import("@/lib/auth/impersonation");

function signedTicket(): string {
  return encodeImpersonationTicket({
    adminAuthId: "11111111-1111-4111-8111-111111111111",
    adminUserId: "22222222-2222-4222-8222-222222222222",
    targetUserId: USER_ID,
    sessionId: SESSION_ID,
  }).value;
}

async function run(): Promise<unknown> {
  try {
    return await skipPasswordChange();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
      return { redirected: err.message.slice("NEXT_REDIRECT:".length) };
    }
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  ticketCookie = undefined;
  liveSessionId = SESSION_ID;
});

describe("skipPasswordChange while a Super Admin is signed in as the account", () => {
  it.each([
    ["DISTRICT_ADMIN", "/district"],
    ["SCHOOL_HEAD", "/school-head"],
  ])("a verified impersonation of a %s goes to %s without clearing the flag", async (role, home) => {
    requireUser.mockResolvedValue({ id: USER_ID, role, schoolId: null, mustChangePassword: true });
    ticketCookie = signedTicket();

    expect(await run()).toEqual({ redirected: home });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses when this account's ticket is present but bound to a different session", async () => {
    requireUser.mockResolvedValue({ id: USER_ID, role: "DISTRICT_ADMIN", schoolId: null, mustChangePassword: true });
    ticketCookie = signedTicket();
    liveSessionId = OTHER_SESSION_ID;

    expect(await run()).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("still lets the real account holder skip when no ticket is in play (control)", async () => {
    requireUser.mockResolvedValue({ id: USER_ID, role: "DISTRICT_ADMIN", schoolId: null, mustChangePassword: true });

    expect(await run()).toEqual({ redirected: "/district" });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID }, data: { mustChangePassword: false } })
    );
  });

  it("ignores a forged ticket: it proves nothing, so it is the real holder's own skip", async () => {
    requireUser.mockResolvedValue({ id: USER_ID, role: "DISTRICT_ADMIN", schoolId: null, mustChangePassword: true });
    const parts = signedTicket().split(".");
    parts[parts.length - 1] = "not-a-real-signature";
    ticketCookie = parts.join(".");

    expect(await run()).toEqual({ redirected: "/district" });
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});
