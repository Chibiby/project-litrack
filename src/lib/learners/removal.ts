/**
 * The removal clock. A teacher "Remove" sets `Learner.archivedAt`; 30 days later
 * the nightly retention job soft-deletes the learner (`deletedAt`). Pure on
 * purpose: client components import this to show the expiry date, so it has no
 * `server-only` and no runtime Prisma import.
 */

/** Days a removed learner stays restorable by their teacher. */
export const REMOVAL_WINDOW_DAYS = 30;

/**
 * 00:00 Asia/Manila on 2026-10-14. Removals recorded before it count from it, so
 * learners archived before the Remove release still get the full 30 days. This is
 * a constant, never a data update: no row is rewritten to apply it.
 */
export const REMOVAL_CLOCK_START = new Date("2026-10-13T16:00:00.000Z");

const WINDOW_MS = REMOVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** When a removal made at `archivedAt` stops being restorable by the teacher. */
export function removalExpiresAt(archivedAt: Date): Date {
  const start = Math.max(archivedAt.getTime(), REMOVAL_CLOCK_START.getTime());
  return new Date(start + WINDOW_MS);
}

/**
 * Removals older than this have expired: `archivedAt < cutoff`. Null while
 * nothing can have expired yet (the cutoff has not passed the clock start).
 */
export function removalExpiryCutoff(now: Date): Date | null {
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  return cutoff.getTime() <= REMOVAL_CLOCK_START.getTime() ? null : cutoff;
}

/**
 * `archivedAt` filter for the teacher's Removed list: still inside the window.
 * Before the cutoff exists nothing can have expired, so any removal matches.
 */
export function removedListArchivedAtFilter(now: Date): { not: null; gte?: Date } {
  const cutoff = removalExpiryCutoff(now);
  return cutoff ? { not: null, gte: cutoff } : { not: null };
}

export function isRemovalExpired(archivedAt: Date, now: Date): boolean {
  const cutoff = removalExpiryCutoff(now);
  return cutoff !== null && archivedAt.getTime() < cutoff.getTime();
}
