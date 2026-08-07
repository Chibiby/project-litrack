import { describe, expect, it } from "vitest";
import { resolvePooledDatabaseUrl } from "@/lib/db-url";

/** Same password encoding used in scripts/check-pooler-url.mjs */
const PW = "p%40ss-w0rd%21";

describe("resolvePooledDatabaseUrl", () => {
  it("adds pgbouncer=true and connection_limit=3 on bare 6543 pooler URLs", () => {
    const input = `postgresql://postgres.okmqgbnxdgdqhqjrkuqn:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;
    const out = resolvePooledDatabaseUrl(input);
    expect(out).toContain("pgbouncer=true");
    expect(out).toContain("connection_limit=3");
    expect(out).toContain(PW);
    expect(out!.split("pgbouncer=true").length - 1).toBe(1);
  });

  it("preserves existing query params on 6543 URLs", () => {
    const input = `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require`;
    const out = resolvePooledDatabaseUrl(input)!;
    expect(out).toContain("sslmode=require");
    expect(out).toContain("pgbouncer=true");
    expect(out).toContain("connection_limit=3");
    expect(out).toContain(PW);
  });

  it("raises legacy connection_limit=1 to 3 while keeping pgbouncer", () => {
    const input = `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`;
    const out = resolvePooledDatabaseUrl(input)!;
    expect(out).toContain("pgbouncer=true");
    expect(out).toContain("connection_limit=3");
    expect(out).not.toContain("connection_limit=1");
    expect(out.split("pgbouncer=true").length - 1).toBe(1);
  });

  it("preserves an explicit connection_limit above 1", () => {
    const input = `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5`;
    const out = resolvePooledDatabaseUrl(input)!;
    expect(out).toContain("connection_limit=5");
  });

  it("adds only missing connection_limit when pgbouncer already set", () => {
    const input = `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;
    const out = resolvePooledDatabaseUrl(input)!;
    expect(out).toContain("pgbouncer=true");
    expect(out).toContain("connection_limit=3");
    expect(out.split("pgbouncer=true").length - 1).toBe(1);
  });

  it("does not modify non-6543 URLs", () => {
    const cases = [
      `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres:${PW}@db.okmqgbnxdgdqhqjrkuqn.supabase.co:5432/postgres`,
      `postgresql://postgres:${PW}@db.example.supabase.co/postgres`,
    ];
    for (const input of cases) {
      expect(resolvePooledDatabaseUrl(input)).toBe(input);
    }
  });

  it("passes through undefined, empty string, and garbage", () => {
    expect(resolvePooledDatabaseUrl(undefined)).toBeUndefined();
    expect(resolvePooledDatabaseUrl("")).toBe("");
    expect(resolvePooledDatabaseUrl("not-a-url")).toBe("not-a-url");
  });
});
