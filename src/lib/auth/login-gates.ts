import "server-only";
import { prisma } from "@/lib/prisma";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";

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
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!school || school.deletedAt) throw resourceNotFound("School");
  if (!school.isActive) throw new AppError("AUTH_SCHOOL_INACTIVE", { context: { schoolId } });
  return { id: school.id };
}
