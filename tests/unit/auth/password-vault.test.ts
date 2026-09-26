import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seal LITRACK puts on a School Head's own password so the Super Admin
 * console can show it back.
 *
 * What these tests defend is mostly the *failure* behaviour. A password change
 * must never break because the vault could not record it, and a blob that
 * cannot be trusted must open as nothing rather than as garbage — the console
 * treats null as "reset it", which is always safe, while a wrong string would
 * have an admin reading a dead credential down the phone.
 */

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

const vault = await import("@/lib/auth/password-vault");
const {
  sealPassword,
  openPassword,
  openPasswordWithSource,
  sealedPasswordMatches,
  isPasswordVaultConfigured,
  passwordChangeFields,
  resetPasswordVaultKeyCache,
} = vault;

const originalEnv = { ...process.env };

function setEnv(env: { vault?: string; serviceRole?: string; legacy?: string }) {
  delete process.env.PASSWORD_VAULT_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PASSWORD_VAULT_LEGACY_KEYS;
  if (env.vault) process.env.PASSWORD_VAULT_KEY = env.vault;
  if (env.serviceRole) process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceRole;
  if (env.legacy) process.env.PASSWORD_VAULT_LEGACY_KEYS = env.legacy;
  resetPasswordVaultKeyCache();
}

beforeEach(() => {
  setEnv({ vault: KEY_A });
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetPasswordVaultKeyCache();
  vi.restoreAllMocks();
});

describe("password vault round trip", () => {
  it("opens what it sealed", () => {
    const sealed = sealPassword("Tama-Na-Yan!2026");
    expect(sealed).toBeTruthy();
    expect(openPassword(sealed)).toBe("Tama-Na-Yan!2026");
  });

  it("survives non-ASCII and long passwords", () => {
    const password = "mabúhay–ñ 日本語 ".repeat(8);
    expect(openPassword(sealPassword(password))).toBe(password);
  });

  it("never produces the same blob twice for the same password", () => {
    // A fresh IV per seal. Equal blobs would let anyone holding the table see
    // which schools share a password without decrypting anything.
    const a = sealPassword("same-password");
    const b = sealPassword("same-password");
    expect(a).not.toBe(b);
    expect(openPassword(a)).toBe(openPassword(b));
  });

  it("does not contain the plaintext", () => {
    const sealed = sealPassword("plaintext-should-not-appear") ?? "";
    expect(sealed).not.toContain("plaintext");
  });

  it("accepts a hex key as well as base64", () => {
    setEnv({ vault: Buffer.alloc(32, 7).toString("hex") });
    expect(openPassword(sealPassword("hex-keyed"))).toBe("hex-keyed");
  });
});

describe("password vault refuses what it cannot trust", () => {
  it("returns null for a blob sealed under a different key", () => {
    const sealed = sealPassword("rotated-away");
    setEnv({ vault: KEY_B });
    expect(openPassword(sealed)).toBeNull();
  });

  it("returns null for a tampered ciphertext", () => {
    const sealed = sealPassword("tamper-me") ?? "";
    const parts = sealed.split(".");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString("base64url");
    expect(openPassword(parts.join("."))).toBeNull();
  });

  it("returns null for a tampered auth tag", () => {
    const sealed = sealPassword("tamper-my-tag") ?? "";
    const parts = sealed.split(".");
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64url");
    expect(openPassword(parts.join("."))).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["not a blob", "hunter2"],
    ["wrong part count", "v1.abc.def"],
    ["unknown version", "v9.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA"],
  ])("returns null for %s", (_label, value) => {
    expect(openPassword(value as string | null | undefined)).toBeNull();
  });
});

describe("password vault key configuration", () => {
  it("derives a working key from the service-role key when no vault key is set", () => {
    setEnv({ serviceRole: "service-role-secret" });
    expect(isPasswordVaultConfigured()).toBe(true);
    expect(openPassword(sealPassword("derived"))).toBe("derived");
  });

  it("seals nothing when no key of any kind exists", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setEnv({});
    expect(isPasswordVaultConfigured()).toBe(false);
    // The contract every call site depends on: a missing key degrades the
    // console, it does not throw inside someone's password change.
    expect(sealPassword("anything")).toBeNull();
    expect(openPassword("v1.a.b.c")).toBeNull();
  });

  it("falls back to the service-role key when PASSWORD_VAULT_KEY is malformed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ vault: "too-short", serviceRole: "service-role-secret" });
    const sealed = sealPassword("still-works");
    expect(sealed).toBeTruthy();

    // Same blob must open under the service-role key alone — proof the bad
    // vault key was ignored rather than mangled into a key of its own.
    setEnv({ serviceRole: "service-role-secret" });
    expect(openPassword(sealed)).toBe("still-works");
  });

  it("re-derives when the key changes under a warm process", () => {
    const sealedUnderA = sealPassword("first");
    setEnv({ vault: KEY_B });
    const sealedUnderB = sealPassword("second");
    expect(openPassword(sealedUnderB)).toBe("second");
    expect(openPassword(sealedUnderA)).toBeNull();
  });

  it("returns null rather than throwing when encryption itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // A fresh module registry so the stubbed crypto only applies to this one
    // import — every other case in this file needs the real thing.
    vi.resetModules();
    vi.doMock("node:crypto", async () => {
      const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
      return {
        ...actual,
        default: actual,
        randomBytes: () => {
          throw new Error("entropy pool exhausted");
        },
      };
    });

    const isolated = await import("@/lib/auth/password-vault");
    expect(isolated.sealPassword("boom")).toBeNull();

    vi.doUnmock("node:crypto");
    vi.resetModules();
  });
});

