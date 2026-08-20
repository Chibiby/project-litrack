"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  getUnreadAralAssignments,
  markNotificationsRead,
  type AralAssignmentAlert,
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
