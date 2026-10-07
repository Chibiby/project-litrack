import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provisioning talks to the identity module (Better Auth rows), and the
 * provider's own error text must never reach the browser: it is thrown as
 * AUTH_PROVIDER_ERROR so `action()` classifies it, and the raw message stays in
 * `detail` for the admin record only.
 */

const RAW = "User not allowed: raw provider text";

let createFailure: Error | null;
let setPasswordFailure: Error | null;
let existingIdentity: boolean;

const createIdentity = vi.fn(async (_input: unknown) => {
  if (createFailure) throw createFailure;
  return { authId: "auth-1" };
});
const findIdentityByEmail = vi.fn(async (_email: string) =>
  existingIdentity ? { authId: "auth-1" } : null
);
const setPassword = vi.fn(async (_authId: string, _password: string) => {
  if (setPasswordFailure) throw setPasswordFailure;
});
const setRole = vi.fn(async (_authId: string, _role: string) => {});

vi.mock("@/lib/auth/identity", () => ({
  createIdentity: (input: unknown) => createIdentity(input),
  findIdentityByEmail: (email: string) => findIdentityByEmail(email),
  setPassword: (authId: string, password: string) => setPassword(authId, password),
  setRole: (authId: string, role: string) => setRole(authId, role),
  deleteIdentity: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/synthetic-email", () => ({
  schoolHeadSyntheticEmail: () => "x",
}));
vi.mock("@/lib/demo/teardown", () => ({ deleteSchoolCompletely: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: async () => [] },
    school: { findFirst: async () => null, findMany: async () => [] },
  },
}));

const { provisionDemoTenant } = await import("@/lib/demo/provision");

beforeEach(() => {
  vi.clearAllMocks();
  existingIdentity = false;
  createFailure = null;
  setPasswordFailure = null;
});

describe("provisionDemoTenant — auth provider failures", () => {
  it("throws AUTH_PROVIDER_ERROR instead of returning the provider's raw message (create)", async () => {
    createFailure = new Error(RAW);

    const failure = await provisionDemoTenant("admin-1").then(
      (r) => r,
      (e: unknown) => e
    );

    expect(createIdentity).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ name: "AppError", code: "AUTH_PROVIDER_ERROR" });
    expect((failure as Error).message).not.toContain("raw provider text");
  });

  it("throws AUTH_PROVIDER_ERROR instead of returning the provider's raw message (reuse)", async () => {
    existingIdentity = true;
    setPasswordFailure = new Error(RAW);

    const failure = await provisionDemoTenant("admin-1").then(
      (r) => r,
      (e: unknown) => e
    );

    // An identity left by a half-failed create is reused, never re-created.
    expect(setPassword).toHaveBeenCalledWith("auth-1", expect.any(String));
    expect(createIdentity).not.toHaveBeenCalled();
    expect(failure).toMatchObject({ name: "AppError", code: "AUTH_PROVIDER_ERROR" });
    expect((failure as Error).message).not.toContain("raw provider text");
  });
});
