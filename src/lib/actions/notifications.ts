"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { action } from "@/lib/errors/action";
import { resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import {
  getUnreadAralAssignments,
  getUnreadUnlockGrants,
  markNotificationsRead,
  markUnlockAlertsRead,
  type AralAssignmentAlert,
  type UnlockAlert,
} from "@/lib/notifications";

const dismissSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Nothing to dismiss").max(50),
});

/**
 * The tutor's unread ARAL designations.
 *
 * Called from the client after the shell has painted, not awaited in the teacher
 * layout: everything that layout awaits blocks the sidebar and header for every
 * `/teacher` route, and its own loading boundary is chrome-less. A courtesy alert
 * is not worth a longer blank-shell flash on every navigation.
 *
 * Returns an empty list rather than an error for anyone who cannot hold a
 * designation — a Super Admin impersonating a teacher has no ARAL learners of
 * their own, and that is not a failure worth surfacing.
 *
 * Deliberately NOT wrapped in `action()`: the client indexes this with
 * `Awaited<ReturnType<typeof fetchAralAssignmentAlerts>>[number]` and treats the
 * resolved value as the alert array itself (`rows.length`, `rows.map`). Wrapping
 * would change the resolved type to `AralAssignmentAlert[] | ActionFailure`,
 * breaking that shape for no benefit — a failed read here already degrades to
 * "no alert" by design, never a message shown to the teacher, so there is
 * nothing for the wrapper's error handling to improve on.
 */
export async function fetchAralAssignmentAlerts(): Promise<AralAssignmentAlert[]> {
  const user = await requireUser("TEACHER");
  if (user.role !== "TEACHER" || !user.schoolId) return [];

  try {
    return await getUnreadAralAssignments({ id: user.id, schoolId: user.schoolId });
  } catch (err) {
    // A bell that cannot load must not break the page it sits on.
    console.error("[notifications] alert read failed:", err);
    return [];
  }
}

/** Mark the alerts the tutor just saw as read. Scoped to them; ids are untrusted. */
export const dismissAralAssignmentAlerts = action(
  "dismissAralAssignmentAlerts",
  async (ids: string[]): Promise<{ ok: true; data: { dismissed: number } }> => {
    const user = await requireUser("TEACHER");
    if (!user.schoolId) throw resourceNotFound("Notification");

    const { ids: parsedIds } = parseInput(dismissSchema, { ids });

    const dismissed = await markNotificationsRead({
      recipientId: user.id,
      schoolId: user.schoolId,
      ids: parsedIds,
    });
    return { ok: true, data: { dismissed } };
  },
  { verb: "dismiss those alerts" }
);

/**
 * The teacher's unread, still-live unlock alerts.
 *
 * Same call posture as `fetchAralAssignmentAlerts`: called client-side after
 * the shell paints, never awaited in the teacher layout, and never an error
 * for anyone who cannot hold a grant — a Super Admin impersonating a teacher
 * has none of their own.
 *
 * Deliberately NOT wrapped in `action()`, for the same reason as
 * `fetchAralAssignmentAlerts`: the client relies on the resolved value being
 * the alert array itself.
 */
export async function fetchUnlockAlerts(): Promise<UnlockAlert[]> {
  const user = await requireUser("TEACHER");
  if (user.role !== "TEACHER" || !user.schoolId) return [];

  try {
    return await getUnreadUnlockGrants({ id: user.id, schoolId: user.schoolId });
  } catch (err) {
    // A bell that cannot load must not break the page it sits on.
    console.error("[notifications] unlock alert read failed:", err);
    return [];
  }
}

/** Mark the unlock alerts the teacher just saw as read. Scoped to them; ids are untrusted. */
export const dismissUnlockAlerts = action(
  "dismissUnlockAlerts",
  async (ids: string[]): Promise<{ ok: true; data: { dismissed: number } }> => {
    const user = await requireUser("TEACHER");
    if (!user.schoolId) throw resourceNotFound("Notification");

    const { ids: parsedIds } = parseInput(dismissSchema, { ids });

    const dismissed = await markUnlockAlertsRead({
      recipientId: user.id,
      schoolId: user.schoolId,
      ids: parsedIds,
    });
    return { ok: true, data: { dismissed } };
  },
  { verb: "dismiss those alerts" }
);
