"use server";

import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { action } from "@/lib/errors/action";
import { parseInput } from "@/lib/errors/validation";
import { requireUser } from "@/lib/auth/session";
import { revalidateUnlockGrants } from "@/lib/cache/revalidate";
import { prisma } from "@/lib/prisma";
import {
  findUnlockRecipient,
  issueSchoolUnlock,
  issueTeacherUnlock,
  revokeSchoolUnlock,
  revokeTeacherUnlock,
} from "@/lib/unlock/issue";
import { issueUnlockSchema, revokeUnlockSchema } from "@/lib/validators/support.schema";

/**
 * The Super Admin unlock console.
 *
 * Deliberately cross-tenant, like `/admin/audit` and the support inbox: the
 * division admin issues access to any school, so there is no `schoolId` filter
 * to apply and no session school to filter by. That makes the role guard the
 * ONLY thing standing between one school's data and another's, so it is written
 * out rather than implied — see `requireSuperAdmin` below.
 *
 * New actions, so they use the `action()` wrapper and throw `AppError` instead
 * of hand-building `{ ok: false, error }` (docs/errors.md). The grant rows
 * themselves are written by `src/lib/unlock/issue.ts`; nothing in this file
 * touches `UnlockGrant` or `SchoolUnlockGrant` directly.
 */

/**
 * A Super Admin, proven.
 *
 * `requireUser(["SUPER_ADMIN"])` on its own does NOT prove this. It proves the
 * caller passed *a* role check, and `allowSuperAdmin` defaults to true, which
 * means a Super Admin satisfies every role list in the app by impersonation.
 * Read the other direction — the direction that matters here — the helper is
 * one flipped default or one edited argument away from admitting somebody else,
 * and what it would admit them to is every school at once. The equality check
 * is the actual gate; the `requireUser` call is what redirects a signed-out
 * person to the right login page.
 *
 * A School Head or teacher reaching this is a refusal worth recording, which is
 * what `AUTH_FORBIDDEN`'s `security` severity does — it lands in `ErrorEvent`
 * rather than passing as an ordinary user mistake.
 */
async function requireSuperAdmin() {
  const admin = await requireUser(["SUPER_ADMIN"]);
  if (admin.role !== "SUPER_ADMIN") {
    throw new AppError("AUTH_FORBIDDEN", {
      params: { what: "the unlock console" },
      detail: `role ${admin.role} reached the unlock console`,
      context: { role: admin.role },
    });
  }
  return admin;
}

export type IssuedUnlock = {
  id: string;
  expiresAt: Date;
  /** How many teachers were told. Always 1 in teacher mode. */
  recipients: number;
};

/**
 * Reopen one window, for one teacher or for a whole school.
 *
 * The tenant story, in the order it happens:
 *
 * 1. The caller is proven to be a Super Admin, who is division-wide.
 * 2. The payload is validated — including the day count, so a mistyped 500 is
 *    refused rather than clamped to 90 behind the person's back.
 * 3. The target row is LOADED, and the grant's `schoolId` is taken from that
 *    row. In teacher mode the payload's own `schoolId` is refused by the schema
 *    outright, so there is no path by which a client-supplied school reaches a
 *    grant.
 * 4. A missing, removed or school-less target answers `NOT_FOUND` in the same
 *    words either way.
 */
export const issueUnlock = action(
  "issueUnlock",
  async (input: unknown): Promise<{ ok: true; data: IssuedUnlock }> => {
    const admin = await requireSuperAdmin();
    const data = parseInput(issueUnlockSchema, input);

    if (data.mode === "teacher") {
      // `userId` is guaranteed present in this mode by the schema's superRefine.
      const target = await findUnlockRecipient(data.userId as string);
      if (!target) throw resourceNotFound("Teacher");

      const issued = await issueTeacherUnlock({
        actorId: admin.id,
        userId: target.id,
        schoolId: target.schoolId,
        scope: data.scope,
        targetKey: data.targetKey,
        days: data.days,
      });

      revalidateUnlockGrants({ recipientIds: [target.id] });
      return {
        ok: true,
        data: { id: issued.id, expiresAt: issued.expiresAt, recipients: 1 },
      };
    }

    const school = await prisma.school.findFirst({
      where: { id: data.schoolId as string, deletedAt: null },
      select: { id: true },
    });
    if (!school) throw resourceNotFound("School");

    const issued = await issueSchoolUnlock({
      actorId: admin.id,
      schoolId: school.id,
      scope: data.scope,
      targetKey: data.targetKey,
      days: data.days,
    });

    revalidateUnlockGrants({ recipientIds: issued.recipientIds });
    return {
      ok: true,
      data: {
        id: issued.id,
        expiresAt: issued.expiresAt,
        recipients: issued.recipientIds.length,
      },
    };
  },
  { verb: "issue the unlock" }
);

/**
 * End a grant early.
 *
 * Idempotent: a grant that was already revoked answers `{ ok: true }` and
 * writes nothing, so a second click cannot move the timestamp that records when
 * access actually ended. A grant id from the other table answers `NOT_FOUND` —
 * `kind` says which table to look in, and looking in the wrong one is
 * indistinguishable from a grant that does not exist, which is the correct
 * thing for it to look like.
 */
export const revokeUnlock = action(
  "revokeUnlock",
  async (input: unknown): Promise<{ ok: true }> => {
    const admin = await requireSuperAdmin();
    const data = parseInput(revokeUnlockSchema, input);

    const outcome =
      data.kind === "teacher"
        ? await revokeTeacherUnlock({ actorId: admin.id, grantId: data.grantId })
        : await revokeSchoolUnlock({ actorId: admin.id, grantId: data.grantId });

    if (!outcome.found) throw resourceNotFound("Grant");

    revalidateUnlockGrants({ recipientIds: outcome.recipientIds });
    return { ok: true };
  },
  { verb: "revoke the unlock" }
);
