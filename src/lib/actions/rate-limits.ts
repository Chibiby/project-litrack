"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDeveloperAdmin } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { action } from "@/lib/errors/action";
import { parseInput } from "@/lib/errors/validation";
import { writeSetting } from "@/lib/settings/system-settings";
import { forgetRateLimitPause } from "@/lib/rate-limit";
import { RATE_LIMITS_PAUSED_KEY } from "@/lib/rate-limits/catalog";
import { ADMIN_ROUTES } from "@/lib/routes/admin";

const pausedSchema = z.object({ paused: z.enum(["true", "false"]) });

/**
 * Developer Admin: pause or resume every rate limit.
 *
 * Paused, every limit allows every attempt, so a large group on one network
 * can sign up and sign in at once. That also removes the protection against
 * password guessing, so the page asks for this to be turned back on after.
 * Each isolate re-reads the switch within 10 seconds.
 *
 * Global, no tenant. Audited because the row is the only record of when sign-in
 * protection was off.
 */
export const setRateLimitsPaused = action(
  "setRateLimitsPaused",
  async (formData: FormData): Promise<{ ok: true }> => {
    const admin = await requireDeveloperAdmin("rate limits");
    const { paused } = parseInput(pausedSchema, { paused: formData.get("paused") });

    await writeSetting(RATE_LIMITS_PAUSED_KEY, paused);
    forgetRateLimitPause();

    await writeAudit({
      userId: admin.id,
      schoolId: null,
      action: AUDIT_ACTIONS.RATE_LIMITS_PAUSE_SET,
      resource: "SystemSetting",
      resourceId: RATE_LIMITS_PAUSED_KEY,
      metadata: { paused: paused === "true" },
    });
    revalidatePath(ADMIN_ROUTES.rateLimits);
    return { ok: true };
  },
  { verb: "save the rate limit switch" }
);
