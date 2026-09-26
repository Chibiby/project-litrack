"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { writeSetting } from "@/lib/settings/system-settings";
import { action } from "@/lib/errors/action";
import { parseInput } from "@/lib/errors/validation";
import {
  READING_LEVEL_UNLOCK_ALL_KEY,
  SUBMISSION_LOCKING_KEY,
} from "@/lib/unlock/constants";

/**
 * Accepts the shapes a checkbox, a switch and a hidden input each produce —
 * copied deliberately from `setDemoModeSchema`, because this is the same kind of
 * control on the same settings page and the two must not disagree about what
 * "on" looks like.
 */
const enabledFlag = z
  .union([
    z.boolean(),
    z.literal("true"),
    z.literal("false"),
    z.literal("on"),
    z.literal("off"),
  ])
  .transform((v) => v === true || v === "true" || v === "on");

const setSubmissionLockingSchema = z.object({ enabled: enabledFlag });

const setMonthlyReadingLevelUnlockSchema = z.object({ enabled: enabledFlag });

/**
 * Super Admin: enforce submission deadlines, or don't.
 *
 * One switch for the whole programme. While it is off, ARAL weekly attendance
 * and term grades accept a save past their deadline from anyone entitled to
 * write them, and no `UnlockGrant` is read on any save path. Turning it back on
 * restores exactly the previous behaviour — individual grants are never touched
 * by this, and start mattering again the instant it flips.
 *
 * Nothing is revalidated by tag because nothing caches the switch under one:
 * `isSubmissionLockingEnabled` is React-`cache()`d per request only, so the next
 * request sees the new value. The paths below are refreshed so the admin's own
 * page and the two surfaces that render lock state stop showing the old answer
 * to whoever is already looking at them.
 */
export const setSubmissionLocking = action(
  "setSubmissionLocking",
  async (formData: FormData): Promise<{ ok: true }> => {
    const admin = await requireUser("SUPER_ADMIN");

    const { enabled } = parseInput(setSubmissionLockingSchema, {
      enabled: formData.get("enabled"),
    });

    await writeSetting(SUBMISSION_LOCKING_KEY, enabled ? "true" : "false");

    await writeAudit({
      userId: admin.id,
      schoolId: null,
      action: AUDIT_ACTIONS.SUBMISSION_LOCKING_SET,
      resource: "SystemSetting",
      resourceId: SUBMISSION_LOCKING_KEY,
      metadata: { enabled },
    });

    revalidatePath("/admin/submissions");
    revalidatePath("/admin/settings/submissions");
    revalidatePath("/teacher/aral", "layout");
    return { ok: true };
  },
  { verb: "save the setting" }
);

/**
 * Super Admin: is the monthly reading level open to every teacher, or only
 * inside its window?
 *
 * A second switch rather than a mode of the one above, because it answers a
 * different question: `submissions.locking` decides whether deadlines are
 * enforced at all, and this decides whether ONE of those deadlines applies to
 * everybody. The programme ships with the reading level open, which is why the
 * reader (`isMonthlyReadingLevelUnlockedForAll`) treats every value except the
 * literal `"false"` — including a missing row and a failed read — as unlocked.
 *
 * That default is the reason `enabled: false` is written as the string
 * `"false"` and nothing else: an empty value, a deleted row, or a "0" all read
 * back as unlocked, so the closing half of this switch is the only one that
 * depends on the exact bytes stored.
 *
 * Audited for the same reason as `setSubmissionLocking`: while this is on, a
 * save into a closed month records no grant, so this row is the only thing that
 * ever explains why the window was open.
 */
export const setMonthlyReadingLevelUnlock = action(
  "setMonthlyReadingLevelUnlock",
  async (formData: FormData): Promise<{ ok: true }> => {
    const admin = await requireUser("SUPER_ADMIN");

    const { enabled } = parseInput(setMonthlyReadingLevelUnlockSchema, {
      enabled: formData.get("enabled"),
    });

    await writeSetting(READING_LEVEL_UNLOCK_ALL_KEY, enabled ? "true" : "false");

    await writeAudit({
      userId: admin.id,
      schoolId: null,
      action: AUDIT_ACTIONS.READING_LEVEL_UNLOCK_ALL_SET,
      resource: "SystemSetting",
      resourceId: READING_LEVEL_UNLOCK_ALL_KEY,
      metadata: { enabled },
    });

    revalidatePath("/admin/submissions");
    revalidatePath("/admin/settings/submissions");
    revalidatePath("/teacher/aral", "layout");
    return { ok: true };
  },
  { verb: "save the setting" }
);
