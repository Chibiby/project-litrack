import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Reversible storage for School Head passwords.
 *
 * LITRACK's long-standing position was that a password a person chose is a
 * bcrypt hash inside Supabase Auth and nobody — admin included — can read it
 * back. Operationally that left the Super Admin console with one move when a
 * head forgot their password: reset it to the School ID, which invalidates the
 * password the head may simply have mistyped, and does so silently from their
 * side. This module is the deliberate trade the project owner asked for: keep a
 * copy the console can show, and make that copy worth as little as possible to
 * anyone who ends up holding the database without the key.
 *
 * What that means concretely, so nobody has to reverse-engineer the intent:
 *  - AES-256-GCM, fresh 12-byte IV per seal, auth tag verified on open. A
 *    tampered or truncated blob fails to open rather than returning garbage.
 *  - The key never lives in Postgres. A dump alone decrypts nothing.
 *  - Sealing is best-effort at every call site: a missing key or a failed seal
 *    must never block someone from changing their own password. The console
 *    degrades to "not readable", which is exactly what it said before.
 *  - `SCHOOL_HEAD` rows only. See `User.passwordVaultCipher` in the schema.
 *
 * Blob format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version
 * prefix exists so a future key-rotation scheme can tell old blobs apart
 * without guessing at lengths.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * HKDF labels. Changing either string silently invalidates every stored blob
 * (they stop opening, the console falls back to "not readable"), so don't.
 */
const DERIVE_SALT = "litrack.password-vault.v1";
const DERIVE_INFO = "school-head-password-seal";

let cachedKey: Buffer | null = null;
let cachedKeySource: string | null = null;
let warnedNoKey = false;

/**
 * Accepts a 32-byte key as base64, base64url, or hex — whichever form the
 * operator's key generator produced. Anything that does not decode to exactly
 * 32 bytes is rejected rather than padded or hashed into shape, because a key
 * that quietly differs from the one used to seal is indistinguishable from
 * data loss.
 */
function parseExplicitKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");

  const b64 = Buffer.from(value, "base64");
  if (b64.length === KEY_BYTES) return b64;

  return null;
}

/**
 * Resolve the sealing key.
 *
 * `PASSWORD_VAULT_KEY` is the supported answer. Absent it, the key is derived
 * from the Supabase service-role key, which is already the most privileged
 * secret this deployment holds — anyone with it can reset every password
 * anyway, so deriving from it adds no new exposure while letting the feature
 * work in an environment nobody has re-configured yet. The consequence to know:
 * rotating the service-role key rotates this key too, and every blob sealed
 * under the old one stops opening. Set `PASSWORD_VAULT_KEY` to decouple them.
 */
function resolveKey(): Buffer | null {
  const explicit = process.env.PASSWORD_VAULT_KEY;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const source = explicit?.trim() || fallback?.trim() || "";

  if (!source) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        "[password-vault] No PASSWORD_VAULT_KEY or SUPABASE_SERVICE_ROLE_KEY — passwords will not be recorded and the admin console will show them as not readable."
      );
    }
    return null;
  }

  // Re-derive when the env changes under a warm lambda (a rotation, or tests
  // swapping keys), rather than serving a key that no longer matches config.
  const fingerprint = createHash("sha256").update(source).digest("base64");
  if (cachedKey && cachedKeySource === fingerprint) return cachedKey;

  let key: Buffer | null = null;
  if (explicit?.trim()) {
    key = parseExplicitKey(explicit);
    if (!key) {
      console.error(
        "[password-vault] PASSWORD_VAULT_KEY is set but is not 32 bytes of hex or base64 — ignoring it and deriving from the service-role key instead."
      );
    }
  }

  if (!key) {
    const material = explicit?.trim() && !parseExplicitKey(explicit) ? fallback : source;
    if (!material) return null;
    key = Buffer.from(hkdfSync("sha256", material, DERIVE_SALT, DERIVE_INFO, KEY_BYTES));
  }

  cachedKey = key;
  cachedKeySource = fingerprint;
  return key;
}

/** Whether sealing and opening can work at all in this environment. */
export function isPasswordVaultConfigured(): boolean {
  return resolveKey() !== null;
}

/**
 * Seal a plaintext password. Returns null when the vault is unconfigured or the
 * password is empty — callers store null and the console says "not readable".
 *
 * Never throws. A password change must not fail because bookkeeping did.
 */
export function sealPassword(plaintext: string): string | null {
  if (!plaintext) return null;

  const key = resolveKey();
  if (!key) return null;

  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  } catch (err) {
    console.error("[password-vault] seal failed:", err);
    return null;
  }
}

/**
 * Open a sealed password. Returns null for anything that does not open cleanly:
 * a blob from another key, a truncated column, a future version, or tampering.
 * The caller cannot tell those apart on purpose — every one of them means the
 * same thing to an admin, which is "reset it".
 */
export function openPassword(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  const parts = sealed.split(".");
  if (parts.length !== 4) return null;

  const [version, ivPart, tagPart, ctPart] = parts;
  if (version !== VERSION) return null;

  const key = resolveKey();
  if (!key) return null;

  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const ciphertext = Buffer.from(ctPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) return null;

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // `final()` throwing IS the authentication check failing. Expected whenever
    // the key rotated, so this is not logged as an error.
    return null;
  }
}

/**
 * True when `sealed` opens to exactly `plaintext`.
 *
 * Used by the console's own tests and by any future consistency check; compared
 * in constant time so it cannot be turned into an oracle if it ever ends up
 * behind a request.
 */
export function sealedPasswordMatches(
  sealed: string | null | undefined,
  plaintext: string
): boolean {
  const opened = openPassword(sealed);
  if (opened === null) return false;

  const a = Buffer.from(opened, "utf8");
  const b = Buffer.from(plaintext, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The `User` columns to write alongside a password the person chose themselves.
 *
 * Every path that lets someone set their own password — first-login set,
 * voluntary change, recovery link — ends with the same three facts: they are no
 * longer on the School ID, they are no longer being prompted, and for a School
 * Head the console should be able to show what they picked.
 *
 * Only `SCHOOL_HEAD` is sealed. A teacher's password appears in no console, so
 * a recoverable copy of it would be exposure that buys nothing. Lives here
 * rather than in the action file so the rule is testable on its own — an
 * action module marked `"use server"` can only export async functions.
 */
export function passwordChangeFields(
  role: string,
  plaintext: string
): {
  mustChangePassword: boolean;
  passwordIsSchoolId: boolean;
  passwordVaultCipher: string | null;
  passwordVaultSetAt: Date | null;
} {
  const sealed = role === "SCHOOL_HEAD" ? sealPassword(plaintext) : null;
  return {
    mustChangePassword: false,
    passwordIsSchoolId: false,
    passwordVaultCipher: sealed,
    passwordVaultSetAt: sealed ? new Date() : null,
  };
}

/** Test seam: drop the memoized key so a test can swap env between cases. */
export function resetPasswordVaultKeyCache(): void {
  cachedKey = null;
  cachedKeySource = null;
  warnedNoKey = false;
}
