import "server-only";
import { prisma } from "@/lib/prisma";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import type { UserRole } from "@prisma/client";

/**
 * In-app notifications.
 *
 * One row per action, addressed to one recipient, with its own read state. Only
 * ids are stored: the sentence the recipient reads is composed here at read time
 * from the current rows, so no learner PII is duplicated into the table and a
 * renamed or archived learner leaves no stale text behind.
 */

/** Ceiling on one feed read. A tutor with more waiting has a bigger problem than paging. */
const FEED_LIMIT = 20;

/** Names listed in full before the sentence switches to a count. */
const NAMES_SHOWN = 3;

export type AralAssignmentAlert = {
  id: string;
  /** "Teacher Marivic Santos assigned you an ARAL learner." */
  title: string;
  /** "Ana Cruz, Ben Dela Cruz and 4 more" */
  description: string;
  href: string;
};

/**
 * How the recipient should address the person who assigned them.
 *
 * A bare name reads as a system string; the honorific is how these two people
 * actually refer to each other in a DepEd school. It follows the actor's role,
 * so a School Head is never called Teacher, and a Non-DepEd ARAL Volunteer —
 * who holds the TEACHER role but is not a teacher — is named by what they are.
 */
function honorificFor(actor: {
  role: UserRole;
  teacherProfile: { designation: string | null } | null;
}): string {
  if (actor.role === "SCHOOL_HEAD") return "School Head";
  if (actor.role === "SUPER_ADMIN") return "Administrator";
  if (actor.teacherProfile?.designation === ARAL_VOLUNTEER_DESIGNATION) {
    return "ARAL Volunteer";
  }
  return "Teacher";
}

/**
 * Record that `recipientId` was designated the ARAL tutor for `learnerIds`.
 *
 * Never throws, for the same reason `writeAudit` does not: the designation itself
 * has already succeeded and committed. Losing the courtesy message is a smaller
 * failure than telling the actor their assignment failed when it did not.
 *
 * Self-assignment writes nothing — a teacher who enrolls their own learners does
 * not need to be told they did it.
 */
export async function notifyAralAssigned(input: {
  schoolId: string;
  recipientId: string;
  actorId: string;
  learnerIds: string[];
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  if (input.learnerIds.length === 0) return;

  try {
    await prisma.notification.create({
      data: {
        schoolId: input.schoolId,
        recipientId: input.recipientId,
        actorId: input.actorId,
        type: "ARAL_ASSIGNED",
        learnerIds: input.learnerIds,
      },
    });
  } catch (err) {
    console.error("[notifications] ARAL_ASSIGNED write failed:", err);
  }
}

/** "Ana Cruz, Ben Dela Cruz and 4 more" — or "1 learner" when every name is gone. */
function describeLearners(names: string[], requested: number): string {
  if (names.length === 0) {
    return `${requested} learner${requested === 1 ? "" : "s"}`;
  }
  if (names.length <= NAMES_SHOWN) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const shown = names.slice(0, NAMES_SHOWN).join(", ");
  return `${shown} and ${names.length - NAMES_SHOWN} more`;
}

/**
 * A tutor's unread ARAL designations, newest first, as sentences ready to render.
 *
 * Tenant-scoped on `schoolId` as well as `recipientId`: the recipient pointer is
 * already specific to one person, but a query that reads learner names must carry
 * the school on every leg regardless — the pattern is what keeps the next edit
 * here safe, not the coincidence that one column happens to be enough today.
 */
export async function getUnreadAralAssignments(user: {
  id: string;
  schoolId: string;
}): Promise<AralAssignmentAlert[]> {
  const rows = await prisma.notification.findMany({
    where: {
      recipientId: user.id,
      schoolId: user.schoolId,
      type: "ARAL_ASSIGNED",
      readAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: FEED_LIMIT,
    select: {
      id: true,
      learnerIds: true,
      actor: {
        select: {
          fullName: true,
          firstName: true,
          lastName: true,
          // Both feed the honorific in front of the name; see honorificFor.
          role: true,
          teacherProfile: { select: { designation: true } },
        },
      },
    },
  });
  if (rows.length === 0) return [];

  // One lookup for every notification's learners at once. Scoped to the school and
  // to rows that still exist and are still ARAL — an unenrolled or archived learner
  // drops out of the sentence rather than sending the tutor somewhere empty.
  const allIds = [...new Set(rows.flatMap((r) => r.learnerIds))];
  const learners = await prisma.learner.findMany({
    where: {
      id: { in: allIds },
      schoolId: user.schoolId,
      deletedAt: null,
      archivedAt: null,
      isAralLearner: true,
    },
    select: {
      id: true,
      fullName: true,
      gradeLevelId: true,
    },
  });
  const byId = new Map(learners.map((l) => [l.id, l]));

  return rows.map((row) => {
    const live = row.learnerIds.map((id) => byId.get(id)).filter((l) => l != null);
    const name =
      row.actor?.fullName?.trim() ||
      [row.actor?.firstName, row.actor?.lastName].filter(Boolean).join(" ").trim();
    // Titled, because that is how the recipient knows this person. With nobody
    // to name, the honorific stands alone as the whole subject — a designation
    // no teacher made came from above them.
    const actorName = row.actor
      ? name
        ? `${honorificFor(row.actor)} ${name}`
        : honorificFor(row.actor)
      : "Your School Head";

    // Deep-link only when every surviving learner sits in one grade, which is the
    // ordinary case — a bulk enrolment runs inside a single roster.
    const gradeIds = [...new Set(live.map((l) => l.gradeLevelId))];
    const href = gradeIds.length === 1 ? `/teacher/aral/${gradeIds[0]}` : "/teacher/aral";

    const count = live.length || row.learnerIds.length;
    return {
      id: row.id,
      title: `${actorName} assigned you ${
        count === 1 ? "an ARAL learner" : `${count} ARAL learners`
      }.`,
      description: describeLearners(
        live.map((l) => l.fullName),
        row.learnerIds.length
      ),
      href,
    };
  });
}

/**
 * Mark notifications read.
 *
 * Scoped to the recipient, so one user can never clear another's feed even with a
 * valid id — the ids arrive from the client and are treated as such.
 */
export async function markNotificationsRead(input: {
  recipientId: string;
  schoolId: string;
  ids: string[];
}): Promise<number> {
  if (input.ids.length === 0) return 0;

  const result = await prisma.notification.updateMany({
    where: {
      id: { in: input.ids },
      recipientId: input.recipientId,
      schoolId: input.schoolId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
