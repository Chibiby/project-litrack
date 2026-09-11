"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  getUnreadAralAssignments,
  getUnreadUnlockGrants,
  markNotificationsRead,
  markUnlockAlertsRead,
  type AralAssignmentAlert,
  type UnlockAlert,
} from "@/lib/notifications";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

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

const dismissSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Nothing to dismiss").max(50),
});

/** Mark the alerts the tutor just saw as read. Scoped to them; ids are untrusted. */
export async function dismissAralAssignmentAlerts(
  ids: string[]
): Promise<ActionResult<{ dismissed: number }>> {
  const user = await requireUser("TEACHER");
  if (!user.schoolId) return { ok: false, error: "Not found" };

  const parsed = dismissSchema.safeParse({ ids });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const dismissed = await markNotificationsRead({
    recipientId: user.id,
    schoolId: user.schoolId,
    ids: parsed.data.ids,
  });
  return { ok: true, data: { dismissed } };
}

/**
 * The teacher's unread, still-live unlock alerts.
 *
 * Same call posture as `fetchAralAssignmentAlerts`: called client-side after
 * the shell paints, never awaited in the teacher layout, and never an error
 * for anyone who cannot hold a grant — a Super Admin impersonating a teacher
 * has none of their own.
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
export async function dismissUnlockAlerts(
  ids: string[]
): Promise<ActionResult<{ dismissed: number }>> {
  const user = await requireUser("TEACHER");
  if (!user.schoolId) return { ok: false, error: "Not found" };

  const parsed = dismissSchema.safeParse({ ids });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const dismissed = await markUnlockAlertsRead({
    recipientId: user.id,
    schoolId: user.schoolId,
    ids: parsed.data.ids,
  });
  return { ok: true, data: { dismissed } };
}
