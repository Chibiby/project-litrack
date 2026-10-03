import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";
import {
  MOSY_SUBMISSION_LOCK_KEY,
  READING_LEVEL_UNLOCK_ALL_KEY,
  SUBMISSION_LOCKING_KEY,
} from "@/lib/unlock/constants";

/**
 * Read one global switch. Returns `null` when the row does not exist, which is
 * the normal state for a switch nobody has touched yet — callers supply the
 * default rather than this module guessing one.
 *
 * A failed read is NOT the same as an absent row, so it throws
 * `AppError("DB_UNAVAILABLE")` instead of returning `null`. Collapsing the two
 * made every lock guard fail toward its default when the database hiccuped:
 * submission locking read as off and the reading-level window read as open, so a
 * transient error silently lifted the locks. Write-path guards let the error
 * propagate to the `action()` wrapper, which reports it; nothing here guesses.
 */
export async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    return row?.value ?? null;
  } catch (err) {
    console.error(`[system-settings] read ${key} failed:`, err);
    throw new AppError("DB_UNAVAILABLE", {
      cause: err,
      detail: `SystemSetting read failed for key ${key}`,
      context: { settingKey: key },
    });
  }
}

/** Upsert one global switch. Unlike the read, a failed write must surface. */
export async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}


/**
 * Are the deadlines on ARAL weekly attendance and term grades being enforced?
 *
 * Defaults to **off**, which is the opposite direction from the reading-level
 * deliberately so. The programme asked for everything writable while the rollout
 * settles, so a database with no `submissions.locking` row ships with every
 * window open and no `UnlockGrant` lookup on any save path.
 *
 * A missing row reads as "off". A FAILED read throws (`readSetting`), so a
 * database hiccup can never be mistaken for "locking is off" and lift the
 * deadlines; write-path callers fail closed through the action wrapper.
 *
 * Individual grants are untouched while this is off. They are not consulted, and
 * they start mattering again the instant it is switched on.
 *
 * Global rather than per-school: the request was one decision about the
 * programme's rollout. A per-school variant can be added later without moving
 * what this establishes.
 *
 * `cache()` so a page that checks several
 * windows pays one query — and deliberately not an `unstable_cache` entry, so
 * the switch is never stuck behind a second TTL.
 */
export const isSubmissionLockingEnabled = cache(async (): Promise<boolean> => {
  return (await readSetting(SUBMISSION_LOCKING_KEY)) === "true";
});

/**
 * Is the monthly reading level window unlocked for every teacher, programme-wide?
 *
 * Defaults to **ON** — the opposite direction from `isSubmissionLockingEnabled`
 * and deliberately so. A database with no `submissions.readingLevelUnlockAll`
 * row has never had reading level closed off, so "unknown" reads as "still
 * open" rather than "just got locked".
 *
 * Only an ABSENT row defaults to on (`null !== "false"`). A failed read throws
 * from `readSetting` rather than reading as on, so a database error cannot
 * unlock the reading-level window for everyone. `resolveMonthlyReadingLevelWindow`
 * catches the throw and answers "locked"; the lock-state reader does likewise.
 *
 * `cache()` for the same reason as `isSubmissionLockingEnabled` — one query per
 * render, not per window checked — and deliberately not `unstable_cache`, so the
 * switch is never stuck behind a second TTL.
 */
export const isMonthlyReadingLevelUnlockedForAll = cache(
  async (): Promise<boolean> => {
    return (await readSetting(READING_LEVEL_UNLOCK_ALL_KEY)) !== "false";
  }
);

/**
 * Are MOSY Report submissions locked?
 *
 * Defaults to **LOCKED**: the owner wants MOSY closed until a Super Admin opens
 * it. Only the exact stored value `"false"` unlocks. A missing row reads as
 * locked; a failed read throws, so the save is refused either way.
 *
 * Only saves are gated; viewing and exporting the report stay open.
 *
 * `cache()` for one query per render, deliberately not `unstable_cache`, so the
 * switch is never stuck behind a second TTL.
 */
export const isMosySubmissionLocked = cache(async (): Promise<boolean> => {
  return (await readSetting(MOSY_SUBMISSION_LOCK_KEY)) !== "false";
});

/**
 * Display-path variants of the three readers above, for pages that only RENDER
 * lock state. A failed settings read must not turn a read-only view into an
 * error page, so these degrade to the fail-closed answer (locked / locking on /
 * nothing unlocked) and `reportError` once per render.
 *
 * NEVER call these from a write path. A guard that decides whether a save may
 * proceed must use the throwing readers, so a failed read cannot let a write
 * through; these exist only so the surrounding page still renders.
 */
export async function readForDisplay<T>(
  read: () => Promise<T>,
  failClosed: T,
  route: string
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof AppError && err.code === "DB_UNAVAILABLE") {
      reportError(err, { route });
      return failClosed;
    }
    throw err;
  }
}

/** Display-only `isSubmissionLockingEnabled`; a failed read reads as ON (locked). */
export const isSubmissionLockingEnabledForDisplay = cache(
  (): Promise<boolean> =>
    readForDisplay(isSubmissionLockingEnabled, true, "settings/submission-locking")
);

/** Display-only `isMonthlyReadingLevelUnlockedForAll`; a failed read reads as NOT unlocked. */
export const isMonthlyReadingLevelUnlockedForAllForDisplay = cache(
  (): Promise<boolean> =>
    readForDisplay(isMonthlyReadingLevelUnlockedForAll, false, "settings/reading-level-unlock-all")
);

/** Display-only `isMosySubmissionLocked`; a failed read reads as locked. */
export const isMosySubmissionLockedForDisplay = cache(
  (): Promise<boolean> =>
    readForDisplay(isMosySubmissionLocked, true, "settings/mosy-lock")
);

/**
 * A Prisma `where` fragment that hides the demo tenant from a request that has
 * no demo session.
 *
 * Spread into a School `where` rather than writing `isDemo: false` inline, so
 * that inside a demo session the clause disappears entirely and the query plan
 * is exactly what it was before this feature existed.
 *
 * The argument comes from `isDemoVisible()` (`@/lib/demo/session`), never from
 * a settings row: demo visibility is a property of the browser asking, not of
 * the deployment.
 */
export function demoSchoolFilter(demoVisible: boolean): { isDemo?: false } {
  return demoVisible ? {} : { isDemo: false };
}
