import crypto from "node:crypto";

/** ~14-char base64url one-time activation credential (10 random bytes). */
const CREDENTIAL_BYTES = 10;

/**
 * Cryptographically strong one-time credential for School Head / teacher activation.
 * Never log or persist the plaintext — only show once to an authorized admin UI.
 */
export function generateActivationCredential(): string {
  return crypto.randomBytes(CREDENTIAL_BYTES).toString("base64url");
}

/**
 * Letters and digits a person can read off a printed sheet and type back
 * without guessing: no 0/o, 1/l/i, and lower case only.
 */
const READABLE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const READABLE_LENGTH = 16;
const READABLE_GROUP = 4;

/**
 * One-time password meant to be handed to a person (a credentials sheet), e.g.
 * `k7mp-x3qa-9d2r-hn4w`: 16 characters from `READABLE_ALPHABET` (~79 bits),
 * grouped in fours.
 *
 * Always holds at least one letter and one digit so it passes
 * `isStrongPasswordShape`. A draw that misses either is thrown away and drawn
 * again rather than patched, so every accepted value stays uniformly random.
 * Never log or persist the plaintext.
 */
export function generateReadableCredential(): string {
  for (;;) {
    let raw = "";
    for (let i = 0; i < READABLE_LENGTH; i++) {
      raw += READABLE_ALPHABET[crypto.randomInt(READABLE_ALPHABET.length)];
    }
    if (!/[a-z]/.test(raw) || !/[0-9]/.test(raw)) continue;
    const groups: string[] = [];
    for (let i = 0; i < READABLE_LENGTH; i += READABLE_GROUP) {
      groups.push(raw.slice(i, i + READABLE_GROUP));
    }
    return groups.join("-");
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isStrongPasswordShape(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}
