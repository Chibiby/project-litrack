"use server";

import { requireUser } from "@/lib/auth/session";
import { readBoundImpersonationSession } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const WRITE_INTERVAL_MS = 60_000;

export type PresenceActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Record active-app presence for the teacher represented by this session.
 *
 * The payload deliberately contains no identity or timestamp. The session and
 * server clock own both, and the atomic predicate keeps a replayed client from
 * turning activity tracking into an unbounded write loop.
 *
 * Deliberately NOT wrapped in `action()`. This fires on a 60s heartbeat from
 * every active teacher session (`TeacherPresenceHeartbeat`), so a transient
 * pool hiccup here is routine, not noteworthy — running it through `action()`
 * would classify every one of those hiccups as a `system`-severity failure,
 * writing an `ErrorEvent` row (and eligible for an alert email) for something
 * that is expected to happen occasionally at this call volume and that the
 * caller already treats as fire-and-forget (`.catch(() => undefined)`). The
 * hand-rolled try/catch below keeps doing what it always did: swallow the
 * failure and let the next heartbeat retry.
 */
export async function recordTeacherPresence(): Promise<PresenceActionResult> {
  const user = await requireUser("TEACHER", false);
  const supabase = await createSupabaseServerClient();
  const impersonation = await readBoundImpersonationSession(supabase.auth);

  // An admin diagnosing a teacher account is not evidence that the teacher is
  // online. This server gate remains authoritative even if client code is
  // modified to call the action directly.
  if (impersonation) return { ok: true };

  const now = new Date();
  const cutoff = new Date(now.getTime() - WRITE_INTERVAL_MS);

  try {
    await prisma.user.updateMany({
      where: {
        id: user.id,
        role: "TEACHER",
        deletedAt: null,
        isActive: true,
        OR: [{ lastOnlineAt: null }, { lastOnlineAt: { lt: cutoff } }],
      },
      data: { lastOnlineAt: now },
    });
    return { ok: true };
  } catch {
    // Presence is informational. A pool or network failure must not interrupt
    // the teacher's actual work, and the next eligible activity can retry.
    return { ok: false, error: "Presence could not be updated" };
  }
}
