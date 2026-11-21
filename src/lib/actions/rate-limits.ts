"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDeveloperAdmin } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { action } from "@/lib/errors/action";
import { parseInput } from "@/lib/errors/validation";
import { readSetting, writeSetting } from "@/lib/settings/system-settings";
import { forgetRateLimitPause } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors/app-error";
import {
  RATE_LIMITS,
  RATE_LIMITS_PAUSED_KEY,
  RATE_LIMIT_BOUNDS,
  RATE_LIMIT_OVERRIDES_KEY,
  isRateLimitId,
  parseRateLimitOverrides,
  type RateLimitId,
  type RateLimitOverrides,
} from "@/lib/rate-limits/catalog";
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

const MINUTE_MS = 60_000;

const rateLimitSchema = z.object({
  id: z.string().min(1).max(64),
  limit: z.coerce
    .number({ message: "Enter a whole number of attempts." })
    .int("Enter a whole number of attempts.")
    .min(RATE_LIMIT_BOUNDS.minLimit, "Allow at least 1 attempt.")
    .max(RATE_LIMIT_BOUNDS.maxLimit, "Allow at most 10,000 attempts."),
  windowMinutes: z.coerce
    .number({ message: "Enter the time in whole minutes." })
    .int("Enter the time in whole minutes.")
    .min(RATE_LIMIT_BOUNDS.minWindowMinutes, "The time must be at least 1 minute.")
    .max(RATE_LIMIT_BOUNDS.maxWindowMinutes, "The time can be at most 1,440 minutes (one day)."),
});

const resetSchema = z.object({ id: z.string().min(1).max(64) });

function knownId(id: string): RateLimitId {
  if (!isRateLimitId(id)) throw new AppError("NOT_FOUND", { detail: `Unknown rate limit: ${id}` });
  return id;
}

async function saveOverrides(overrides: RateLimitOverrides): Promise<void> {
  await writeSetting(RATE_LIMIT_OVERRIDES_KEY, JSON.stringify(overrides));
  forgetRateLimitPause();
  revalidatePath(ADMIN_ROUTES.rateLimits);
}

/**
 * Developer Admin: change one rate limit. A value equal to the default removes
 * the override instead of storing it, so the page shows it as the default.
 * Reaches every server within about 10 seconds. Audited with the old and new
 * numbers, because a raised sign-in limit weakens password-guessing protection.
 */
export const setRateLimit = action(
  "setRateLimit",
  async (formData: FormData): Promise<{ ok: true }> => {
    const admin = await requireDeveloperAdmin("rate limits");
    const input = parseInput(rateLimitSchema, {
      id: formData.get("id"),
      limit: formData.get("limit"),
      windowMinutes: formData.get("windowMinutes"),
    });
    const id = knownId(input.id);
    const windowMs = input.windowMinutes * MINUTE_MS;
    const overrides = parseRateLimitOverrides(await readSetting(RATE_LIMIT_OVERRIDES_KEY));
    const before = overrides[id] ?? {
      limit: RATE_LIMITS[id].limit,
      windowMs: RATE_LIMITS[id].windowMs,
    };

    if (input.limit === RATE_LIMITS[id].limit && windowMs === RATE_LIMITS[id].windowMs) {
      delete overrides[id];
    } else {
      overrides[id] = { limit: input.limit, windowMs };
    }
    await saveOverrides(overrides);

    await writeAudit({
      userId: admin.id,
      schoolId: null,
      action: AUDIT_ACTIONS.RATE_LIMIT_SET,
      resource: "SystemSetting",
      resourceId: RATE_LIMIT_OVERRIDES_KEY,
      metadata: { id, from: before, to: { limit: input.limit, windowMs } },
    });
    return { ok: true };
  },
  { verb: "save the rate limit" }
);

/** Developer Admin: put one rate limit back to its default. */
export const resetRateLimit = action(
  "resetRateLimit",
  async (formData: FormData): Promise<{ ok: true }> => {
    const admin = await requireDeveloperAdmin("rate limits");
    const id = knownId(parseInput(resetSchema, { id: formData.get("id") }).id);
    const overrides = parseRateLimitOverrides(await readSetting(RATE_LIMIT_OVERRIDES_KEY));
    const before = overrides[id] ?? null;
    delete overrides[id];
    await saveOverrides(overrides);

    await writeAudit({
      userId: admin.id,
      schoolId: null,
      action: AUDIT_ACTIONS.RATE_LIMIT_SET,
      resource: "SystemSetting",
      resourceId: RATE_LIMIT_OVERRIDES_KEY,
      metadata: { id, from: before, reset: true },
    });
    return { ok: true };
  },
  { verb: "reset the rate limit" }
);

/** Developer Admin: put every rate limit back to its default. */
export const resetAllRateLimits = action(
  "resetAllRateLimits",
  async (): Promise<{ ok: true }> => {
    const admin = await requireDeveloperAdmin("rate limits");
    const before = parseRateLimitOverrides(await readSetting(RATE_LIMIT_OVERRIDES_KEY));
    await saveOverrides({});

    await writeAudit({
      userId: admin.id,
      schoolId: null,
      action: AUDIT_ACTIONS.RATE_LIMIT_SET,
      resource: "SystemSetting",
      resourceId: RATE_LIMIT_OVERRIDES_KEY,
      metadata: { resetAll: true, changed: Object.keys(before).length },
    });
    return { ok: true };
  },
  { verb: "reset the rate limits" }
);
