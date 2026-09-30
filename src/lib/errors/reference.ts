/**
 * The short code a person quotes to support. Pure and free of `server-only`, so
 * the browser can mint one for a failure that never reached the server.
 */

/** Crockford base32: no I, L, O or U, so a reference read aloud survives. */
const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReference(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return `E-${Array.from(bytes, (b) => REF_ALPHABET[b % 32]).join("")}`;
}
