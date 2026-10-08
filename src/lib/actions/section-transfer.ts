"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import { getAdvisoryPlacements } from "@/lib/teachers/advisory";
import { writeAuditMany, AUDIT_ACTIONS } from "@/lib/audit";
import { action } from "@/lib/errors/action";
import { AppError, fieldError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import {
  cancelTransferRequestSchema,
  declineTransferRequestsSchema,
  decideTransferRequestsSchema,
  requestSectionTransfersSchema,
  transferLearnersSchema,
} from "@/lib/validators/section-transfer.schema";
import {
  evaluateSectionTransfer,
  TRANSFER_BLOCK_REASON_LABELS,
  type TransferBlockReason,
  type TransferDestinationFacts,
  type TransferLearnerFacts,
} from "@/lib/learners/section-transfer";
import { applySectionTransferBatch } from "@/lib/learners/section-transfer-apply";
import { uniqueTarget } from "@/lib/school-year-conflicts";
import {
  revalidateSectionTransfer,
  revalidateTransferRequests,
} from "@/lib/cache/revalidate";

/**
 * Moving learners between sections of one grade
 * (docs/specs/learner-section-transfers.md §2e, operator decisions §9).
 *
 * Authorization and tenancy:
 * - School Head actions use `requireSchoolUser("SCHOOL_HEAD")`; teacher actions
 *   `requireSchoolUser("TEACHER")`. A Super Admin passes the role check but has
 *   no `schoolId`, so `requireSchoolUser` sends them home — the `?schoolId=`
 *   drill-down is read-only for transfers by design (§9.5).
 * - Learners and requests are loaded by id and checked with `assertSameSchool`
 *   (another school's id reads as NOT_FOUND and is recorded as security), the
 *   way `archiveLearners` does; sections are loaded with `schoolId` in the
 *   `where`. Teacher reads put `schoolId`, the advised section ids and
 *   `requestedById: user.id` in the `where` itself.
 * - Every batch is all-or-nothing, and every write is a compare-and-set inside
 *   one transaction, so a race refuses the whole batch instead of half-applying.
 */

type ActionResult<T = undefined> = T extends undefined ? { ok: true } : { ok: true; data: T };

const LEARNER_SELECT = {
  id: true,
  schoolId: true,
  gradeLevelId: true,
  sectionId: true,
  teacherId: true,
  aralTeacherId: true,
  deletedAt: true,
  archivedAt: true,
  gradeLevel: { select: { type: true } },
} satisfies Prisma.LearnerSelect;

const DESTINATION_SELECT = {
  id: true,
  name: true,
  schoolId: true,
  gradeLevelId: true,
  deletedAt: true,
  gradeLevel: { select: { deletedAt: true } },
  adviser: { select: { id: true, deletedAt: true, isActive: true, role: true } },
} satisfies Prisma.SectionSelect;

type LearnerRow = Prisma.LearnerGetPayload<{ select: typeof LEARNER_SELECT }>;
type DestinationRow = Prisma.SectionGetPayload<{ select: typeof DESTINATION_SELECT }>;

function learnerFacts(row: LearnerRow | undefined): TransferLearnerFacts | null {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.schoolId,
    gradeLevelId: row.gradeLevelId,
    gradeType: row.gradeLevel.type,
    sectionId: row.sectionId,
    deletedAt: row.deletedAt,
    archivedAt: row.archivedAt,
  };
}

function destinationFacts(row: DestinationRow | null | undefined): TransferDestinationFacts {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.schoolId,
    gradeLevelId: row.gradeLevelId,
    deletedAt: row.deletedAt,
    gradeDeletedAt: row.gradeLevel.deletedAt,
    adviser: row.adviser,
  };
}

function learnersLabel(n: number): string {
  return `${n} ${n === 1 ? "learner" : "learners"}`;
}

/**
 * The refusal for a batch with blocked learners: the first reason found, with
 * how many learners share it. A waiting request has its own code because the
 * fix (decide it first) differs from every other reason.
 */
