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

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isStrongPasswordShape(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}
