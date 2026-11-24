import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { cachedQuery } from "@/lib/cache/unstable";
import { teacherDashboard } from "@/lib/cache/tags";
import { getOpenTicketCountInScope } from "@/lib/district/notifications";
import { getMonitoringCounts } from "@/lib/monitoring/load";
import type { NavBadges } from "@/lib/nav/nav-config";
import { aralLearnerScope } from "@/lib/teachers/scope";
import { countIncomingByKind } from "@/lib/transfers/queries";

/**
 * The counts behind the sidebar badges, one loader per role, each keyed by the
 * `NavItem.id` it decorates. A badge is a hint, never a gate: a count that
 * fails to load is left out (no badge) rather than failing the page.
 *
 * Spec: docs/superpowers/specs/2026-11-24-sidebar-badges-design.md.
 */

/**
 * "Ask admin" conversations whose newest message no Super Admin has read yet.
 * The team shares one inbox, so any admin's read — or reply, since a send
 * marks the sender's read — clears it for all. Staff-room chatter is teachers
 * talking among themselves and never raises this count.
 *
 * Uncached on purpose: the Super Admin sidebar polls it, and the few admins
 * who do so need it current, not up to a minute stale.
 */
async function countWaitingAdminConversations(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "ChatChannel" c
    JOIN "School" s ON s.id = c."schoolId"
    WHERE c.kind = 'ADMIN_DIRECT'
      AND c."memberId" IS NOT NULL
      AND c."lastMessageAt" IS NOT NULL
      AND s."deletedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "ChatRead" r
        JOIN "User" u ON u.id = r."userId"
        WHERE r."channelId" = c.id
          AND u.role = 'SUPER_ADMIN'
          AND r."lastReadAt" >= c."lastMessageAt"
      )`;
  return Number(rows[0]?.n ?? 0);
}

/** Support tickets still waiting on an answer, from any live school. */
function countOpenTickets(): Promise<number> {
  return prisma.supportTicket.count({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] }, school: { deletedAt: null } },
  });
}

export async function getAdminNavBadges(): Promise<NavBadges> {
  const [waiting, tickets] = await Promise.all([countWaitingAdminConversations(), countOpenTickets()]);
  return { "admin-support": waiting + tickets };
}

export async function getDistrictNavBadges(user: Pick<User, "id">, scope: AdminScope): Promise<NavBadges> {
  return { "district-support": await getOpenTicketCountInScope(user, scope) };
}

/**
 * A School Head's own school only. `metrics` is the layout's already-loaded
 * `getSchoolHeadMetricCounts` result; `todayKey` is
 * `formatLocalDateKey(schoolToday())`.
 */
export async function getSchoolHeadNavBadges(
  schoolId: string,
  metrics: { pendingTransferRequestCount: number } | undefined,
  todayKey: string
): Promise<NavBadges> {
  const [incoming, monitoring] = await Promise.allSettled([
    countIncomingByKind(schoolId),
    getMonitoringCounts(schoolId, todayKey),
  ]);
  const badges: NavBadges = {};
  if (incoming.status === "fulfilled") {
    badges["school-head-transfer"] = Object.values(incoming.value).reduce((a, b) => a + b, 0);
  }
  // Section-move requests are decided on the Learners page.
  if (metrics) badges["school-head-learners"] = metrics.pendingTransferRequestCount;
  if (monitoring.status === "fulfilled") {
    const m = monitoring.value;
    badges["school-head-monitoring-non-compliance"] = m.teachersWithPending;
    badges["school-head-monitoring-aral"] = m.aralTeachersWithPending;
    badges["school-head-monitoring-discrepancies"] = m.discrepancyTotal;
  }
  return badges;
}

/**
 * ARAL learners this teacher tutors who have no ARAL Profile yet — the Pending
 * tab of ARAL Profiling. Cached briefly; saving a profile busts it through
 * `revalidateLearnerScoped`, which expires the tutor's dashboard tag.
 */
export async function getTeacherNavBadges(teacherId: string, schoolId: string): Promise<NavBadges> {
  const pending = await cachedQuery(
    () =>
      prisma.learner.count({
        where: {
          schoolId,
          deletedAt: null,
          archivedAt: null,
          isAralLearner: true,
          aralProfile: null,
          ...aralLearnerScope(teacherId),
        },
      }),
    {
      keyParts: ["nav-badge-aral-profiling-v1", schoolId, teacherId],
      tags: [teacherDashboard(teacherId)],
      revalidate: 30,
    }
  );
  return { "teacher-aral-profiling": pending };
}
