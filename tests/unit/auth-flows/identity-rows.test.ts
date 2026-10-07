import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_PROVIDER_ID,
  buildIdentityRows,
  normalizeIdentityEmail,
} from "@/lib/auth/identity-rows";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";

/**
 * The exact AuthUser + credential AuthAccount rows one identity is made of.
 * Better Auth's `signInEmail` finds the credential by `(providerId, accountId)`
 * with `accountId === userId`, so any drift here is an account that cannot sign
 * in. Pure and offline: no database, synthetic ids and addresses only.
 */

const AUTH_ID = "11111111-1111-4111-8111-111111111111";
const HASH = `$2a$10$${"A".repeat(53)}`;
const CREATED = new Date("2026-01-02T03:04:05.000Z");

describe("normalizeIdentityEmail", () => {
  it("trims and lowercases, the way Better Auth looks users up", () => {
    expect(normalizeIdentityEmail("  Teacher@School.EDU  ")).toBe("teacher@school.edu");
  });

  it("is idempotent", () => {
    const once = normalizeIdentityEmail("A.B@Example.Test");
    expect(normalizeIdentityEmail(once)).toBe(once);
  });
});

describe("buildIdentityRows", () => {
  const { user, account } = buildIdentityRows({
    authId: AUTH_ID,
    email: " Ana.Cruz@School.EDU ",
    role: "TEACHER",
    passwordHash: HASH,
    createdAt: CREATED,
  });

  it("uses the existing User.authId as AuthUser.id", () => {
    expect(user.id).toBe(AUTH_ID);
  });

  it("stores the normalized email (invariant I2 compares it with User.email)", () => {
    expect(user.email).toBe("ana.cruz@school.edu");
  });

  it("carries the role (invariant I3) and never starts banned", () => {
    expect(user.role).toBe("TEACHER");
    expect(user.banned).toBe(false);
  });

  it("leaves name empty because User.fullName is authoritative", () => {
    expect(user.name).toBe("");
  });

  it("marks the email verified by default (School Head approval is the gate)", () => {
    expect(user.emailVerified).toBe(true);
    expect(
      buildIdentityRows({ authId: AUTH_ID, email: "a@b.test", role: "TEACHER", passwordHash: HASH, emailVerified: false })
        .user.emailVerified
    ).toBe(false);
  });

  it("makes the credential account findable by (providerId, accountId) with accountId === userId", () => {
    expect(account.providerId).toBe("credential");
    expect(account.providerId).toBe(CREDENTIAL_PROVIDER_ID);
    expect(account.accountId).toBe(AUTH_ID);
    expect(account.userId).toBe(AUTH_ID);
  });

  it("gives the account the authId as its own id, so a backfill re-run upserts the same row", () => {
    expect(account.id).toBe(AUTH_ID);
  });

  it("stores the hash it was given, untouched", () => {
    expect(account.password).toBe(HASH);
  });

  it("defaults updatedAt to createdAt on both rows, and honours an explicit updatedAt", () => {
    expect(user.createdAt).toBe(CREATED);
    expect(user.updatedAt).toBe(CREATED);
    expect(account.createdAt).toBe(CREATED);
    expect(account.updatedAt).toBe(CREATED);

    const later = new Date("2026-02-03T00:00:00.000Z");
    const rows = buildIdentityRows({
      authId: AUTH_ID,
      email: "a@b.test",
      role: "SCHOOL_HEAD",
      passwordHash: HASH,
      createdAt: CREATED,
      updatedAt: later,
    });
    expect(rows.user.createdAt).toBe(CREATED);
    expect(rows.user.updatedAt).toBe(later);
    expect(rows.account.updatedAt).toBe(later);
  });

  it("stamps a current date when none is given", () => {
    const before = Date.now();
    const rows = buildIdentityRows({ authId: AUTH_ID, email: "a@b.test", role: "TEACHER", passwordHash: HASH });
    expect(rows.user.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(rows.user.updatedAt).toBe(rows.user.createdAt);
  });

  it.each(["SUPER_ADMIN", "DISTRICT_ADMIN", "SCHOOL_HEAD", "TEACHER"] as const)(
    "carries the %s role through unchanged",
    (role) => {
      expect(buildIdentityRows({ authId: AUTH_ID, email: "a@b.test", role, passwordHash: HASH }).user.role).toBe(role);
    }
  );

  it("is deterministic for the same input, so two builders can never disagree", () => {
    const input = { authId: AUTH_ID, email: "A@B.test", role: "TEACHER" as const, passwordHash: HASH, createdAt: CREATED };
    expect(buildIdentityRows(input)).toEqual(buildIdentityRows(input));
  });

  it("holds no plaintext anywhere: the only secret field is the already-hashed password", async () => {
    const plaintext = "Sample-Password-123";
    const rows = buildIdentityRows({
      authId: AUTH_ID,
      email: "a@b.test",
      role: "TEACHER",
      passwordHash: await hashPassword(plaintext),
    });
    expect(JSON.stringify(rows)).not.toContain(plaintext);
    // And the stored value is exactly what the sign-in path verifies.
    await expect(verifyPassword({ hash: rows.account.password, password: plaintext })).resolves.toBe(true);
  });
});
