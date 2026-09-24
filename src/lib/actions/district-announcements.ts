"use server";

import { randomUUID } from "node:crypto";
import { action } from "@/lib/errors/action";
import { parseInput } from "@/lib/errors/validation";
import { resourceNotFound } from "@/lib/errors/app-error";
import { requireAdminScope, loadSchoolInScope } from "@/lib/auth/district-scope";
import {
  resolveSummaryScope,
  schoolWhereForScope,
  type AdminScope,
} from "@/lib/auth/admin-scope";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { revalidateSchoolDashboard } from "@/lib/cache/revalidate";
import {
  broadcastAnnouncementSchema,
  retractBroadcastSchema,
  type BroadcastTarget,
} from "@/lib/validators/announcement.schema";

/**
 * Announcements fanned out to many schools at once by a district admin (their
 * own districts) or the division office (any school) —
 * `docs/specs/district-admin.md` 3.5.
 *
 * One `Announcement` row per school, all sharing a `broadcastId` (a fresh
 * uuid, not a database default: it has to be known before the rows exist, so
 * every row in the `createMany` can carry the same one). A School Head reads
 * their copy through the ordinary announcements list; `updateAnnouncement` and
 * `deleteAnnouncement` (`src/lib/actions/announcement.ts`) refuse any row with
 * `broadcastId != null` (I13), so a broadcast is read-only to the school it
 * reached.
 *
 * The tenant story: `target` names WHICH schools without trusting any of them.
 * Every kind resolves through the caller's own `AdminScope` — `all` and
 * `district` build a `Prisma.SchoolWhereInput` from it, `schools` checks each
 * id with `loadSchoolInScope` — so a single out-of-scope id fails the WHOLE
 * call (I6) rather than silently dropping just that school. `resolveSummaryScope`
 * is reused for the `district` case: it already throws the same NOT_FOUND for a
 * district outside a district admin's assignments, and division-scope callers
 * (Super Admin) skip that check by construction.
 */

async function resolveTargetSchoolIds(
  scope: AdminScope,
  target: BroadcastTarget
): Promise<string[]> {
  if (target.kind === "all") {
    const schools = await prisma.school.findMany({
      where: schoolWhereForScope(scope),
      select: { id: true },
    });
    return schools.map((school) => school.id);
  }

  if (target.kind === "district") {
    // Throws NOT_FOUND when the district is outside a district admin's own
    // assignments. A Super Admin (division scope) names any district; an
    // unknown spelling just resolves to zero schools below.
    resolveSummaryScope(scope, { district: target.district });
    const districtScope: AdminScope = { kind: "districts", districts: [target.district] };
    const schools = await prisma.school.findMany({
      where: schoolWhereForScope(districtScope),
      select: { id: true },
    });
    return schools.map((school) => school.id);
  }

  // `schools`: each id must individually pass `loadSchoolInScope`, which
  // throws NOT_FOUND on the first one outside the caller's scope — so the
  // whole call fails rather than silently broadcasting to the rest.
  const ids = [...new Set(target.schoolIds)];
  const rows = await Promise.all(
    ids.map((id) => loadSchoolInScope(scope, id, { id: true }))
  );
  return rows.map((row) => row.id);
}

export type BroadcastAnnouncementResult = {
  ok: true;
  data: { broadcastId: string; schoolCount: number };
};

export const broadcastAnnouncement = action(
  "broadcastAnnouncement",
  async (input: unknown): Promise<BroadcastAnnouncementResult> => {
    const { user: actor, scope } = await requireAdminScope();
    const data = parseInput(broadcastAnnouncementSchema, input);

    const schoolIds = await resolveTargetSchoolIds(scope, data.target);
    if (schoolIds.length === 0) {
      throw resourceNotFound("School", {
        detail: "Broadcast target resolved to zero schools",
      });
    }

    const broadcastId = randomUUID();
    await prisma.announcement.createMany({
      data: schoolIds.map((schoolId) => ({
        schoolId,
        authorId: actor.id,
        title: data.title,
        body: data.body,
        broadcastId,
      })),
    });

    for (const schoolId of schoolIds) {
      revalidateSchoolDashboard(schoolId);
    }

    // No single school owns a broadcast row, so the audit row carries no
    // `schoolId` — the per-school `Announcement` rows are what each school's
    // own `/school-head/audit` (via `ANNOUNCEMENT_CREATE`-style history, read
    // from the announcement itself, not from this row) would show, and this
    // row is the division/district-level record of the act.
    await writeAudit({
      userId: actor.id,
      schoolId: null,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_BROADCAST,
      resource: "Announcement",
      resourceId: broadcastId,
      metadata: { broadcastId, schoolCount: schoolIds.length },
    });

    return { ok: true, data: { broadcastId, schoolCount: schoolIds.length } };
  },
  { verb: "send the announcement" }
);

export type RetractBroadcastResult = { ok: true; data: { schoolCount: number } };

export const retractBroadcast = action(
  "retractBroadcast",
  async (input: unknown): Promise<RetractBroadcastResult> => {
    const { user: actor, scope } = await requireAdminScope();
    const data = parseInput(retractBroadcastSchema, input);

    // The scope is IN the where: a district admin can only retract the copies
    // sitting in their own districts, even for a broadcastId that also reached
    // schools outside their scope.
    const rows = await prisma.announcement.findMany({
      where: {
        broadcastId: data.broadcastId,
        deletedAt: null,
        school: schoolWhereForScope(scope),
      },
      select: { id: true, schoolId: true },
    });
    if (rows.length === 0) {
      throw resourceNotFound("Announcement");
    }

    await prisma.announcement.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { deletedAt: new Date() },
    });

    for (const row of rows) {
      revalidateSchoolDashboard(row.schoolId);
    }

    await writeAudit({
      userId: actor.id,
      schoolId: null,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_BROADCAST_RETRACT,
      resource: "Announcement",
      resourceId: data.broadcastId,
      metadata: { broadcastId: data.broadcastId, schoolCount: rows.length },
    });

    return { ok: true, data: { schoolCount: rows.length } };
  },
  { verb: "retract the announcement" }
);

export type MyBroadcast = {
  broadcastId: string;
  title: string;
  body: string;
  publishedAt: Date;
  /** How many in-scope schools still carry a live copy. */
  schoolCount: number;
};

/**
 * The caller's own broadcasts, newest first — for the compose page's history
 * list and its retract button.
 *
 * Scoped the same way every other read here is: only rows in the caller's own
 * `AdminScope`, and only rows this caller authored (a district admin does not
 * need to see a division-wide broadcast's per-school copies to know it exists;
 * `retractBroadcast` can still act on it if given the id).
 */
export async function listMyBroadcasts(): Promise<MyBroadcast[]> {
  const { user: actor, scope } = await requireAdminScope();

  const rows = await prisma.announcement.findMany({
    where: {
      broadcastId: { not: null },
      deletedAt: null,
      authorId: actor.id,
      school: schoolWhereForScope(scope),
    },
    select: { broadcastId: true, title: true, body: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
  });

  const byBroadcast = new Map<string, MyBroadcast>();
  for (const row of rows) {
    if (!row.broadcastId) continue;
    const existing = byBroadcast.get(row.broadcastId);
    if (existing) {
      existing.schoolCount += 1;
      continue;
    }
    byBroadcast.set(row.broadcastId, {
      broadcastId: row.broadcastId,
      title: row.title,
      body: row.body,
      publishedAt: row.publishedAt,
      schoolCount: 1,
    });
  }
  return [...byBroadcast.values()];
}
