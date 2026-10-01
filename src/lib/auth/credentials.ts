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

/** Reduce a name part to A-Z/a-z words: strip diacritics, drop everything else. */
function asciiWords(raw: string): string[] {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w.length > 0);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * First-login password for a District Admin: `[First].[Last]1234`, e.g.
 * `Juan.Cruz1234`. Owner decision (2026-10-01): easy to remember and type for
 * older, busy users, accepted knowing it is guessable from the name. It is
 * one-time only — callers must set `mustChangePassword: true`.
 *
 * Rules:
 *  - First name: its FIRST WORD only ("Ma. Theresa" -> "Ma", so the dot in
 *    "Ma." is lost).
 *  - Last name: every word, each capitalised, joined with no spaces
 *    ("Dela Cruz" -> "DelaCruz").
 *  - Diacritics are stripped (ñ -> n, é -> e) and any character outside A-Z/a-z
 *    is dropped; each word is Capitalised, rest lower case.
 *
 * Throws when either part ends up empty, so a caller can never silently
 * produce ".1234". Never log or persist the result.
 */
export function districtAdminPassword(input: { firstName: string; lastName: string }): string {
  const first = asciiWords(input.firstName)[0];
  const lastWords = asciiWords(input.lastName);
  if (!first || lastWords.length === 0) {
    throw new Error("districtAdminPassword: first and last name must each contain at least one letter");
  }
  return `${capitalise(first)}.${lastWords.map(capitalise).join("")}1234`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isStrongPasswordShape(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}
