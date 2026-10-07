import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/admin/admin-accounts` lists SUPER_ADMIN accounts and is a Developer
 * Control: a Division Admin gets a 404 (not a redirect, not an empty page), a
 * Developer Admin gets the page. The real `session.ts` guard runs; only the
 * request edges are faked, as in developer-admin-guard.test.ts. The page
 * element tree is built but never rendered, so no data loader runs.
 */

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
vi.mock("@/lib/auth/auth-session", () => ({
  getAuthSession: async () => ({ user: { id: "auth-1" }, session: { impersonatedBy: null } }),
  endCurrentSession: vi.fn(async () => true),
  revokeAllSessions: vi.fn(async () => 0),
}));
// The pages reach Better Auth only through modules mocked here and below.
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({ api: {} }),
  isAuthConfigured: () => true,
}));
vi.mock("@/lib/auth/impersonation-session", () => ({
  expireImpersonationCookies: vi.fn(async () => {}),
  isVerifiedImpersonationOf: vi.fn(async () => false),
}));

const userFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } },
}));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));
vi.mock("@/lib/cache/unstable", () => ({ cachedQuery: (fn: () => unknown) => fn() }));

const { default: AdminAccountsPage } = await import("@/app/admin/admin-accounts/page");
const { default: TeachersPage } = await import("@/app/admin/management/teachers/page");

function admin(adminTier: "DEVELOPER" | "DIVISION" | null) {
  return {
    id: "admin-1",
    authId: "auth-1",
    role: "SUPER_ADMIN",
    adminTier,
    fullName: "Admin Person",
    email: "admin@example.test",
    schoolId: null,
    deletedAt: null,
    isActive: true,
    approvalStatus: null,
    mustChangePassword: false,
  };
}

type Element = { type: (props: unknown) => Promise<unknown>; props: unknown };

/** Runs the page, then the `RoleAccountsPage` element it returns. */
async function renderPage(page: (p: { searchParams: Promise<object> }) => Promise<unknown>) {
  const el = (await page({ searchParams: Promise.resolve({}) })) as Element;
  return el.type(el.props);
}

beforeEach(() => {
  userFindUnique.mockReset();
});

describe("/admin/admin-accounts", () => {
  it.each(["DIVISION", null] as const)("404s for a Super Admin whose tier is %s", async (tier) => {
    userFindUnique.mockResolvedValue(admin(tier));
    await expect(renderPage(AdminAccountsPage)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders for a Developer Admin", async () => {
    userFindUnique.mockResolvedValue(admin("DEVELOPER"));
    await expect(renderPage(AdminAccountsPage)).resolves.toBeDefined();
  });

  it("does not 404 the Management pages for a Division Admin (only this one is Developer-only)", async () => {
    userFindUnique.mockResolvedValue(admin("DIVISION"));
    await expect(renderPage(TeachersPage)).resolves.toBeDefined();
  });
});
