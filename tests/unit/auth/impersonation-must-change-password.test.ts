import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `requireUser` and the forced first-sign-in password change during a Super
 * Admin impersonation.
 *
 * The prompt belongs to the real person, so a VERIFIED impersonation of that
 * person (HMAC-signed ticket, bound to this exact live Supabase session,
 * naming this user) skips the `/account/set-password` redirect and lands on
 * the role page — for every role. Anything short of that proof keeps the
 * redirect: no ticket, a forged or tampered ticket, a ticket bound to another
 * session, a ticket naming someone else, or an auth server that cannot answer.
 *
 * The real `session.ts` and the real `impersonation.ts` run here; tickets are
 * signed with the real encoder. Only the request edges (cookies, Supabase,
 * Prisma, redirect) are faked.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-hmac-tests";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_SESSION_ID = "77777777-7777-4777-8777-777777777777";

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));

let ticketCookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "litrack_impersonator" && ticketCookie !== undefined ? { value: ticketCookie } : undefined,
    has: (name: string) => name === "litrack_impersonator" && ticketCookie !== undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

/** What the auth server says about the current request's session. */
let liveSessionId: string | null = SESSION_ID;
let authOutage = false;
const getClaims = vi.fn(async (jwt?: string) =>
  // No token: `getCurrentUser` verifying the cookie session locally, which never
  // asks the auth server and so is unaffected by an outage.
  jwt === undefined
    ? { data: { claims: { sub: "auth-target", session_id: liveSessionId } }, error: null }
    : authOutage
      ? { data: null, error: { status: 503, name: "AuthApiError", message: "down" } }
      : { data: { claims: { session_id: liveSessionId } }, error: null }
);
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // Both `getCurrentUser` (no token) and the binding check (with the
      // session's token) see the impersonated account's live session.
      getUser: async () => ({ data: { user: { id: "auth-target" } }, error: null }),
      getSession: async () => ({
        data: { session: liveSessionId ? { access_token: "access-token" } : null },
        error: null,
      }),
      getClaims,
      signOut: vi.fn(),
    },
  }),
}));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
  },
}));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));

const { requireUser } = await import("@/lib/auth/session");
const { encodeImpersonationTicket } = await import("@/lib/auth/impersonation");

function signedTicket(overrides: Partial<{ targetUserId: string; sessionId: string }> = {}): string {
  return encodeImpersonationTicket({
    adminAuthId: "11111111-1111-4111-8111-111111111111",
    adminUserId: "22222222-2222-4222-8222-222222222222",
    targetUserId: USER_ID,
    sessionId: SESSION_ID,
    ...overrides,
  }).value;
}

function signedIn(role: string) {
  userFindUnique.mockResolvedValue({
    id: USER_ID,
    authId: "auth-target",
    role,
    schoolId: role === "DISTRICT_ADMIN" ? null : "school-1",
    deletedAt: null,
    isActive: true,
    approvalStatus: role === "TEACHER" ? "APPROVED" : null,
    mustChangePassword: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ticketCookie = undefined;
  liveSessionId = SESSION_ID;
  authOutage = false;
});

describe("requireUser — verified impersonation skips the forced password change", () => {
  it.each(["TEACHER", "SCHOOL_HEAD", "DISTRICT_ADMIN"])(
    "lets a Super Admin signed in as a %s reach the role page, flag untouched",
    async (role) => {
      signedIn(role);
      ticketCookie = signedTicket();

      const user = await requireUser(role as "TEACHER");

      expect(user.id).toBe(USER_ID);
      expect(user.mustChangePassword).toBe(true);
      expect(redirect).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
      // The proof was actually asked for, not assumed from the cookie.
      expect(getClaims).toHaveBeenCalled();
    }
  );
});

describe("requireUser — anything short of a verified impersonation keeps the redirect", () => {
  const cases: [string, () => void][] = [
    ["no ticket at all (the real person signing in)", () => {}],
    [
      "a forged ticket that was never signed",
      () => {
        const parts = signedTicket().split(".");
        parts[parts.length - 1] = "not-a-real-signature";
        ticketCookie = parts.join(".");
      },
    ],
    [
      "a signed ticket whose target was swapped after signing",
      () => {
        const parts = signedTicket({ targetUserId: OTHER_USER_ID }).split(".");
        parts[2] = USER_ID;
        ticketCookie = parts.join(".");
      },
    ],
    [
      "a validly signed ticket bound to a different session (the person re-logged in)",
      () => {
        ticketCookie = signedTicket();
        liveSessionId = OTHER_SESSION_ID;
      },
    ],
    [
      "a validly signed, bound ticket naming a different user",
      () => {
        ticketCookie = signedTicket({ targetUserId: OTHER_USER_ID });
      },
    ],
    [
      "a valid ticket when the auth server cannot answer",
      () => {
        ticketCookie = signedTicket();
        authOutage = true;
      },
    ],
  ];

  it.each(cases)("redirects to /account/set-password for %s", async (_label, arrange) => {
    signedIn("DISTRICT_ADMIN");
    arrange();

    await expect(requireUser("DISTRICT_ADMIN")).rejects.toThrow("NEXT_REDIRECT:/account/set-password");
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
