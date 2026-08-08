import { describe, expect, it } from "vitest";
import { isServiceRoleJwt, readSupabaseJwtRole } from "@/lib/supabase/admin";

function fakeJwt(role: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, ref: "test" })).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("service role JWT checks", () => {
  it("reads role from JWT payload", () => {
    expect(readSupabaseJwtRole(fakeJwt("service_role"))).toBe("service_role");
    expect(readSupabaseJwtRole(fakeJwt("anon"))).toBe("anon");
  });

  it("accepts only service_role JWTs", () => {
    expect(isServiceRoleJwt(fakeJwt("service_role"))).toBe(true);
    expect(isServiceRoleJwt(fakeJwt("anon"))).toBe(false);
    expect(isServiceRoleJwt("not-a-jwt")).toBe(false);
    expect(isServiceRoleJwt("short-placeholder-value")).toBe(false);
  });
});
