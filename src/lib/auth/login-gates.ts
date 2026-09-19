import "server-only";
import { prisma } from "@/lib/prisma";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { isDemoVisible } from "@/lib/demo/session";

/** Pre-flight checks shared by the server-side and browser-side sign-in halves. */

export const LOGIN_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;

export function assertSupabaseConfigured(): void {
  if (isSupabaseConfigured()) return;
  // The variable names are admin detail. The person is told the server is not
  // set up, which is the whole of what they can act on.
  throw new AppError("CONFIG_MISSING", {
    detail: SUPABASE_NOT_CONFIGURED_MESSAGE,
    context: { reason: "supabase_env_missing" },
  });
}

/**
 * "Missing" and "switched off" are different problems for different people:
 * one is a stale dropdown, the other is a division-office decision. They were
 * one sentence — "School not found or inactive" — which answered neither.
 */
export async function requireActiveSchool(schoolId: string): Promise<{ id: string }> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, isActive: true, deletedAt: true, isDemo: true },
  });
  if (!school || school.deletedAt) throw resourceNotFound("School");
  // A demo school outside a demo session does not exist, as far as sign-in and
  // teacher self-registration are concerned. Hiding it from the dropdown is not
  // enough on its own: the school id travels in the form, so a copied id or a
  // crafted request would still reach the training tenant. Same "Not found" as
  // a deleted school, deliberately — the answer must not reveal that a demo
  // school is there to be unlocked.
  if (school.isDemo && !(await isDemoVisible())) throw resourceNotFound("School");
  if (!school.isActive) throw new AppError("AUTH_SCHOOL_INACTIVE", { context: { schoolId } });
  return { id: school.id };
}
