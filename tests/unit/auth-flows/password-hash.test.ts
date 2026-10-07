import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  BCRYPT_COST,
  BCRYPT_MAX_PASSWORD_BYTES,
  DUMMY_BCRYPT_HASH,
  hashPassword,
  isBcryptHash,
  verifyPassword,
} from "@/lib/auth/password-hash";

/**
 * The one hasher (spec section 2). The migration's central promise is that a
 * person who signed in with a Supabase password yesterday signs in with the same
 * password today: every migrated hash is a GoTrue `$2a$10$` bcrypt string, and
 * `verifyPassword` is the single path that has to accept it.
 *
 * Offline and synthetic: the "Supabase" hash is built here with bcryptjs from a
 * made-up password, never taken from real user data. `$2a$` and `$2b$` differ
 * only in how bcrypt treats passwords over 255 bytes, so re-prefixing a fresh
 * hash gives exactly the bytes GoTrue would have stored.
 */

const PASSWORD = "Sample-Password-123";

/** What GoTrue stores in `auth.users.encrypted_password`: `$2a$10$` + 53 chars. */
function supabaseStyleHash(password: string): string {
  const fresh = bcrypt.hashSync(password, 10);
  return `$2a$10$${fresh.slice("$2b$10$".length)}`;
}

describe("verifyPassword with a Supabase-style $2a$10$ hash", () => {
  const hash = supabaseStyleHash(PASSWORD);

  it("builds a fixture that really has the Supabase prefix", () => {
    expect(hash.startsWith("$2a$10$")).toBe(true);
    expect(hash).toHaveLength(60);
    expect(isBcryptHash(hash)).toBe(true);
  });

  it("accepts the right password", async () => {
    await expect(verifyPassword({ hash, password: PASSWORD })).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    await expect(verifyPassword({ hash, password: "Sample-Password-124" })).resolves.toBe(false);
  });

  it("rejects the right password in a different case, and the empty password", async () => {
    await expect(verifyPassword({ hash, password: PASSWORD.toLowerCase() })).resolves.toBe(false);
    await expect(verifyPassword({ hash, password: "" })).resolves.toBe(false);
  });

  it("accepts a well-known third-party $2a$ vector, so the fixture is not self-referential", async () => {
    // crypt_blowfish / jBCrypt test vector: "U*U" at cost 5.
    const known = "$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW";
    await expect(verifyPassword({ hash: known, password: "U*U" })).resolves.toBe(true);
    await expect(verifyPassword({ hash: known, password: "U*V" })).resolves.toBe(false);
  });

  it("accepts the 6-digit School ID style passwords the old hosted auth allowed", async () => {
    const short = supabaseStyleHash("123456");
    await expect(verifyPassword({ hash: short, password: "123456" })).resolves.toBe(true);
    await expect(verifyPassword({ hash: short, password: "123457" })).resolves.toBe(false);
  });

  it("accepts non-ASCII passwords", async () => {
    const accented = supabaseStyleHash("Pásswörd-ñandú-9");
    await expect(verifyPassword({ hash: accented, password: "Pásswörd-ñandú-9" })).resolves.toBe(true);
    await expect(verifyPassword({ hash: accented, password: "Passwörd-ñandú-9" })).resolves.toBe(false);
  });
});

describe("hashPassword", () => {
  it("issues $2b$10$ hashes (GoTrue-compatible, cost 10)", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(BCRYPT_COST).toBe(10);
    expect(hash.startsWith("$2b$10$")).toBe(true);
    expect(isBcryptHash(hash)).toBe(true);
  });

  it("round-trips through verifyPassword and rejects a wrong password", async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword({ hash, password: PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash, password: `${PASSWORD}x` })).resolves.toBe(false);
  });

  it("salts every hash, so the same password never produces the same string", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it("never contains the plaintext", async () => {
    expect(await hashPassword(PASSWORD)).not.toContain(PASSWORD);
  });

  it("a new $2b$ hash re-prefixed to $2a$ (a rollback to GoTrue) still verifies", async () => {
    const hash = await hashPassword(PASSWORD);
    const rolledBack = `$2a$${hash.slice(4)}`;
    await expect(verifyPassword({ hash: rolledBack, password: PASSWORD })).resolves.toBe(true);
  });
});

describe("verifyPassword refuses anything that is not bcrypt, without throwing", () => {
  it.each([
    ["an empty string", ""],
    ["plaintext", PASSWORD],
    ["a scrypt-style Better Auth hash", `${"a".repeat(32)}:${"b".repeat(128)}`],
    ["a truncated bcrypt hash", supabaseStyleHash(PASSWORD).slice(0, 40)],
    ["an unsupported version", `$2x$10$${"a".repeat(53)}`],
    ["a hash with trailing junk", `${supabaseStyleHash(PASSWORD)}\n`],
    ["an argon2 hash", "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG"],
  ])("returns false for %s", async (_label, hash) => {
    await expect(verifyPassword({ hash, password: PASSWORD })).resolves.toBe(false);
  });

  it("returns false for a null or undefined hash column", async () => {
    await expect(
      verifyPassword({ hash: null as unknown as string, password: PASSWORD })
    ).resolves.toBe(false);
    await expect(
      verifyPassword({ hash: undefined as unknown as string, password: PASSWORD })
    ).resolves.toBe(false);
  });
});

describe("isBcryptHash", () => {
  it.each(["$2a$10$", "$2b$10$", "$2y$10$"])("recognises the %s prefix", (prefix) => {
    expect(isBcryptHash(`${prefix}${"A".repeat(53)}`)).toBe(true);
  });

  it("rejects non-strings and wrong-length strings", () => {
    expect(isBcryptHash(null)).toBe(false);
    expect(isBcryptHash(undefined)).toBe(false);
    expect(isBcryptHash(12345)).toBe(false);
    expect(isBcryptHash(`$2b$10$${"A".repeat(52)}`)).toBe(false);
    expect(isBcryptHash(`$2b$10$${"A".repeat(54)}`)).toBe(false);
  });
});

describe("DUMMY_BCRYPT_HASH", () => {
  it("is a real bcrypt hash at cost 10, so verifying against it costs the same CPU", () => {
    expect(isBcryptHash(DUMMY_BCRYPT_HASH)).toBe(true);
    expect(DUMMY_BCRYPT_HASH.startsWith("$2b$10$")).toBe(true);
  });

  it("does not match common passwords or the empty string", async () => {
    for (const guess of ["", "password", "123456", "admin", PASSWORD]) {
      await expect(verifyPassword({ hash: DUMMY_BCRYPT_HASH, password: guess })).resolves.toBe(false);
    }
  });
});

describe("the 72-byte bcrypt limit", () => {
  it("is exported as the cap the validator enforces", () => {
    expect(BCRYPT_MAX_PASSWORD_BYTES).toBe(72);
  });

  it("documents why: bytes past 72 are ignored, so a longer password matches its 72-byte prefix", async () => {
    const prefix = "p".repeat(BCRYPT_MAX_PASSWORD_BYTES);
    const hash = await hashPassword(prefix);
    await expect(verifyPassword({ hash, password: `${prefix}tail` })).resolves.toBe(true);
    // One byte inside the limit still counts.
    await expect(verifyPassword({ hash, password: "p".repeat(BCRYPT_MAX_PASSWORD_BYTES - 1) })).resolves.toBe(
      false
    );
  });
});
