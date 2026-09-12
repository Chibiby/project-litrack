import "server-only";
import { cache } from "react";
import type { UnlockScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSubmissionLockingEnabled } from "@/lib/settings/system-settings";

/**
 * Reads for `UnlockGrant` and `SchoolUnlockGrant` — the permission that lets one
 * person, or every teacher in a school, write inside one already-closed editing
 * window.
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
 * - `MONTHLY_READING_LEVEL` — a month anchor `YYYY-MM-01`.
 *
 * All are already the natural key at their lock site, which is why this is one
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

/**
 * The one live school-wide grant for this school/scope/target, or `null`.
 *
 * A school-wide grant covers every teacher in the school for one window — the
 * `@@unique([schoolId, scope, targetKey])` constraint means there is at most
 * one row to consider, same shape as `findActiveUnlock`.
 *
 * `schoolId` must come from the caller's session (`user.schoolId`), never from
 * client input — it is the tenant boundary for this read.
 */
export const findActiveSchoolUnlock = cache(
  async function findActiveSchoolUnlock(
    schoolId: string,
    scope: UnlockScope,
    targetKey: UnlockTargetKey
  ): Promise<ActiveGrant | null> {
    try {
      const grant = await prisma.schoolUnlockGrant.findFirst({
        where: {
          schoolId,
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
      // Fail closed, same reasoning as `findActiveUnlock`.
      console.error("[unlock] school grant lookup failed:", err);
      return null;
    }
  }
);

/** `findActiveUnlock` as a boolean, for the lock sites that only need the verdict. */
export async function hasActiveUnlock(
  userId: string,
  scope: UnlockScope,
  targetKey: UnlockTargetKey
): Promise<boolean> {
  return (await findActiveUnlock(userId, scope, targetKey)) !== null;
}

/**
 * Every live grant this user holds for one scope, keyed by target, unioned with
 * every live school-wide grant for their school.
 *
 * The weekly attendance grid and the term sheet each render one window at a
 * time, but the term sheet's tab strip shows all three terms' locked state at
 * once — one query for the set beats three for the members.
 *
 * `schoolId` comes from the caller's session. `null` means the user has no
 * school and skips the school-wide read entirely — there is no school to hold a
 * grant.
 */
export async function listActiveUnlockKeys({
  userId,
  schoolId,
  scope,
}: {
  userId: string;
  schoolId: string | null;
  scope: UnlockScope;
}): Promise<Set<string>> {
  const [personalKeys, schoolKeys] = await Promise.all([
    listPersonalUnlockKeys(userId, scope),
    schoolId ? listSchoolUnlockKeys(schoolId, scope) : Promise.resolve(new Set<string>()),
  ]);
  return new Set([...personalKeys, ...schoolKeys]);
}

async function listPersonalUnlockKeys(
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

async function listSchoolUnlockKeys(
  schoolId: string,
  scope: UnlockScope
): Promise<Set<string>> {
  try {
    const grants = await prisma.schoolUnlockGrant.findMany({
      where: {
        schoolId,
        scope,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { targetKey: true },
    });
    return new Set(grants.map((g) => g.targetKey));
  } catch (err) {
    console.error("[unlock] school grant list failed:", err);
    return new Set();
  }
}

/**
 * "The date says this window is closed — may this user write into it anyway?"
 *
 * The single question the two save paths ask, and the only place they should ask
 * it. Call it AFTER the deadline test, never instead of one: an in-window save
 * is the overwhelmingly common case and must not pay for a settings read or a
 * grant lookup to learn what the date already said.
 *
 * When submission locking is switched off this returns writable **without
 * touching `UnlockGrant` or `SchoolUnlockGrant` at all** — no query, no grant,
 * nothing to revoke. When it is on, the personal and school-wide reads run
 * together in one `Promise.all`, never sequentially, and a personal grant wins
 * for attribution when both exist — the person's own grant is the more specific
 * fact about why they could write.
 *
 * `grantId` is non-null only when a grant is what opened the window, so the
 * caller's audit row still distinguishes "written under a grant" from "written
 * because nothing was locked". `grantKind` says which table that id came from.
 */
export type WindowWriteVerdict =
  | { writable: true; grantId: string | null; grantKind: "user" | "school" | null }
  | { writable: false; grantId: null; grantKind: null };

export async function canWriteWindow({
  userId,
  schoolId,
  scope,
  targetKey,
}: {
  userId: string;
  schoolId: string | null;
  scope: UnlockScope;
  targetKey: UnlockTargetKey;
}): Promise<WindowWriteVerdict> {
  if (!(await isSubmissionLockingEnabled())) {
    return { writable: true, grantId: null, grantKind: null };
  }
  const [personalGrant, schoolGrant] = await Promise.all([
    findActiveUnlock(userId, scope, targetKey),
    schoolId ? findActiveSchoolUnlock(schoolId, scope, targetKey) : Promise.resolve(null),
  ]);
  if (personalGrant) {
    return { writable: true, grantId: personalGrant.id, grantKind: "user" };
  }
  if (schoolGrant) {
    return { writable: true, grantId: schoolGrant.id, grantKind: "school" };
  }
  return { writable: false, grantId: null, grantKind: null };
}

/**
 * The same question for a page that renders several windows at once.
 *
 * `lockingEnabled: false` means nothing is locked and `unlockedKeys` is empty —
 * empty because no grant was read, not because the user holds none. A caller
 * must branch on the flag first; treating the empty set as "everything locked"
 * would invert the switch on exactly the surfaces it exists to open.
 */
export type UnlockState = {
  lockingEnabled: boolean;
  unlockedKeys: Set<string>;
};

export async function readUnlockState({
  userId,
  schoolId,
  scope,
}: {
  userId: string;
  schoolId: string | null;
  scope: UnlockScope;
}): Promise<UnlockState> {
  if (!(await isSubmissionLockingEnabled())) {
    return { lockingEnabled: false, unlockedKeys: new Set() };
  }
  return {
    lockingEnabled: true,
    unlockedKeys: await listActiveUnlockKeys({ userId, schoolId, scope }),
  };
}
