import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Super Admin signed in as a district admin ("Sign in as" / Test Lab) must
 * see exactly that district admin's districts on `/district`, never the whole
 * division (docs/specs/district-admin.md I14, I8).
 *
 * `impersonateUser` swaps the Supabase session itself, so on every later
 * request the auth user IS the district admin, while the signed impersonation
 * ticket (naming the Super Admin) sits in its own cookie. This runs the real
 * `getCurrentUser` -> `requireUser` -> `requireAdminScope` chain with the
 * session belonging to the district admin and a ticket present, and pins that
 * the scope comes from the session user's role and assignments — the ticket
 * and the admin it names play no part.
 */

const SA_ID = "sa-1";
const DA_ID = "da-1";
const DA_AUTH_ID = "auth-da-1";

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // The impersonation session: the district admin's own auth user.
      getClaims: async () => ({ data: { claims: { sub: DA_AUTH_ID } }, error: null }),
      signOut: vi.fn(),
    },
  }),
}));

const userFindUnique = vi.fn();
const assignmentFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    districtAdminAssignment: { findMany: (...a: unknown[]) => assignmentFindMany(...a) },
  },
}));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));

// A valid, bound ticket naming the Super Admin as the impersonator.
vi.mock("@/lib/auth/impersonation", () => ({
  clearImpersonationCookie: vi.fn(),
  readImpersonationTicket: async () => ({
    adminAuthId: "auth-sa-1",
    adminUserId: SA_ID,
    targetUserId: DA_ID,
    sessionId: "session-1",
    expiresAt: Date.now() + 60_000,
  }),
}));

const { requireAdminScope } = await import("@/lib/auth/district-scope");

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue({
    id: DA_ID,
    authId: DA_AUTH_ID,
    role: "DISTRICT_ADMIN",
    schoolId: null,
    deletedAt: null,
    isActive: true,
    mustChangePassword: false,
    approvalStatus: null,
  });
  assignmentFindMany.mockResolvedValue([{ district: "Alabel 2" }, { district: "Alabel 1" }]);
});

describe("requireAdminScope inside a Super Admin's district admin session", () => {
  it("yields the district admin's districts, not the division", async () => {
    const { user, scope } = await requireAdminScope();

    expect(user.id).toBe(DA_ID);
    expect(user.role).toBe("DISTRICT_ADMIN");
    expect(scope).toEqual({ kind: "districts", districts: ["Alabel 1", "Alabel 2"] });
    expect(scope.kind).not.toBe("division");
    // Assignments are read for the district admin, never for the impersonator.
    expect(assignmentFindMany).toHaveBeenCalledTimes(1);
    expect(assignmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: DA_ID } })
    );
    expect(userFindUnique).toHaveBeenCalledWith({ where: { authId: DA_AUTH_ID } });
    expect(redirect).not.toHaveBeenCalled();
  });
});
