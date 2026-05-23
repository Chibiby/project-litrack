import "server-only";
import crypto from "node:crypto";

const TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
