import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { resourceNotFound } from "@/lib/errors/app-error";
import { readImpersonation, type ImpersonationReturnTo } from "@/lib/auth/impersonation-session";

/**
 * Page Test Lab guards (docs/test-lab-spec.md).
 *
 * Test Lab signs a Super Admin in as demo accounts. Everything here exists so
 * that "demo" is decided server-side from the database and the impersonation
 * recorded on the session row (`impersonatedBy`) — never from anything the
 * browser sends.
 */

/**
 * Refuse unless `schoolId` names a live demo school.
 *
 * A real school, a soft-deleted school and a missing id all produce the same
 * generic not-found `assertSameSchool` uses, so this cannot be used to probe
 * which schools exist or which are demo.
 */
export async function assertTestableSchool(schoolId: string | null | undefined): Promise<void> {
  if (!schoolId) throw resourceNotFound("School", { detail: "assertTestableSchool: no school id" });
  const school = await prisma.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: { isDemo: true },
  });
  if (!school?.isDemo) {
    throw resourceNotFound("School", {
      detail: `assertTestableSchool refused: school ${schoolId} is ${school ? "not demo" : "missing or deleted"}`,
    });
  }
}

/** Pure: a Test Lab session needs an impersonation of this user, in a demo school. */
export function isTestLabSession(input: {
  ticketTargetUserId: string | null | undefined;
  userId: string;
  schoolIsDemo: boolean;
}): boolean {
  return (
    typeof input.ticketTargetUserId === "string" &&
    input.ticketTargetUserId.length > 0 &&
    input.ticketTargetUserId === input.userId &&
    input.schoolIsDemo === true
  );
}

/**
 * Where "Return to admin" lands: Test Lab for a demo session or for a session
 * Test Lab started on a real account (the allowlisted `returnTo`, used for
 * "Open as District Admin"), the accounts console otherwise.
 */
export function impersonationReturnPath(input: {
  targetSchoolIsDemo: boolean;
  returnTo?: ImpersonationReturnTo;
}): string {
  return input.targetSchoolIsDemo || input.returnTo === "test-lab" ? ADMIN_ROUTES.testLab : ADMIN_ROUTES.teachers;
}

const readTestLabSessionCached = cache(
  async (userId: string, schoolId: string | null): Promise<boolean> => {
    // A school-less user stops here; everyone else pays one cookie-cached
    // session read, and a school query only while impersonated.
    if (!schoolId) return false;
    const context = await readImpersonation();
    if (!context || context.targetUserId !== userId) return false;

    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { isDemo: true },
    });
    return isTestLabSession({
      ticketTargetUserId: context.targetUserId,
      userId,
      schoolIsDemo: school?.isDemo === true,
    });
  }
);

/**
 * True only when this request is a Super Admin's impersonation session of
 * `user`, and `user`'s school is a live demo school.
 *
 * Read through the session cookie cache, so a just-ended impersonation can
 * still count for a few minutes. That is the conservative direction for this
 * signal: its consumers switch saves to dry-run, so treating the session as a
 * test keeps writes off rather than turning them on.
 *
 * Keyed on primitives so React `cache()` memoizes per request regardless of
 * which `User` object reference a caller holds.
 */
export async function readTestLabSession(user: {
  id: string;
  schoolId: string | null;
}): Promise<boolean> {
  return readTestLabSessionCached(user.id, user.schoolId);
}
