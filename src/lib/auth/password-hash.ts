/**
 * The one password hasher. Bcrypt everywhere (spec section 2):
 *
 * - Every migrated Supabase hash is `$2a$10$`, so a single verify path covers
 *   old and new credentials.
 * - New hashes (`$2b$10$`) are GoTrue-compatible, so a rollback can sync them
 *   back losslessly.
 * - Same CPU profile as today's hashes, and no pure-JS scrypt fallback on workerd.
 *
 * Pure: no `server-only`, no `@/` imports. The Better Auth config, the identity
 * module and the ops scripts (run with tsx, relative imports) all share it.
 */

import bcrypt from "bcryptjs";

/** Cost 10, the same as every hash Supabase Auth issued. */
export const BCRYPT_COST = 10;

/**
 * bcrypt only reads the first 72 bytes of a password and silently ignores the
 * rest. The validator caps input at this length so two different long
 * passwords can never verify against each other.
 */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/** `$2a$`, `$2b$` or `$2y$`, a two-digit cost, then 22 salt + 31 hash chars. */
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value: unknown): value is string {
  return typeof value === "string" && BCRYPT_HASH.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * True only for a bcrypt hash that matches. Anything that is not a bcrypt
 * hash (an empty column, a scrypt hash, garbage) is a plain `false`, never a
 * throw, so a malformed row reads as "wrong password" rather than a 500.
 *
 * The object shape matches Better Auth's `emailAndPassword.password.verify`.
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!isBcryptHash(hash)) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * A valid bcrypt hash of a random string nobody knows. Verifying against it
 * spends the same CPU as a real check, so an unknown account takes as long to
 * refuse as a wrong password (the admin unknown-handle probe).
 */
export const DUMMY_BCRYPT_HASH = "$2b$10$6cWRMEACPMUmzaFFxbQCDOZiXb/TAO7wl1UD6E1hbhMOXhP.9/S26";
