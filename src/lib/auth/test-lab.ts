import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resourceNotFound } from "@/lib/errors/app-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readBoundImpersonationSession } from "@/lib/auth/impersonation";

/**
 * Page Test Lab guards (docs/test-lab-spec.md).
 *
 * Test Lab signs a Super Admin in as demo accounts. Everything here exists so
 * that "demo" is decided server-side from the database and the signed,
 * session-bound impersonation ticket — never from anything the browser sends.
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

/** Pure: a Test Lab session needs a bound ticket, for this user, in a demo school. */
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
 * Where "Return to admin" lands: Test Lab for a demo session, the accounts
 * console otherwise (unchanged behaviour for real accounts).
 */
export function impersonationReturnPath(input: { targetSchoolIsDemo: boolean }): string {
  return input.targetSchoolIsDemo ? "/admin/test-lab" : "/admin/accounts";
}

const readTestLabSessionCached = cache(
  async (userId: string, schoolId: string | null): Promise<boolean> => {
    // Every ordinary request stops before the auth server or the database: no
    // school returns here, and no ticket cookie returns inside
    // `readBoundImpersonationSession` before it checks the session.
    if (!schoolId) return false;
    const supabase = await createSupabaseServerClient();
    const context = await readBoundImpersonationSession(supabase.auth);
    if (!context || context.ticket.targetUserId !== userId) return false;

    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { isDemo: true },
    });
    return isTestLabSession({
      ticketTargetUserId: context.ticket.targetUserId,
      userId,
      schoolIsDemo: school?.isDemo === true,
    });
  }
);

/**
 * True only when this request is a Super Admin's bound impersonation session of
 * `user`, and `user`'s school is a live demo school.
 *
 * An expired-but-bound ticket still counts. That is the conservative direction
 * for this signal: its consumers switch saves to dry-run, so treating the
 * session as a test keeps writes off rather than turning them on.
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
