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

/**
 * Invite token embeds the Prisma user id as a secondary resolver when
 * TeacherInvite.userId is null (legacy invites). Prefer invite.userId FK first.
 * Format: `{userId}.{randomBase64url}`
 */
export function generateInviteTokenForUser(userId: string): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const random = crypto.randomBytes(32).toString("base64url");
  const token = `${userId}.${random}`;
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

/** Extract embedded user id from an invite token; returns null if malformed. */
export function parseInviteTokenUserId(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const rest = token.slice(dot + 1);
  if (!userId || !rest) return null;
  // UUID v4-ish shape (accept any non-empty id without dots)
  if (userId.includes(".")) return null;
  return userId;
}

export function isStrongPasswordShape(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}