function blockedError(
  reasons: TransferBlockReason[],
  sectionName: string,
  code: "TRANSFER_BLOCKED" | "TRANSFER_STALE"
): AppError {
  const reason = reasons[0];
  const n = reasons.filter((r) => r === reason).length;
  if (reason === "pending-request" && code === "TRANSFER_BLOCKED") {
    return new AppError("TRANSFER_REQUEST_PENDING", {
      params: { learners: learnersLabel(n), have: n === 1 ? "has" : "have" },
    });
  }
  return new AppError(code, {
    params: {
      learners: learnersLabel(n),
      section: sectionName,
      reason: TRANSFER_BLOCK_REASON_LABELS[reason],
    },
  });
}

/**
 * A P2002 from `SectionTransferRequest_learner_pending_unique` and nothing
 * else. The index covers `learnerId` alone, so the adapter reports that field;
 * the index name and the message are fallbacks for other runtimes.
 */
function isPendingRequestConflict(err: unknown): boolean {
  if ((err as { code?: unknown } | null)?.code !== "P2002") return false;
  const target = uniqueTarget(err);
  if (target.length > 0) {
    return (
      (target.length === 1 && target[0] === "learnerId") ||
      target.some((t) => t.includes("learner_pending_unique"))
    );
  }
  return err instanceof Error && err.message.includes("learner_pending_unique");
}

async function pendingLearnerIds(schoolId: string, learnerIds: string[]): Promise<Set<string>> {
  const rows = await prisma.sectionTransferRequest.findMany({
    where: { schoolId, learnerId: { in: learnerIds }, status: "PENDING" },
    select: { learnerId: true },
  });
  return new Set(rows.map((r) => r.learnerId));
}

/** School Head: move one or many learners to another section of their grade. */
export const transferLearnersToSection = action(
  "transferLearnersToSection",
  async (
    input: unknown
  ): Promise<ActionResult<{ moved: number; unchanged: number; sectionName: string }>> => {
    const user = await requireSchoolUser("SCHOOL_HEAD");
    const parsed = parseInput(transferLearnersSchema, input);
    const ids = [...new Set(parsed.learnerIds)];

    const learners = await prisma.learner.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: LEARNER_SELECT,
    });
    // Before the count, so another school's id is still recorded as security.
    for (const l of learners) assertSameSchool(user.schoolId, l.schoolId, "Learner");
    if (learners.length !== ids.length) throw resourceNotFound("Learner");

    const destination = await prisma.section.findFirst({
      where: { id: parsed.toSectionId, schoolId: user.schoolId },
      select: DESTINATION_SELECT,
    });
    if (!destination) {
      throw fieldError("toSectionId", "That section was not found. Choose another section.");
    }

    const pending = await pendingLearnerIds(user.schoolId, ids);

    const moves: LearnerRow[] = [];
    let unchanged = 0;
    let teacherId: string | null = null;
    const blocked: TransferBlockReason[] = [];
    for (const l of learners) {
      const verdict = evaluateSectionTransfer({
        actorSchoolId: user.schoolId,
        learner: learnerFacts(l),
        destination: destinationFacts(destination),
        hasPendingRequest: pending.has(l.id),
      });
      if (!verdict.ok) blocked.push(verdict.reason);
      else if (verdict.kind === "unchanged") unchanged += 1;
      else {
        moves.push(l);
        teacherId = verdict.teacherId;
      }
    }
    if (blocked.length > 0) throw blockedError(blocked, destination.name, "TRANSFER_BLOCKED");

    if (moves.length === 0 || !teacherId) {
      return { ok: true, data: { moved: 0, unchanged, sectionName: destination.name } };
    }
    const newTeacherId = teacherId;

    const now = new Date();
    await prisma.$transaction((tx) =>
      applySectionTransferBatch(tx, {
        schoolId: user.schoolId,
        gradeLevelId: destination.gradeLevelId,
        toSectionId: destination.id,
        teacherId: newTeacherId,
        moves: moves.map((l) => ({ learnerId: l.id, fromSectionId: l.sectionId })),
        now,
      })
    );

    await writeAuditMany(
      moves.map((l) => ({
        userId: user.id,
        schoolId: user.schoolId,
        action: AUDIT_ACTIONS.LEARNER_TRANSFER,
        resource: "Learner",
        resourceId: l.id,
        metadata: { source: "direct", fromSectionId: l.sectionId, toSectionId: destination.id },
      }))
    );

    revalidateSectionTransfer({
      schoolId: user.schoolId,
      gradeLevelId: destination.gradeLevelId,
      teacherIds: [newTeacherId, ...moves.flatMap((l) => [l.teacherId, l.aralTeacherId])],
    });

    return {
      ok: true,
      data: { moved: moves.length, unchanged, sectionName: destination.name },
    };
  },
  { verb: "transfer the learners" }
);

