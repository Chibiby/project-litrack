import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provisioning talks to Supabase Auth, and Supabase's own error text must never
 * reach the browser: it is thrown as AUTH_PROVIDER_ERROR so `action()` classifies
 * it, and the raw message stays in `detail` for the admin record only.
 */

const RAW = "User not allowed: raw supabase text";

let createUserResult: { data: { user: { id: string } | null }; error: { message: string } | null };
let updateUserResult: { error: { message: string } | null };
let existingAuthUser: boolean;

const supabaseAdmin = {
  auth: {
    admin: {
      listUsers: async () => ({
        data: { users: existingAuthUser ? [{ id: "auth-1", email: "x" }] : [] },
        error: null,
      }),
      createUser: async () => createUserResult,
      updateUserById: async () => updateUserResult,
      deleteUser: async () => ({ error: null }),
    },
  },
};

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => supabaseAdmin }));
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
  existingAuthUser = false;
  createUserResult = { data: { user: { id: "auth-1" } }, error: null };
  updateUserResult = { error: null };
});

describe("provisionDemoTenant — auth provider failures", () => {
  it("throws AUTH_PROVIDER_ERROR instead of returning Supabase's raw message (create)", async () => {
    createUserResult = { data: { user: null }, error: { message: RAW } };

    const failure = await provisionDemoTenant("admin-1").then(
      (r) => r,
      (e: unknown) => e
    );

    expect(failure).toMatchObject({ name: "AppError", code: "AUTH_PROVIDER_ERROR" });
    expect((failure as Error).message).not.toContain("raw supabase text");
  });

  it("throws AUTH_PROVIDER_ERROR instead of returning Supabase's raw message (update)", async () => {
    existingAuthUser = true;
    updateUserResult = { error: { message: RAW } };

    const failure = await provisionDemoTenant("admin-1").then(
      (r) => r,
      (e: unknown) => e
    );

    expect(failure).toMatchObject({ name: "AppError", code: "AUTH_PROVIDER_ERROR" });
    expect((failure as Error).message).not.toContain("raw supabase text");
  });
});
