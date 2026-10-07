import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `requireUser` and the forced first-sign-in password change during a Super
 * Admin impersonation.
 *
 * The prompt belongs to the real person, so a VERIFIED impersonation of that
 * person (the session row, read fresh, carries `impersonatedBy` and belongs to
 * this user) skips the `/account/set-password` redirect and lands on the role
 * page — for every role. Anything short of that proof keeps the redirect: no
 * impersonation, one the fresh read no longer shows (the cookie cache is stale
 * after "Return to admin"), a session that belongs to someone else, or a read
 * that fails.
 *
 * The real `session.ts` and the real `impersonation-session.ts` run here. Only
 * the request edges (headers/cookies, the Better Auth session read, Prisma,
 * redirect) are faked.
 */

const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "66666666-6666-4666-8666-666666666666";

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));
// Imported by impersonation-session.ts; the unit never calls the plugin.
vi.mock("@/lib/auth/better-auth", () => ({ getAuth: () => ({ api: {} }) }));

type SessionShape = { user: { id: string }; session: { impersonatedBy: string | null } } | null;

/** What the cookie-cached read returns (every ordinary render). */
let cachedSession: SessionShape;
/** What the fresh (database row) read returns; may throw. */
let freshRead: () => SessionShape;
const getAuthSession = vi.fn(async (options?: { fresh?: boolean }) =>
  options?.fresh ? freshRead() : cachedSession
);
vi.mock("@/lib/auth/auth-session", () => ({
  getAuthSession: (o?: { fresh?: boolean }) => getAuthSession(o),
  endCurrentSession: vi.fn(async () => true),
  revokeAllSessions: vi.fn(async () => 0),
}));

let rowAuthIdForUserId = "auth-target";
let appUser: Record<string, unknown>;
const userUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async (args: { where: { id?: string; authId?: string } }) =>
        args.where.authId ? appUser : { authId: rowAuthIdForUserId },
      update: (...a: unknown[]) => userUpdate(...a),
    },
  },
}));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));

const { requireUser } = await import("@/lib/auth/session");

const IMPERSONATED: SessionShape = {
  user: { id: "auth-target" },
  session: { impersonatedBy: "auth-admin" },
};
const PLAIN: SessionShape = { user: { id: "auth-target" }, session: { impersonatedBy: null } };

function signedIn(role: string) {
  appUser = {
    id: USER_ID,
    authId: "auth-target",
    role,
    schoolId: role === "DISTRICT_ADMIN" ? null : "school-1",
    deletedAt: null,
    isActive: true,
    approvalStatus: role === "TEACHER" ? "APPROVED" : null,
    mustChangePassword: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rowAuthIdForUserId = "auth-target";
  cachedSession = IMPERSONATED;
  freshRead = () => IMPERSONATED;
});

describe("requireUser — verified impersonation skips the forced password change", () => {
  it.each(["TEACHER", "SCHOOL_HEAD", "DISTRICT_ADMIN"])(
    "lets a Super Admin signed in as a %s reach the role page, flag untouched",
    async (role) => {
      signedIn(role);

      const user = await requireUser(role as "TEACHER");

      expect(user.id).toBe(USER_ID);
      expect(user.mustChangePassword).toBe(true);
      expect(redirect).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
      // The proof was actually asked for from the session row, not assumed
      // from the cookie cache.
      expect(getAuthSession).toHaveBeenCalledWith({ fresh: true });
    }
  );
});

describe("requireUser — anything short of a verified impersonation keeps the redirect", () => {
  const cases: [string, () => void][] = [
    [
      "no impersonation at all (the real person signing in)",
      () => {
        cachedSession = PLAIN;
        freshRead = () => PLAIN;
      },
    ],
    [
      "an impersonation the cookie cache still shows but the session row no longer has",
      () => {
        cachedSession = IMPERSONATED;
        freshRead = () => PLAIN;
      },
    ],
    ["a session row that no longer exists", () => (freshRead = () => null)],
    [
      "an impersonated session that belongs to a different account",
      () => {
        rowAuthIdForUserId = "auth-someone-else";
      },
    ],
    [
      "a fresh session read that fails",
      () => {
        freshRead = () => {
          throw new Error("database unavailable");
        };
      },
    ],
  ];

  it.each(cases)("redirects to /account/set-password for %s", async (_label, arrange) => {
    signedIn("DISTRICT_ADMIN");
    arrange();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(requireUser("DISTRICT_ADMIN")).rejects.toThrow("NEXT_REDIRECT:/account/set-password");
    expect(userUpdate).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never treats a different user id as the impersonated person", async () => {
    signedIn("TEACHER");
    rowAuthIdForUserId = "auth-target";
    // The check is keyed on the User.id requireUser resolved; a session for
    // OTHER_USER_ID's account must not satisfy it.
    freshRead = () => ({ user: { id: OTHER_USER_ID }, session: { impersonatedBy: "auth-admin" } });
    await expect(requireUser("TEACHER")).rejects.toThrow("NEXT_REDIRECT:/account/set-password");
  });
});