/** Teacher: ask the School Head to move learners from a section they advise. */
export const requestSectionTransfers = action(
  "requestSectionTransfers",
  async (input: unknown): Promise<ActionResult<{ requested: number; unchanged: number }>> => {
    const user = await requireSchoolUser("TEACHER");
    if (!user.profileCompleted) {
      throw new AppError("VALIDATION_FAILED", { params: { message: "Complete your profile first" } });
    }
    const parsed = parseInput(requestSectionTransfersSchema, input);
    const ids = [...new Set(parsed.learnerIds)];

    const advisedIds = (await getAdvisoryPlacements(user)).map((p) => p.sectionId);

    const learners = await prisma.learner.findMany({
      where: {
        id: { in: ids },
        schoolId: user.schoolId,
        deletedAt: null,
        archivedAt: null,
        sectionId: { in: advisedIds },
      },
      select: LEARNER_SELECT,
    });
    // One answer for "not yours", "another school's", "archived" and "never
    // existed", so a probe cannot tell them apart.
    if (learners.length !== ids.length) {
      throw new AppError("VALIDATION_FAILED", {
        params: { message: "One or more learners are no longer in your advisory sections. Refresh the list." },
      });
    }

    const destination = await prisma.section.findFirst({
      where: { id: parsed.toSectionId, schoolId: user.schoolId },
      select: DESTINATION_SELECT,
    });
    if (!destination) {
      throw fieldError("toSectionId", "That section was not found. Choose another section.");
    }

    const pending = await pendingLearnerIds(user.schoolId, ids);

    const moves: LearnerRow[] = [];
    let unchanged = 0;
    const blocked: TransferBlockReason[] = [];
    for (const l of learners) {
      const verdict = evaluateSectionTransfer({
        actorSchoolId: user.schoolId,
        learner: learnerFacts(l),
        destination: destinationFacts(destination),
        hasPendingRequest: pending.has(l.id),
        advisedSectionIds: advisedIds,
      });
      if (!verdict.ok) blocked.push(verdict.reason);
      else if (verdict.kind === "unchanged") unchanged += 1;
      else moves.push(l);
    }
    if (blocked.length > 0) throw blockedError(blocked, destination.name, "TRANSFER_BLOCKED");

    if (moves.length > 0) {
      // One statement. A concurrent request for the same learner trips the
      // pending-request partial unique index (P2002). That race is the user's
      // ordinary refusal, not a system fault, so it is mapped here rather than
      // left to `action()` (which would call it DB_CONFLICT and alert).
      // Postgres stops at the first violation, so one learner is all we know.
      try {
        await prisma.sectionTransferRequest.createMany({
          data: moves.map((l) => ({
            schoolId: user.schoolId,
            learnerId: l.id,
            requestedById: user.id,
            // Non-null: `advisedSectionIds` refused any learner without a section.
            fromSectionId: l.sectionId as string,
            toSectionId: destination.id,
            reason: parsed.reason ? parsed.reason : null,
          })),
        });
      } catch (err) {
        if (isPendingRequestConflict(err)) {
          throw new AppError("TRANSFER_REQUEST_PENDING", {
            cause: err,
            params: { learners: learnersLabel(1), have: "has" },
          });
        }
        throw err;
      }
      revalidateTransferRequests(user.schoolId);
    }

    return { ok: true, data: { requested: moves.length, unchanged } };
  },
  { verb: "send the transfer request" }
);

