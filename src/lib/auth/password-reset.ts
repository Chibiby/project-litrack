import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prismaFresh } from "@/lib/prisma";
import { AppError } from "@/lib/errors/app-error";
import type { IdentityDb } from "@/lib/auth/identity";

/**
 * Password reset tokens, stored in `AuthVerification` (spec section 2, Reset).
 *
 * Our own module rather than Better Auth's reset endpoints, which store the raw
 * token and leave older links alive. Here:
 * - the email carries a random token; the row stores only
 *   `identifier = "reset-password:" + sha256(token)`, with `value = authId`, so
 *   a database read cannot be turned into a working link;
 * - issuing deletes that identity's older reset rows, so only the newest email
 *   works (the behaviour people already had with Supabase);
 * - consuming deletes the row and must delete exactly one, inside the caller's
 *   transaction with the password write, so a link works once (invariant I9).
 */

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const IDENTIFIER_PREFIX = "reset-password:";

function identifierFor(token: string): string {
  return IDENTIFIER_PREFIX + createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before any query: 32 random bytes as base64url is 43 chars. */
function isPlausibleToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * New single-use reset token for this identity; older ones stop working.
 * The raw token goes only into the email link — never log, audit or store it.
 */
export async function issueResetToken(
  authId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await prismaFresh.$transaction(async (tx) => {
    await tx.authVerification.deleteMany({
      where: { value: authId, identifier: { startsWith: IDENTIFIER_PREFIX } },
    });
    await tx.authVerification.create({
      data: {
        id: crypto.randomUUID(),
        identifier: identifierFor(token),
        value: authId,
        expiresAt,
      },
    });
  });
  return { token, expiresAt };
}

/**
 * Delete the row of a token that was issued but never delivered (the email
 * failed), so the resend cooldown does not treat it as a sent link. Best effort:
 * a failure here leaves the row to expire, never masks the original error.
 */
export async function discardResetToken(token: string): Promise<void> {
  try {
    await prismaFresh.authVerification.deleteMany({ where: { identifier: identifierFor(token) } });
  } catch (err) {
    console.error("[password-reset] discardResetToken failed:", err);
  }
}

/**
 * The identity a live token belongs to, without using it up — for the confirm
 * page and the verify route, which must not consume on a GET that a mail
 * scanner may prefetch. Null for an unknown, expired or malformed token.
 */
export async function peekResetToken(
  token: string | null | undefined
): Promise<{ authId: string; expiresAt: Date } | null> {
  if (!isPlausibleToken(token)) return null;
  const row = await prismaFresh.authVerification.findFirst({
    where: { identifier: identifierFor(token), expiresAt: { gt: new Date() } },
    select: { value: true, expiresAt: true },
  });
  return row ? { authId: row.value, expiresAt: row.expiresAt } : null;
}

/**
 * Use the token up and return its identity. Throws `AUTH_RESET_LINK_EXPIRED`
 * unless exactly one live row was deleted — so of two concurrent submits only
 * one wins. Pass the transaction that also writes the new password.
 */
export async function consumeResetToken(
  token: string | null | undefined,
  tx: IdentityDb = prismaFresh
): Promise<string> {
  const expired = () =>
    new AppError("AUTH_RESET_LINK_EXPIRED", { context: { reason: "reset_token_invalid" } });
  if (!isPlausibleToken(token)) throw expired();

  const row = await tx.authVerification.findFirst({
    where: { identifier: identifierFor(token), expiresAt: { gt: new Date() } },
    select: { id: true, value: true },
  });
  if (!row) throw expired();

  const { count } = await tx.authVerification.deleteMany({
    where: { id: row.id, expiresAt: { gt: new Date() } },
  });
  if (count !== 1) throw expired();
  return row.value;
}

/**
 * Whether this identity was sent a reset link within `withinMs` (the resend
 * cooldown). Best effort: any failure reads as "no", so this check can never
 * block a legitimate reset email.
 */
export async function hasRecentResetToken(authId: string, withinMs: number): Promise<boolean> {
  try {
    const row = await prismaFresh.authVerification.findFirst({
      where: {
        value: authId,
        identifier: { startsWith: IDENTIFIER_PREFIX },
        createdAt: { gt: new Date(Date.now() - withinMs) },
      },
      select: { id: true },
    });
    return row !== null;
  } catch {
    return false;
  }
}
