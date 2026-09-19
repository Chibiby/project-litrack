import { describe, it, expect, beforeAll } from "vitest";

/**
 * The demo session cookie decides who sees the training tenant. Every case
 * below is the difference between "Super Admins only" and "every teacher on the
 * login page", which is the whole reason the old deployment-wide switch was
 * replaced.
 */

// Must be set before the module is imported: the HMAC key is read from env.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-for-hmac";
});

const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

async function mod() {
  return import("@/lib/demo/session");
}

describe("demo session cookie", () => {
  it("round-trips a session it signed itself", async () => {
    const { encodeDemoSession, decodeDemoSession } = await mod();
    const { value, session } = encodeDemoSession(ADMIN_ID);

    expect(decodeDemoSession(value)).toEqual(session);
    expect(session.adminUserId).toBe(ADMIN_ID);
  });

  it("gives the session four hours, not an open end", async () => {
    const { encodeDemoSession } = await mod();
    const now = 1_700_000_000_000;
    const { session } = encodeDemoSession(ADMIN_ID, now);

    expect(session.expiresAt - now).toBe(4 * 60 * 60 * 1000);
  });

  it("rejects a forged cookie that was never signed", async () => {
    const { decodeDemoSession } = await mod();
    const forged = [ADMIN_ID, String(Date.now() + 60_000), "not-a-real-signature"].join(".");

    expect(decodeDemoSession(forged)).toBeNull();
  });

  it("rejects an edited expiry, signature and payload having to agree", async () => {
    const { encodeDemoSession, decodeDemoSession } = await mod();
    const { value } = encodeDemoSession(ADMIN_ID);
    const [adminUserId, , signature] = value.split(".");
    const extended = [adminUserId, String(Date.now() + 10 * 24 * 60 * 60 * 1000), signature].join(
      "."
    );

    expect(decodeDemoSession(extended)).toBeNull();
  });

  it("refuses an expired session rather than rounding it up", async () => {
    const { encodeDemoSession, decodeDemoSession } = await mod();
    const now = 1_700_000_000_000;
    const { value, session } = encodeDemoSession(ADMIN_ID, now);

    expect(decodeDemoSession(value, session.expiresAt - 1)).not.toBeNull();
    expect(decodeDemoSession(value, session.expiresAt)).toBeNull();
    expect(decodeDemoSession(value, session.expiresAt + 1)).toBeNull();
  });

  it("treats a missing cookie as no session", async () => {
    const { decodeDemoSession } = await mod();

    expect(decodeDemoSession(undefined)).toBeNull();
    expect(decodeDemoSession("")).toBeNull();
    // Wrong shape: two parts, or four, is not a cookie this module wrote.
    expect(decodeDemoSession(`${ADMIN_ID}.${Date.now() + 60_000}`)).toBeNull();
    expect(decodeDemoSession(`a.b.c.d`)).toBeNull();
  });
});