const REQUEST_SELECT = {
  id: true,
  schoolId: true,
  status: true,
  learnerId: true,
  fromSectionId: true,
  toSectionId: true,
} satisfies Prisma.SectionTransferRequestSelect;

/** Load requests by id, refusing another school's and missing ones alike. */
async function loadRequests(schoolId: string, ids: string[]) {
  const requests = await prisma.sectionTransferRequest.findMany({
    where: { id: { in: ids } },
    select: REQUEST_SELECT,
  });
  for (const r of requests) assertSameSchool(schoolId, r.schoolId, "Transfer request");
  if (requests.length !== ids.length) throw resourceNotFound("Transfer request");
  if (requests.some((r) => r.status !== "PENDING")) {
    throw new AppError("TRANSFER_REQUESTS_CHANGED");
  }
  return requests;
}

/** School Head: approve teacher requests and move the learners. */
export const approveSectionTransferRequests = action(
  "approveSectionTransferRequests",
  async (input: unknown): Promise<ActionResult<{ approved: number }>> => {
    const user = await requireSchoolUser("SCHOOL_HEAD");
    const parsed = parseInput(decideTransferRequestsSchema, input);
    const ids = [...new Set(parsed.requestIds)];

    const requests = await loadRequests(user.schoolId, ids);

    // Re-check against current data: the learner may have moved, the section
    // may be archived, its adviser changed or gone. `teacherId` is read from
    // the destination's adviser now, never from the request.
    const [learners, destinations] = await Promise.all([
      prisma.learner.findMany({
        where: { id: { in: requests.map((r) => r.learnerId) }, schoolId: user.schoolId },
        select: LEARNER_SELECT,
      }),
      prisma.section.findMany({
        where: { id: { in: [...new Set(requests.map((r) => r.toSectionId))] }, schoolId: user.schoolId },
        select: DESTINATION_SELECT,
      }),
    ]);
    const learnerById = new Map(learners.map((l) => [l.id, l]));
    const destinationById = new Map(destinations.map((d) => [d.id, d]));

    type Group = { destination: DestinationRow; teacherId: string; items: { request: (typeof requests)[number]; learner: LearnerRow }[] };
    const groups = new Map<string, Group>();
    const stale: TransferBlockReason[] = [];
    let staleSectionName = "";
    for (const r of requests) {
      const learner = learnerById.get(r.learnerId);
      const destination = destinationById.get(r.toSectionId);
      const verdict = evaluateSectionTransfer({
        actorSchoolId: user.schoolId,
        learner: learnerFacts(learner),
        destination: destinationFacts(destination),
        expectedFromSectionId: r.fromSectionId,
        // This request IS the pending one; there cannot be a second.
        hasPendingRequest: false,
      });
      if (!verdict.ok) {
        if (stale.length === 0) staleSectionName = destination?.name ?? "that section";
        stale.push(verdict.reason);
        continue;
      }
      // `unchanged` cannot follow a passed moved-since-request check (from and
      // to differ by constraint); nothing to apply for it either way.
      if (verdict.kind !== "move" || !learner || !destination) continue;
      const group = groups.get(destination.id) ?? { destination, teacherId: verdict.teacherId, items: [] };
      group.items.push({ request: r, learner });
      groups.set(destination.id, group);
    }
    if (stale.length > 0) throw blockedError(stale, staleSectionName, "TRANSFER_STALE");

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Compare-and-set on the requests: a second approval, or an approval
      // racing a cancel or decline, matches fewer rows and rolls back.
      const { count } = await tx.sectionTransferRequest.updateMany({
        where: { id: { in: ids }, schoolId: user.schoolId, status: "PENDING" },
        data: { status: "APPROVED", decidedById: user.id, decidedAt: now },
      });
      if (count !== ids.length) {
        throw new AppError("TRANSFER_REQUESTS_CHANGED", {
          detail: `request compare-and-set matched ${count} of ${ids.length}`,
        });
      }
      // One batch per destination section — bounded by the number of distinct
      // destinations, never by the number of learners.
      for (const group of groups.values()) {
        await applySectionTransferBatch(tx, {
          schoolId: user.schoolId,
          gradeLevelId: group.destination.gradeLevelId,
          toSectionId: group.destination.id,
          teacherId: group.teacherId,
          moves: group.items.map(({ learner }) => ({ learnerId: learner.id, fromSectionId: learner.sectionId })),
          now,
        });
      }
    });

    const items = [...groups.values()].flatMap((g) => g.items);
    await writeAuditMany(
      items.map(({ request, learner }) => ({
        userId: user.id,
        schoolId: user.schoolId,
        action: AUDIT_ACTIONS.LEARNER_TRANSFER,
        resource: "Learner",
        resourceId: learner.id,
        metadata: {
          source: "request",
          requestId: request.id,
          fromSectionId: request.fromSectionId,
          toSectionId: request.toSectionId,
        },
      }))
    );

    const byGrade = new Map<string, (string | null)[]>();
    for (const g of groups.values()) {
      const list = byGrade.get(g.destination.gradeLevelId) ?? [];
      list.push(g.teacherId, ...g.items.flatMap(({ learner }) => [learner.teacherId, learner.aralTeacherId]));
      byGrade.set(g.destination.gradeLevelId, list);
    }
    for (const [gradeLevelId, teacherIds] of byGrade) {
      revalidateSectionTransfer({ schoolId: user.schoolId, gradeLevelId, teacherIds });
    }
    revalidateTransferRequests(user.schoolId);

    return { ok: true, data: { approved: ids.length } };
  },
  { verb: "approve the transfer requests" }
);

