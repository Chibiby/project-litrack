import "server-only";
import { cache } from "react";
import type { UnlockScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Reads for `UnlockGrant` — the permission that lets one person write inside one
 * already-closed editing window.
 *
 * Two rules govern everything here:
 *
 * 1. **A grant only ever widens access.** Every caller asks "is this window open
 *    *anyway*?" first and only consults a grant when the answer is no. Nothing
 *    in this module can close a window that was open.
 * 2. **Fail closed.** A grant lookup that throws returns "no grant", so the lock
 *    holds. The alternative — treating a database error as permission — would
 *    turn a transient pool timeout into an open editing window.
 *
 * Wrapped in React `cache()` so a page that renders the same grant check in a
 * server component and then re-derives it for a child pays one query per
 * request, matching `getCurrentUser`.
 */

/**
 * The string that identifies the window a grant applies to.
 *
 * - `ARAL_WEEKLY_ATTENDANCE` — the week's Monday as a local `YYYY-MM-DD` key,
 *   the same string `saveAralWeeklyAttendance` receives and the weekly grid
 *   navigates by.
 * - `TERM_GRADES` — a `TermPeriod` name (`FIRST` / `SECOND` / `THIRD`).
 *
 * Both are already the natural key at their lock site, which is why this is one
 * string rather than a union of typed columns.
 */
export type UnlockTargetKey = string;

export type ActiveGrant = {
  id: string;
  expiresAt: Date;
  grantedByName: string | null;
};

/**
 * The one live grant for this user/scope/target, or `null`.
 *
 * "Live" means not revoked and not expired. The `@@unique([userId, scope,
 * targetKey])` constraint means there is at most one row to consider, so this
 * never has to reason about which of several grants wins.
 */
export const findActiveUnlock = cache(async function findActiveUnlock(
  userId: string,
  scope: UnlockScope,
  targetKey: UnlockTargetKey
): Promise<ActiveGrant | null> {
  try {
    const grant = await prisma.unlockGrant.findFirst({
      where: {
        userId,
        scope,
        targetKey,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        expiresAt: true,
        grantedBy: { select: { fullName: true } },
      },
    });
    if (!grant) return null;
    return {
      id: grant.id,
      expiresAt: grant.expiresAt,
      grantedByName: grant.grantedBy?.fullName ?? null,
    };
  } catch (err) {
    // Fail closed. Logged rather than thrown so a lookup failure degrades to
    // "the window is still locked" instead of a 500 on a save.
    console.error("[unlock] grant lookup failed:", err);
    return null;
  }
});

/** `findActiveUnlock` as a boolean, for the lock sites that only need the verdict. */
export async function hasActiveUnlock(
  userId: string,
  scope: UnlockScope,
  targetKey: UnlockTargetKey
): Promise<boolean> {
  return (await findActiveUnlock(userId, scope, targetKey)) !== null;
}

/**
 * Every live grant this user holds for one scope, keyed by target.
 *
 * The weekly attendance grid and the term sheet each render one window at a
 * time, but the term sheet's tab strip shows all three terms' locked state at
 * once — one query for the set beats three for the members.
 */
export async function listActiveUnlockKeys(
  userId: string,
  scope: UnlockScope
): Promise<Set<string>> {
  try {
    const grants = await prisma.unlockGrant.findMany({
      where: {
        userId,
        scope,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { targetKey: true },
    });
    return new Set(grants.map((g) => g.targetKey));
  } catch (err) {
    console.error("[unlock] grant list failed:", err);
    return new Set();
  }
}
