"use server";

import { resourceNotFound } from "@/lib/errors/app-error";
import { action } from "@/lib/errors/action";
import { parseInput } from "@/lib/errors/validation";
import { requireAdminScope, loadSchoolInScope } from "@/lib/auth/district-scope";
import { schoolWhereForScope } from "@/lib/auth/admin-scope";
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
 * The unlock console: a Super Admin division-wide, or a district admin within
 * their own districts (`docs/specs/district-admin.md` 3.5).
 *
 * `requireAdminScope()` is the ONLY gate — never `requireUser(["DISTRICT_ADMIN"])`
 * or a hand-rolled Super Admin check next to it, because `requireAdminScope`
 * already makes the Super Admin branch explicit (`docs/specs/district-admin.md`
 * I8) and is the one place a role becomes a scope. Every target this file loads
 * — the teacher's school, the named school, the grant being revoked — is loaded
 * WITH that scope in the `where`, never checked afterwards: an out-of-scope
 * target reads as NOT_FOUND, the same as one that does not exist.
 *
 * Uses the `action()` wrapper and throws `AppError` instead of hand-building
 * `{ ok: false, error }` (docs/errors.md). The grant rows themselves are
 * written by `src/lib/unlock/issue.ts`; nothing in this file touches
 * `UnlockGrant` or `SchoolUnlockGrant` directly.
 */

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
 * 1. `requireAdminScope()` proves the caller is a Super Admin (division scope)
 *    or a district admin (their own districts) — never a School Head or
 *    teacher, and never a district admin's *other* districts.
 * 2. The payload is validated — including the day count, so a mistyped 500 is
 *    refused rather than clamped to 90 behind the person's back.
 * 3. The target row is LOADED WITH THE SCOPE IN ITS WHERE (`loadSchoolInScope`),
 *    and the grant's `schoolId` is taken from that row. In teacher mode the
 *    payload's own `schoolId` is refused by the schema outright, so there is no
 *    path by which a client-supplied school reaches a grant.
 * 4. A missing, removed, school-less, or out-of-scope target answers
 *    `NOT_FOUND` in the same words either way (`docs/specs/district-admin.md`
 *    I7) — a district admin cannot learn that a teacher or school exists
 *    outside their districts.
 */
export const issueUnlock = action(
  "issueUnlock",
  async (input: unknown): Promise<{ ok: true; data: IssuedUnlock }> => {
    const { user: admin, scope } = await requireAdminScope();
    const data = parseInput(issueUnlockSchema, input);

    if (data.mode === "teacher") {
      // `userId` is guaranteed present in this mode by the schema's superRefine.
      const target = await findUnlockRecipient(data.userId as string);
      if (!target) throw resourceNotFound("Teacher");
      // Throws NOT_FOUND when the teacher's school is outside the caller's scope.
      await loadSchoolInScope(scope, target.schoolId, { id: true });

      const issued = await issueTeacherUnlock({
        actorId: admin.id,
        userId: target.id,
        schoolId: target.schoolId,
        scope: data.scope,
        targetKey: data.targetKey,
        days: data.days,
        reason: data.reason ?? null,
      });

      revalidateUnlockGrants({ recipientIds: [target.id] });
      return {
        ok: true,
        data: { id: issued.id, expiresAt: issued.expiresAt, recipients: 1 },
      };
    }

    const school = await loadSchoolInScope(scope, data.schoolId as string, { id: true });

    const issued = await issueSchoolUnlock({
      actorId: admin.id,
      schoolId: school.id,
      scope: data.scope,
      targetKey: data.targetKey,
      days: data.days,
      reason: data.reason ?? null,
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
 *
 * The grant is loaded WITH the caller's scope in its `where` before either
 * `revoke*Unlock` function (which look it up again, by id alone) ever runs —
 * an out-of-scope grant id must never reach them.
 */
export const revokeUnlock = action(
  "revokeUnlock",
  async (input: unknown): Promise<{ ok: true }> => {
    const { user: admin, scope } = await requireAdminScope();
    const data = parseInput(revokeUnlockSchema, input);

    if (data.kind === "teacher") {
      const grant = await prisma.unlockGrant.findFirst({
        where: { id: data.grantId, school: schoolWhereForScope(scope) },
        select: { id: true },
      });
      if (!grant) throw resourceNotFound("Grant");
    } else {
      const grant = await prisma.schoolUnlockGrant.findFirst({
        where: { id: data.grantId, school: schoolWhereForScope(scope) },
        select: { id: true },
      });
      if (!grant) throw resourceNotFound("Grant");
    }

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