describe("passwordChangeFields", () => {
  it("seals a School Head's own password and dates it", () => {
    const fields = passwordChangeFields("SCHOOL_HEAD", "Head-Chosen!1");
    expect(fields.mustChangePassword).toBe(false);
    expect(fields.passwordIsSchoolId).toBe(false);
    expect(openPassword(fields.passwordVaultCipher)).toBe("Head-Chosen!1");
    expect(fields.passwordVaultSetAt).toBeInstanceOf(Date);
  });

  it.each(["TEACHER", "SUPER_ADMIN"])("stores nothing for a %s", (role) => {
    // Nothing displays these, so a recoverable copy would be exposure with no
    // purpose. If a console for them ever appears, this test should fail first.
    const fields = passwordChangeFields(role, "Teacher-Chosen!1");
    expect(fields.passwordVaultCipher).toBeNull();
    expect(fields.passwordVaultSetAt).toBeNull();
    expect(fields.mustChangePassword).toBe(false);
    expect(fields.passwordIsSchoolId).toBe(false);
  });

  it("still clears the password flags when the vault is unconfigured", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setEnv({});
    const fields = passwordChangeFields("SCHOOL_HEAD", "Head-Chosen!1");
    expect(fields.passwordVaultCipher).toBeNull();
    expect(fields.passwordVaultSetAt).toBeNull();
    // The part that must never depend on the vault: the account is off the
    // School ID and out of the forced-change state regardless.
    expect(fields.passwordIsSchoolId).toBe(false);
    expect(fields.mustChangePassword).toBe(false);
  });
});

describe("legacy vault keys", () => {
  it("opens a blob sealed under an explicit legacy hex key", () => {
    const oldKeyHex = Buffer.alloc(32, 9).toString("hex");
    setEnv({ vault: Buffer.alloc(32, 9).toString("base64") });
    // Same 32 bytes as the hex form below, just sealed while it was current.
    const sealed = sealPassword("moved-project");

    setEnv({ vault: KEY_A, legacy: oldKeyHex });
    expect(openPassword(sealed)).toBe("moved-project");
    const withSource = openPasswordWithSource(sealed);
    expect(withSource).toEqual({ password: "moved-project", usedLegacyKey: true });
  });

  it("opens a blob sealed under a legacy service-role key via derive:", () => {
    setEnv({ serviceRole: "old-project-service-role-key" });
    const sealed = sealPassword("derived-legacy");

    setEnv({ vault: KEY_A, legacy: "derive:old-project-service-role-key" });
    expect(openPassword(sealed)).toBe("derived-legacy");
    expect(openPasswordWithSource(sealed)?.usedLegacyKey).toBe(true);
  });

  it("tries multiple legacy keys in order and returns null when none match", () => {
    setEnv({ serviceRole: "yet-another-old-key" });
    const sealed = sealPassword("multi-legacy");

    setEnv({
      vault: KEY_A,
      legacy: [Buffer.alloc(32, 5).toString("hex"), "derive:yet-another-old-key"].join(","),
    });
    expect(openPassword(sealed)).toBe("multi-legacy");

    setEnv({ vault: KEY_A, legacy: Buffer.alloc(32, 5).toString("hex") });
    expect(openPassword(sealed)).toBeNull();
  });

  it("reports usedLegacyKey: false when the current key opens it directly", () => {
    setEnv({ vault: KEY_A, legacy: Buffer.alloc(32, 6).toString("hex") });
    const sealed = sealPassword("current-key-still-works");
    expect(openPasswordWithSource(sealed)).toEqual({
      password: "current-key-still-works",
      usedLegacyKey: false,
    });
  });

  it("skips a malformed legacy entry without breaking the others", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ serviceRole: "good-old-key" });
    const sealed = sealPassword("survives-a-bad-neighbor");

    setEnv({ vault: KEY_A, legacy: ["not-32-bytes", "derive:good-old-key"].join(",") });
    expect(openPassword(sealed)).toBe("survives-a-bad-neighbor");
  });

  it("never uses a legacy key to seal", () => {
    setEnv({ vault: KEY_A, legacy: Buffer.alloc(32, 8).toString("hex") });
    const sealed = sealPassword("always-current") ?? "";

    // If sealing had used the legacy key, the current key alone would fail to
    // open it. It must not.
    setEnv({ vault: KEY_A });
    expect(openPassword(sealed)).toBe("always-current");
  });
});

describe("sealedPasswordMatches", () => {
  it("is true only for the exact plaintext", () => {
    const sealed = sealPassword("exact-match");
    expect(sealedPasswordMatches(sealed, "exact-match")).toBe(true);
    expect(sealedPasswordMatches(sealed, "exact-matc")).toBe(false);
    expect(sealedPasswordMatches(sealed, "exact-match ")).toBe(false);
    expect(sealedPasswordMatches(null, "exact-match")).toBe(false);
  });
});
