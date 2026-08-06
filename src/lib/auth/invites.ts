import "server-only";
import type { TeacherInvite, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  generateInviteTokenForUser,
  hashToken,
  parseInviteTokenUserId,
} from "@/lib/auth/credentials";

export { generateInviteTokenForUser, hashToken, parseInviteTokenUserId };
export { generateActivationCredential } from "@/lib/auth/credentials";

/**
 * Resolve the teacher User for an invite.
 *
 * Prefer invite.userId FK, then the user id embedded in the plaintext invite
 * token when available; otherwise match by school + name.
 */
export async function findTeacherForInvite(
  invite: Pick<
    TeacherInvite,
    "schoolId" | "firstName" | "lastName" | "middleName" | "createdAt" | "userId"
  >,
  token?: string
): Promise<User | null> {
  if (invite.userId) {
    const byFk = await prisma.user.findFirst({
      where: {
        id: invite.userId,
        schoolId: invite.schoolId,
        role: "TEACHER",
        deletedAt: null,
      },
    });
    if (byFk) return byFk;
  }

  if (token) {
    const embeddedId = parseInviteTokenUserId(token);
    if (embeddedId) {
      const byId = await prisma.user.findFirst({
        where: {
          id: embeddedId,
          schoolId: invite.schoolId,
          role: "TEACHER",
          deletedAt: null,
        },
      });
      if (byId) return byId;
    }
  }

  const candidates = await prisma.user.findMany({
    where: {
      schoolId: invite.schoolId,
      role: "TEACHER",
      firstName: invite.firstName,
      lastName: invite.lastName,
      deletedAt: null,
      ...(invite.middleName != null && invite.middleName !== ""
        ? { middleName: invite.middleName }
        : { OR: [{ middleName: null }, { middleName: "" }] }),
    },
    orderBy: { createdAt: "desc" },
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const pending = candidates.find((c) => c.mustChangePassword);
  if (pending) return pending;

  return (
    [...candidates].sort(
      (a, b) =>
        Math.abs(a.createdAt.getTime() - invite.createdAt.getTime()) -
        Math.abs(b.createdAt.getTime() - invite.createdAt.getTime())
    )[0] ?? null
  );
}

/**
 * Invite expiry governs the email/token activation link only.
 * A mustChangePassword teacher may still sign in with the on-screen temp credential
 * after the token expires; School Head can resend to issue a fresh token + credential.
 */
export function inviteTokenStatus(invite: {
  consumedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): "consumed" | "revoked" | "expired" | "pending" {
  if (invite.consumedAt) return "consumed";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt < new Date()) return "expired";
  return "pending";
}
