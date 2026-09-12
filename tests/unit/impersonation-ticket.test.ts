import crypto from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * The impersonation ticket is the sole authority `endImpersonation` uses to
 * decide who gets signed back in as SUPER_ADMIN. Every case below is a
 * privilege escalation if it ever starts returning a ticket.
 */

// Must be set before the module is imported: the HMAC key is read from env.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-for-hmac";
});

const ADMIN = {
  adminAuthId: "11111111-1111-4111-8111-111111111111",
  adminUserId: "22222222-2222-4222-8222-222222222222",
  targetUserId: "33333333-3333-4333-8333-333333333333",
  sessionId: "44444444-4444-4444-8444-444444444444",
};

async function mod() {
  return import("@/lib/auth/impersonation");
}

describe("impersonation ticket", () => {
  it("round-trips a ticket it signed itself", async () => {
    const { encodeImpersonationTicket, decodeImpersonationTicket } = await mod();
    const { value } = encodeImpersonationTicket(ADMIN);

    expect(decodeImpersonationTicket(value)).toMatchObject(ADMIN);
  });

  it("rejects a forged ticket that was never signed", async () => {
    const { decodeImpersonationTicket } = await mod();
    const forged = [
      ADMIN.adminAuthId,
      ADMIN.adminUserId,
      ADMIN.targetUserId,
      ADMIN.sessionId,
      String(Date.now() + 60_000),
      "not-a-real-signature",
    ].join(".");

    expect(decodeImpersonationTicket(forged)).toBeNull();
  });

  it("rejects a ticket whose admin id was swapped after signing", async () => {
    const { encodeImpersonationTicket, decodeImpersonationTicket } = await mod();
    const { value } = encodeImpersonationTicket(ADMIN);

    // Keep the valid signature, point it at a different admin.
    const parts = value.split(".");
    parts[1] = "99999999-9999-4999-8999-999999999999";

    expect(decodeImpersonationTicket(parts.join("."))).toBeNull();
  });

  it("rejects a ticket whose bound session id was swapped after signing", async () => {
    const { encodeImpersonationTicket, decodeImpersonationTicket } = await mod();
    const { value } = encodeImpersonationTicket(ADMIN);

    // Re-pointing the binding at the caller's own session is the whole attack
    // the session id exists to stop, so it must be covered by the signature.
    const parts = value.split(".");
    parts[3] = "55555555-5555-4555-8555-555555555555";

    expect(decodeImpersonationTicket(parts.join("."))).toBeNull();
  });

  it("rejects a ticket whose expiry was pushed out after signing", async () => {
    const { encodeImpersonationTicket, decodeImpersonationTicket } = await mod();
    const { value } = encodeImpersonationTicket(ADMIN);

    const parts = value.split(".");
    parts[4] = String(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

    expect(decodeImpersonationTicket(parts.join("."))).toBeNull();
  });

  it("refuses a validly signed pre-binding ticket, so the format change fails closed", async () => {
    const { decodeImpersonationTicket } = await mod();
    // Exactly what the previous encoder wrote: four fields, no session id,
    // signed with the real key. Live in a browser at deploy, it must restore
    // nothing.
    const payload = [
      ADMIN.adminAuthId,
      ADMIN.adminUserId,
      ADMIN.targetUserId,
      String(Date.now() + 60_000),
    ].join(".");
    const signature = crypto
      .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY as string)
      .update(payload)
      .digest("base64url");

    expect(decodeImpersonationTicket(`${payload}.${signature}`)).toBeNull();
  });

  it("rejects its own valid ticket once expired", async () => {
    const { encodeImpersonationTicket, decodeImpersonationTicket } = await mod();
    const issuedAt = Date.now();
    const { value, ticket } = encodeImpersonationTicket(ADMIN, issuedAt);

    expect(decodeImpersonationTicket(value, ticket.expiresAt - 1)).toMatchObject(ADMIN);
    expect(decodeImpersonationTicket(value, ticket.expiresAt)).toBeNull();
    expect(decodeImpersonationTicket(value, ticket.expiresAt + 1)).toBeNull();
  });

  it("rejects absent and malformed values instead of throwing", async () => {
    const { decodeImpersonationTicket } = await mod();

    expect(decodeImpersonationTicket(undefined)).toBeNull();
    expect(decodeImpersonationTicket("")).toBeNull();
    expect(decodeImpersonationTicket("garbage")).toBeNull();
    // Right shape, wrong field count — the signature covers five fields.
    expect(decodeImpersonationTicket("a.b.c.d.e")).toBeNull();
    expect(decodeImpersonationTicket("a.b.c.d.e.f.g")).toBeNull();
  });

  it("refuses every ticket when no signing key is configured, without throwing", async () => {
    const { encodeImpersonationTicket, decodeImpersonationTicket } = await mod();
    const { value } = encodeImpersonationTicket(ADMIN);
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // The School Head layout decodes on every request. A throw here would take
    // the whole /school-head tree down on a deployment missing the key.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => decodeImpersonationTicket(value)).not.toThrow();
      expect(decodeImpersonationTicket(value)).toBeNull();
      // Starting impersonation must still fail loudly rather than mint junk.
      expect(() => encodeImpersonationTicket(ADMIN)).toThrow();
    } finally {
      process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    }

    expect(decodeImpersonationTicket(value)).toMatchObject(ADMIN);
  });

  it("does not leak signature length through a thrown comparison", async () => {
    const { encodeImpersonationTicket, decodeImpersonationTicket } = await mod();
    const { value } = encodeImpersonationTicket(ADMIN);

    const parts = value.split(".");
    parts[5] = "x"; // far shorter than a real base64url HMAC

    expect(() => decodeImpersonationTicket(parts.join("."))).not.toThrow();
    expect(decodeImpersonationTicket(parts.join("."))).toBeNull();
  });
});
