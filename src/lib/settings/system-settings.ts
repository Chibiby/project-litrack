import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { DEMO_ENABLED_KEY } from "@/lib/demo/constants";
import { SUBMISSION_LOCKING_KEY } from "@/lib/unlock/constants";

/**
 * Read one global switch. Returns `null` when the row does not exist, which is
 * the normal state for a switch nobody has touched yet — callers supply the
 * default rather than this module guessing one.
 *
 * Every failure degrades to `null` instead of throwing: these are operator
 * switches read on the login path, and a settings-table hiccup must never turn
 * into a 500 on the page every user starts from.
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
    return null;
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
 * Is the training/demo tenant currently visible?
 *
 * Defaults to **off**. A database with no `demo.enabled` row has never had demo
 * mode switched on, and the safe reading of "unknown" on a public login page is
 * "do not show a fake school to real teachers".
 *
 * Wrapped in React `cache()` so a single render that filters several queries on
 * it pays one query, not several. Deliberately *not* an `unstable_cache` entry:
 * the readers that matter (`listSchoolsWithTeacherStatus`, the admin dashboard
 * aggregates) are themselves cached under their own tags, and the toggle action
 * busts those tags — adding a second TTL layer here would only widen the window
 * where the switch looks stuck.
 */
export const isDemoEnabled = cache(async (): Promise<boolean> => {
  return (await readSetting(DEMO_ENABLED_KEY)) === "true";
});

/**
 * Are the deadlines on ARAL weekly attendance and term grades being enforced?
 *
 * Defaults to **off**, which is the opposite direction from `isDemoEnabled` and
 * deliberately so. The programme asked for everything writable while the rollout
 * settles, so a database with no `submissions.locking` row ships with every
 * window open and no `UnlockGrant` lookup on any save path.
 *
 * `readSetting` degrades a failure to `null`, and `null` here means "off". That
 * is this module's rule — a settings hiccup must never become a 500 — pointed in
 * the direction that leaves teachers able to work rather than locked out of a
 * week they are in the middle of encoding.
 *
 * Individual grants are untouched while this is off. They are not consulted, and
 * they start mattering again the instant it is switched on.
 *
 * Global rather than per-school: the request was one decision about the
 * programme's rollout. A per-school variant can be added later without moving
 * what this establishes.
 *
 * `cache()` for the same reason as `isDemoEnabled` — a page that checks several
 * windows pays one query — and deliberately not an `unstable_cache` entry, so
 * the switch is never stuck behind a second TTL.
 */
export const isSubmissionLockingEnabled = cache(async (): Promise<boolean> => {
  return (await readSetting(SUBMISSION_LOCKING_KEY)) === "true";
});

/**
 * A Prisma `where` fragment that hides the demo tenant while demo mode is off.
 *
 * Spread into a School `where` rather than writing `isDemo: false` inline, so
 * that when demo mode is on the clause disappears entirely and the query plan is
 * exactly what it was before this feature existed.
 */
export function demoSchoolFilter(demoEnabled: boolean): { isDemo?: false } {
  return demoEnabled ? {} : { isDemo: false };
}
