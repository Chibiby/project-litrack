import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Impersonation proof lives in the session row (`impersonatedBy`), not in a
 * signed ticket. Ports the still-applicable refusals of the old ticket test:
 * nothing but a real impersonated session reads as an impersonation, and the
 * return-to hint is an allowlist, never a credential.
 */

const ADMIN_AUTH = "admin-auth-id";
const TARGET_AUTH = "target-auth-id";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "litrack_impersonation_return" && cookieValue ? { value: cookieValue } : undefined),
    has: () => false,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/better-auth", () => ({ getAuth: () => ({ api: {} }) }));

type SessionShape = { user: { id: string }; session: { impersonatedBy: string | null } } | null;
let session: SessionShape;
let sessionThrows = false;
vi.mock("@/lib/auth/auth-session", () => ({
  getAuthSession: vi.fn(async () => {
    if (sessionThrows) throw new Error("db down");
    return session;
  }),
}));

let userRows: Array<{ id: string; authId: string }>;
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: vi.fn(async () => userRows), findUnique: vi.fn() } },
}));

async function load() {
  vi.resetModules();
  return import("@/lib/auth/impersonation-session");
}

beforeEach(() => {
  cookieValue = undefined;
  sessionThrows = false;
  session = { user: { id: TARGET_AUTH }, session: { impersonatedBy: ADMIN_AUTH } };
  userRows = [
    { id: "admin-user", authId: ADMIN_AUTH },
    { id: "target-user", authId: TARGET_AUTH },
  ];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readImpersonation", () => {
  it("returns the admin and target of a real impersonated session", async () => {
    const { readImpersonation } = await load();
    expect(await readImpersonation()).toMatchObject({
      adminAuthId: ADMIN_AUTH,
      adminUserId: "admin-user",
      targetUserId: "target-user",
      returnTo: null,
      expired: false,
    });
  });

  it("reads an ordinary session, or no session, as not impersonating", async () => {
    let mod = await load();
    session = { user: { id: TARGET_AUTH }, session: { impersonatedBy: null } };
    expect(await mod.readImpersonation()).toBeNull();

    mod = await load();
    session = null;
    expect(await mod.readImpersonation()).toBeNull();
  });

  it("reads as null, without throwing, when the admin or target row is missing", async () => {
    userRows = [{ id: "target-user", authId: TARGET_AUTH }];
    const { readImpersonation } = await load();
    expect(await readImpersonation()).toBeNull();
  });

  it("reads as null, without throwing, when the session cannot be read", async () => {
    sessionThrows = true;
    const { readImpersonation } = await load();
    await expect(readImpersonation()).resolves.toBeNull();
  });

  it("accepts an allowlisted returnTo and ignores anything else", async () => {
    cookieValue = "test-lab";
    let mod = await load();
    expect((await mod.readImpersonation())?.returnTo).toBe("test-lab");

    cookieValue = "https://evil.example";
    mod = await load();
    expect((await mod.readImpersonation())?.returnTo).toBeNull();
  });
});
