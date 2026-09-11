import "server-only";
import { canWriteWindow, listActiveUnlockKeys } from "@/lib/unlock/grants";
import {
  isMonthlyReadingLevelUnlockedForAll,
  isSubmissionLockingEnabled,
} from "@/lib/settings/system-settings";
import { readingLevelDeadline } from "@/lib/month-range";

/**
 * The single place that answers "may this person write this month's reading
 * level?" — the action and the page both call through here so they can never
 * disagree about a window's state.
 *
 * Precedence, in this order and for this reason — cheapest and most common
 * case first, so an ordinary in-window save pays zero extra queries:
 *
 * 1. `today <= readingLevelDeadline(monthKey)` — writable, **no query at
 *    all**. The overwhelmingly common save is inside the window and must not
 *    pay for a settings read to learn what the date already says.
 * 2. `!isSubmissionLockingEnabled()` — writable. The existing master switch;
 *    when it is off nothing in this module or `UnlockGrant` is consulted.
 * 3. `isMonthlyReadingLevelUnlockedForAll()` — writable. The new
 *    programme-wide switch, defaulting ON, so this ships inert until an
 *    operator turns it off.
 * 4. `canWriteWindow(... scope: "MONTHLY_READING_LEVEL")` — a personal or
 *    school-wide grant, or refusal.
 *
 * Failure behavior differs by rung, and is not uniformly "closed":
 *
 * - Rung 1 issues no query, so there is nothing to fail.
 * - Rungs 2 and 3 call `isSubmissionLockingEnabled` / `isMonthlyReadingLevel-
 *   UnlockedForAll`, which read through `readSetting` — and `readSetting`
 *   itself degrades a failed read to `null` rather than throwing. `null` reads
 *   as "locking not enabled" for rung 2 and as "unlocked for all" for rung 3,
 *   so a settings-table hiccup at either rung fails OPEN, on purpose: it must
 *   leave every teacher able to write rather than silently locking the whole
 *   programme out the instant Postgres hiccups. See the comment on
 *   `isMonthlyReadingLevelUnlockedForAll` in `system-settings.ts`.
 * - Rung 4 (`canWriteWindow`) and any other unexpected throw are caught by the
 *   `try`/`catch` below, which fails CLOSED: a lookup that actually throws
 *   must never turn a transient error into an open editing window.
 */

export type MonthlyReadingLevelWindowVerdict = {
  writable: boolean;
  reason: "in-window" | "locking-off" | "program-unlocked" | "granted" | "locked";
  deadline: Date;
  grantId: string | null;
  grantKind: "user" | "school" | null;
};

export async function resolveMonthlyReadingLevelWindow({
  userId,
  schoolId,
  monthKey,
  today,
}: {
  userId: string;
  schoolId: string | null;
  monthKey: string;
  today: Date;
}): Promise<MonthlyReadingLevelWindowVerdict> {
  const deadline = readingLevelDeadline(monthKey);

  try {
    // Rung 1: no query at all.
    if (today <= deadline) {
      return { writable: true, reason: "in-window", deadline, grantId: null, grantKind: null };
    }

    // Rung 2: the master switch.
    if (!(await isSubmissionLockingEnabled())) {
      return { writable: true, reason: "locking-off", deadline, grantId: null, grantKind: null };
    }

    // Rung 3: the programme-wide switch, ON by default.
    if (await isMonthlyReadingLevelUnlockedForAll()) {
      return {
        writable: true,
        reason: "program-unlocked",
        deadline,
        grantId: null,
        grantKind: null,
      };
    }

    // Rung 4: a personal or school-wide grant.
    const verdict = await canWriteWindow({
      userId,
      schoolId,
      scope: "MONTHLY_READING_LEVEL",
      targetKey: monthKey,
    });
    if (verdict.writable) {
      return {
        writable: true,
        reason: "granted",
        deadline,
        grantId: verdict.grantId,
        grantKind: verdict.grantKind,
      };
    }
    return { writable: false, reason: "locked", deadline, grantId: null, grantKind: null };
  } catch (err) {
    // Fail closed, same reasoning as `grants.ts`: a lookup that throws must
    // never turn a transient error into an open editing window.
    console.error("[unlock] monthly reading level window resolution failed:", err);
    return { writable: false, reason: "locked", deadline, grantId: null, grantKind: null };
  }
}

/**
 * The same question for a page that renders the whole lock state at once —
 * the month picker's banner, or a settings surface — rather than testing one
 * month's writability.
 *
 * `lockingEnabled: false` means nothing is locked and both the programme
 * switch and the unlocked-months list are meaningless placeholders — a caller
 * must branch on the flag first, exactly as `readUnlockState` in `grants.ts`
 * requires for its `unlockedKeys`.
 */
export type MonthlyReadingLevelLockState = {
  lockingEnabled: boolean;
  programUnlockAll: boolean;
  unlockedMonths: string[];
};

export async function readMonthlyReadingLevelLockState({
  userId,
  schoolId,
}: {
  userId: string;
  schoolId: string | null;
}): Promise<MonthlyReadingLevelLockState> {
  try {
    if (!(await isSubmissionLockingEnabled())) {
      return { lockingEnabled: false, programUnlockAll: false, unlockedMonths: [] };
    }
    if (await isMonthlyReadingLevelUnlockedForAll()) {
      return { lockingEnabled: true, programUnlockAll: true, unlockedMonths: [] };
    }
    const keys = await listActiveUnlockKeys({
      userId,
      schoolId,
      scope: "MONTHLY_READING_LEVEL",
    });
    return { lockingEnabled: true, programUnlockAll: false, unlockedMonths: [...keys] };
  } catch (err) {
    // Fail closed on the read path too, same as `readUnlockState`.
    console.error("[unlock] monthly reading level lock state read failed:", err);
    return { lockingEnabled: true, programUnlockAll: false, unlockedMonths: [] };
  }
}
