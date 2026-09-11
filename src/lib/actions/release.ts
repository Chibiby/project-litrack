"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { markNotificationsRead } from "@/lib/notifications";
import { APP_VERSION, latestRelease } from "@/lib/releases";
import type { ShellNotification } from "@/components/shell/notifications-menu";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * The where clause every read of a user's pending release row shares.
 *
 * UNREAD only, deliberately. A release row that has been read is history, not a
 * pending announcement — matching read rows too would mean a user who had ever
 * been announced to could never be announced to again, and every release after
 * their first would reach them only through the modal.
 */
function pendingReleaseRow(user: { id: string; schoolId: string }) {
  return {
    recipientId: user.id,
    schoolId: user.schoolId,
    type: "RELEASE_PUBLISHED" as const,
    readAt: null,
  };
}

/**
 * Record that this user has a release waiting, once.
 *
 * Lazy per-user, never a fan-out. Publishing a release writes nothing: a
 * deployment does not touch the database at all. The row appears the first time
 * that particular user arrives, and only for them — announcing to ten thousand
 * teachers costs ten thousand rows spread over the days they each next sign in,
 * not one write storm at deploy time for people who will not log in this month.
 *
 * Idempotent by lookup rather than by unique constraint: `Notification` has no
 * unique on (recipient, type) and adding one would forbid a second release ever
 * writing a row. A double-mount racing itself could still slip two rows past the
 * check; that is a cosmetic duplicate in a bell menu, weighed against a
 * migration, and the check catches every non-racing case including a re-render.
 *
 * Never surfaces a failure. The bell row is a courtesy — the modal is already on
 * screen by the time this resolves, and telling the user a notification they did
 * not ask for failed to save would be noise.
 */
export async function announceRelease(): Promise<ActionResult> {
  const user = await requireUser();

  // Already acknowledged this exact version: nothing to announce.
  if (user.lastSeenReleaseVersion === APP_VERSION) return { ok: true };

  // A release with `announce: false` is visible at /releases and in the sidebar
  // and interrupts nobody. That is the whole purpose of the flag.
  if (!latestRelease().announce) return { ok: true };

  // `Notification.schoolId` is non-nullable and every read is school-scoped. A
  // Super Admin holds no school, so there is no row to write for them — they see
  // the modal, which needs no persistence.
  if (!user.schoolId) return { ok: true };

  try {
    const existing = await prisma.notification.findFirst({
      where: pendingReleaseRow({ id: user.id, schoolId: user.schoolId }),
      select: { id: true },
    });
    if (existing) return { ok: true };

    await prisma.notification.create({
      data: {
        schoolId: user.schoolId,
        recipientId: user.id,
        // No actor: a release is published by the project, not by a person in
        // this school. The column is nullable for exactly this kind of row.
        actorId: null,
        type: "RELEASE_PUBLISHED",
        // Non-nullable array, and a release is about no learners.
        learnerIds: [],
      },
    });
  } catch (err) {
    console.error("[release] announce failed:", err);
  }

  return { ok: true };
}

/**
 * Stamp the version this user just read.
 *
 * Called from the modal's "Got it" — on acknowledgement, never on display. A
 * user who sees the modal and closes the tab mid-sentence has not read it and
 * will be shown it again. Writing the stamp when the modal mounts would swallow
 * the announcement for exactly the person interrupted at the wrong moment.
 *
 * Unlike `announceRelease`, a failure here IS surfaced: without the stamp the
 * modal reappears on the next navigation, and someone who pressed "Got it" and
 * is interrupted again should be told why rather than left thinking it broke.
 *
 * No audit row, in either action: an audit row records a decision somebody made
 * about somebody else's data, and "a user read the release notes" is neither.
 */
export async function acknowledgeRelease(): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenReleaseVersion: APP_VERSION },
    });
  } catch (err) {
    console.error("[release] acknowledge failed:", err);
    return { ok: false, error: "Could not save that you have seen this. Try again." };
  }

  return { ok: true };
}

/**
 * The bell's half of §2: "what was that thing I dismissed".
 *
 * Fetched from the client after the shell paints, never awaited in a layout —
 * the teacher layout is held to the two reads its chrome needs, and a bell badge
 * is exactly the trade it refuses. The shell stays mounted across in-app
 * navigation, so this runs once per entry, not once per page.
 *
 * The sentence is composed here, at read time, like the chat rows: the stored
 * row carries no text, so there is nothing to go stale. This is also where the
 * `RELEASE_PUBLISHED` label lives — `NotificationType` has no labels map in
 * `enum-labels.ts`, and inventing one for a single entry would be a second place
 * for the same words.
 */
export async function fetchReleaseAlert(): Promise<ShellNotification | null> {
  const user = await requireUser();
  if (!user.schoolId) return null;

  try {
    const row = await prisma.notification.findFirst({
      where: pendingReleaseRow({ id: user.id, schoolId: user.schoolId }),
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!row) return null;

    const release = latestRelease();
    return {
      id: row.id,
      title: `What's new in LITRACK ${release.version}`,
      description: release.title,
      href: "/releases",
      // Amber, the app's secondary accent. Violet is reserved for ARAL.
      tone: "amber",
    };
  } catch (err) {
    // A bell that cannot load must not break the page it sits on.
    console.error("[release] alert read failed:", err);
    return null;
  }
}

const rowIdSchema = z.string().uuid();

/** Mark the release row read once the user opens it. Scoped to them; the id is untrusted. */
export async function dismissReleaseAlert(id: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.schoolId) return { ok: false, error: "Not found" };

  const parsed = rowIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  await markNotificationsRead({
    recipientId: user.id,
    schoolId: user.schoolId,
    ids: [parsed.data],
  });
  return { ok: true };
}
