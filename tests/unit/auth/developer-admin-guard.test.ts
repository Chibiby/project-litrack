import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Developer Controls guards. The real `session.ts` runs; only the request
 * edges are faked, as in session-db-retry.test.ts.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests";

vi.mock("next/navigation", () => ({
  redirect: (p: string) => {
    throw new Error(`NEXT_REDIRECT:${p}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "auth-1" } }, error: null }),
      signOut: vi.fn(),
    },
  }),
}));
vi.mock("@/lib/supabase/jwks", () => ({ getSharedJwks: async () => undefined }));

const userFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } },
}));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));

const { requireDeveloperAdmin, requireDeveloperAdminPage } = await import("@/lib/auth/session");

function admin(adminTier: "DEVELOPER" | "DIVISION" | null) {
  return {
    id: "admin-1",
    authId: "auth-1",
    role: "SUPER_ADMIN",
    adminTier,
    schoolId: null,
    deletedAt: null,
    isActive: true,
    approvalStatus: null,
    mustChangePassword: false,
  };
}

beforeEach(() => {
  userFindUnique.mockReset();
});

describe("requireDeveloperAdmin", () => {
  it("lets a Developer Admin through", async () => {
    userFindUnique.mockResolvedValue(admin("DEVELOPER"));
    await expect(requireDeveloperAdmin("the database console")).resolves.toMatchObject({ id: "admin-1" });
  });

  it.each(["DIVISION", null] as const)("refuses a Super Admin whose tier is %s", async (tier) => {
    userFindUnique.mockResolvedValue(admin(tier));
    await expect(requireDeveloperAdmin("the database console")).rejects.toMatchObject({
      code: "AUTH_FORBIDDEN",
    });
  });
});

describe("requireDeveloperAdminPage", () => {
  it("lets a Developer Admin through", async () => {
    userFindUnique.mockResolvedValue(admin("DEVELOPER"));
    await expect(requireDeveloperAdminPage()).resolves.toMatchObject({ id: "admin-1" });
  });

  it("hides the page from a Division Admin with a 404", async () => {
    userFindUnique.mockResolvedValue(admin("DIVISION"));
    await expect(requireDeveloperAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
