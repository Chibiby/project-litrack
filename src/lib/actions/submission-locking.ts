"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { writeSetting } from "@/lib/settings/system-settings";
import { SUBMISSION_LOCKING_KEY } from "@/lib/unlock/constants";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Accepts the shapes a checkbox, a switch and a hidden input each produce —
 * copied deliberately from `setDemoModeSchema`, because this is the same kind of
 * control on the same settings page and the two must not disagree about what
 * "on" looks like.
 */
const setSubmissionLockingSchema = z.object({
  enabled: z
    .union([
      z.boolean(),
      z.literal("true"),
      z.literal("false"),
      z.literal("on"),
      z.literal("off"),
    ])
    .transform((v) => v === true || v === "true" || v === "on"),
});

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
export async function setSubmissionLocking(
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = setSubmissionLockingSchema.safeParse({
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  try {
    await writeSetting(
      SUBMISSION_LOCKING_KEY,
      parsed.data.enabled ? "true" : "false"
    );
  } catch (err) {
    console.error("[submissions] setSubmissionLocking write failed:", err);
    return { ok: false, error: "Could not save the setting. Please try again." };
  }

  await writeAudit({
    userId: admin.id,
    schoolId: null,
    action: AUDIT_ACTIONS.SUBMISSION_LOCKING_SET,
    resource: "SystemSetting",
    resourceId: SUBMISSION_LOCKING_KEY,
    metadata: { enabled: parsed.data.enabled },
  });

  revalidatePath("/admin/settings/submissions");
  revalidatePath("/teacher/aral", "layout");
  return { ok: true };
}