/** School Head: decline requests. Allowed even when a request has gone stale. */
export const declineSectionTransferRequests = action(
  "declineSectionTransferRequests",
  async (input: unknown): Promise<ActionResult<{ declined: number }>> => {
    const user = await requireSchoolUser("SCHOOL_HEAD");
    const parsed = parseInput(declineTransferRequestsSchema, input);
    const ids = [...new Set(parsed.requestIds)];

    await loadRequests(user.schoolId, ids);

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.sectionTransferRequest.updateMany({
        where: { id: { in: ids }, schoolId: user.schoolId, status: "PENDING" },
        data: {
          status: "REJECTED",
          decidedById: user.id,
          decidedAt: now,
          decisionNote: parsed.note ? parsed.note : null,
        },
      });
      if (count !== ids.length) {
        throw new AppError("TRANSFER_REQUESTS_CHANGED", {
          detail: `request compare-and-set matched ${count} of ${ids.length}`,
        });
      }
    });

    revalidateTransferRequests(user.schoolId);
    return { ok: true, data: { declined: ids.length } };
  },
  { verb: "decline the transfer requests" }
);

/** Teacher: withdraw one of their own pending requests. */
export const cancelSectionTransferRequest = action(
  "cancelSectionTransferRequest",
  async (input: unknown): Promise<ActionResult> => {
    const user = await requireSchoolUser("TEACHER");
    const parsed = parseInput(cancelTransferRequestSchema, input);

    // School, requester and status all in the `where`: somebody else's request,
    // another school's, an already-decided one and a missing one all match
    // nothing and read the same.
    const { count } = await prisma.sectionTransferRequest.updateMany({
      where: {
        id: parsed.requestId,
        schoolId: user.schoolId,
        requestedById: user.id,
        status: "PENDING",
      },
      data: { status: "CANCELLED", decidedById: user.id, decidedAt: new Date() },
    });
    if (count === 0) throw resourceNotFound("Transfer request");

    revalidateTransferRequests(user.schoolId);
    return { ok: true };
  },
  { verb: "withdraw the transfer request" }
);
