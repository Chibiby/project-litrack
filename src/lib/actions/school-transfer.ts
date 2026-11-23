"use server";

import { prisma } from "@/lib/prisma";
import { action } from "@/lib/errors/action";
import { AppError, fieldError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { resolveTransferActor } from "@/lib/transfers/actor";
import {
  canTransferBetween,
  effectiveStatus,
  expiresAtFor,
  transferKindForTeacher,
  type SkipReason,
} from "@/lib/transfers/school-transfer-rules";
import { applyLearnerSchoolMove } from "@/lib/transfers/apply-learner-move";
import { applyStaffSchoolMove } from "@/lib/transfers/apply-staff-move";
import { writeAuditMany, AUDIT_ACTIONS } from "@/lib/audit";
import { notifySchoolTransfer } from "@/lib/transfers/notify";
import {
  acceptSchoolTransfersSchema,
  cancelSchoolTransfersSchema,
  declineSchoolTransfersSchema,
  requestSchoolTransfersSchema,
} from "@/lib/validators/school-transfer.schema";
import { assertSchoolYearOpen } from "@/lib/school-year/gate";
import {
  revalidateLearnerScoped,
  revalidateSchoolTransfers,
  revalidateTeacherCaches,
} from "@/lib/cache/revalidate";

/**
 * Cross-school transfers of learners, teachers and ARAL volunteers
 * (docs/superpowers/specs/2026-11-23-cross-school-transfers-design.md).
 *
 * Nothing moves when a transfer is sent: rows wait as PENDING until the
 * receiving school accepts. `SchoolTransferRequest.schoolId` is the sending
 * school, `toSchoolId` the receiving one. Every action resolves the caller
 * against the school whose side it acts on (`resolveTransferActor`), and every
 * status change is a compare-and-set on `status: PENDING` plus an unexpired
 * `expiresAt`, so a race or an expired row is refused, never half-applied.
 */

/** Store EXPIRED on rows that ran out, so the pending unique index frees up. */
async function expireStale(personFilter: { learnerId?: { in: string[] }; userId?: { in: string[] } }) {
  await prisma.schoolTransferRequest.updateMany({
    where: { ...personFilter, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}

function isPendingUniqueConflict(err: unknown): boolean {
  if ((err as { code?: unknown } | null)?.code !== "P2002") return false;
  return err instanceof Error ? /pending_unique|learnerId|userId/.test(err.message + JSON.stringify((err as { meta?: unknown }).meta ?? "")) : true;
}

/** Send people to another school in the same division. Nothing moves yet. */
export const requestSchoolTransfers = action(
  "requestSchoolTransfers",
  async (input: unknown): Promise<{ ok: true; data: { batchId: string; count: number } }> => {
    const parsed = parseInput(requestSchoolTransfersSchema, input);
    const { user, schoolId } = await resolveTransferActor(parsed.schoolId);
    const ids = [...new Set(parsed.ids)];

    const schools = await prisma.school.findMany({
      where: { id: { in: [schoolId, parsed.toSchoolId] }, deletedAt: null },
      select: { id: true, division: true, isActive: true },
    });
    const from = schools.find((s) => s.id === schoolId);
    const to = schools.find((s) => s.id === parsed.toSchoolId);
    if (!from) throw resourceNotFound("School");
    if (!to || !canTransferBetween(from, to)) {
      throw fieldError("toSchoolId", "Pick an active school in your division");
    }
    await assertSchoolYearOpen(schoolId);
    await assertSchoolYearOpen(to.id);

    if (parsed.kind === "LEARNER") {
      const found = await prisma.learner.findMany({
        where: { id: { in: ids }, schoolId, deletedAt: null, archivedAt: null },
        select: { id: true },
      });
      if (found.length !== ids.length) throw resourceNotFound("Learner");
      await expireStale({ learnerId: { in: ids } });
    } else {
      const found = await prisma.user.findMany({
        where: {
          id: { in: ids },
          schoolId,
          role: "TEACHER",
          deletedAt: null,
          isActive: true,
          approvalStatus: "APPROVED",
        },
        select: { id: true, teacherProfile: { select: { designation: true } } },
      });
      if (found.length !== ids.length) throw resourceNotFound("Teacher");
      if (found.some((t) => transferKindForTeacher(t.teacherProfile?.designation) !== parsed.kind)) {
        throw fieldError("kind", "Send teachers and ARAL volunteers from their own tabs");
      }
      await expireStale({ userId: { in: ids } });
    }

    const personKey = parsed.kind === "LEARNER" ? "learnerId" : "userId";
    const pending = await prisma.schoolTransferRequest.count({
      where: { [personKey]: { in: ids }, status: "PENDING" },
    });
    if (pending > 0) {
      throw new AppError("TRANSFER_REQUEST_PENDING", {
        params: {
          learners: pending === 1 ? "1 person" : `${pending} people`,
          have: pending === 1 ? "has" : "have",
        },
      });
    }

    const batchId = crypto.randomUUID();
    const now = new Date();
    try {
      await prisma.schoolTransferRequest.createMany({
        data: ids.map((id) => ({
          batchId,
          kind: parsed.kind,
          learnerId: parsed.kind === "LEARNER" ? id : null,
          userId: parsed.kind === "LEARNER" ? null : id,
          schoolId,
          toSchoolId: to.id,
          requestedById: user.id,
          reason: parsed.reason ?? null,
          expiresAt: expiresAtFor(now),
        })),
      });
    } catch (err) {
      if (isPendingUniqueConflict(err)) {
        throw new AppError("TRANSFER_REQUEST_PENDING", {
          cause: err,
          params: { learners: "Someone you chose", have: "has" },
        });
      }
      throw err;
    }

    await notifySchoolTransfer({ type: "REQUESTED", batchId, actorId: user.id });
    revalidateSchoolTransfers([schoolId, to.id]);
    return { ok: true, data: { batchId, count: ids.length } };
  },
  { verb: "send the transfer" }
);

/** Sender: withdraw transfers nobody has answered yet. */
export const cancelSchoolTransfers = action(
  "cancelSchoolTransfers",
  async (input: unknown): Promise<{ ok: true; data: { count: number } }> => {
    const parsed = parseInput(cancelSchoolTransfersSchema, input);
    const { user, schoolId } = await resolveTransferActor(parsed.schoolId);
    const now = new Date();
    const targets = await prisma.schoolTransferRequest.findMany({
      where: { id: { in: parsed.ids }, schoolId },
      select: { toSchoolId: true },
    });
    const { count } = await prisma.schoolTransferRequest.updateMany({
      where: { id: { in: parsed.ids }, schoolId, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "CANCELLED", decidedById: user.id, decidedAt: now },
    });
    if (count === 0) throw new AppError("TRANSFER_REQUESTS_CHANGED");
    revalidateSchoolTransfers([schoolId, ...targets.map((t) => t.toSchoolId)]);
    return { ok: true, data: { count } };
  },
  { verb: "cancel the transfer" }
);

/** Receiver: turn transfers down, with an optional note the sender sees. */
export const declineSchoolTransfers = action(
  "declineSchoolTransfers",
  async (input: unknown): Promise<{ ok: true; data: { count: number } }> => {
    const parsed = parseInput(declineSchoolTransfersSchema, input);
    const { user, schoolId } = await resolveTransferActor(parsed.schoolId);
    const now = new Date();
    const rows = await prisma.schoolTransferRequest.findMany({
      where: { id: { in: parsed.ids }, toSchoolId: schoolId, status: "PENDING", expiresAt: { gt: now } },
      select: { id: true, schoolId: true },
    });
    const ids = rows.map((r) => r.id);
    const { count } = ids.length
      ? await prisma.schoolTransferRequest.updateMany({
          where: { id: { in: ids }, toSchoolId: schoolId, status: "PENDING" },
          data: {
            status: "DECLINED",
            decidedById: user.id,
            decidedAt: now,
            decisionNote: parsed.note ?? null,
          },
        })
      : { count: 0 };
    if (count === 0) throw new AppError("TRANSFER_REQUESTS_CHANGED");
    await notifySchoolTransfer({ type: "DECIDED", ids, actorId: user.id });
    revalidateSchoolTransfers([schoolId, ...rows.map((r) => r.schoolId)]);
    return { ok: true, data: { count } };
  },
  { verb: "decline the transfer" }
);

/**
 * Receiver: accept transfers. Rows that can no longer be accepted (answered,
 * expired, the person moved or was removed at the sending school) are skipped
 * and reported; the rest move in one transaction. Learner rows of one accept
 * share one placement, picked by the receiver; the section's adviser becomes
 * the learner's adviser, or none when the section has no adviser yet.
 */
export const acceptSchoolTransfers = action(
  "acceptSchoolTransfers",
  async (
    input: unknown
  ): Promise<{ ok: true; data: { accepted: number; skipped: { id: string; reason: SkipReason }[] } }> => {
    const parsed = parseInput(acceptSchoolTransfersSchema, input);
    const { user, schoolId } = await resolveTransferActor(parsed.schoolId);
    const now = new Date();

    const rows = await prisma.schoolTransferRequest.findMany({
      where: { id: { in: parsed.ids }, toSchoolId: schoolId },
      select: {
        id: true,
        kind: true,
        status: true,
        expiresAt: true,
        schoolId: true,
        learnerId: true,
        userId: true,
        learner: { select: { schoolId: true, deletedAt: true, archivedAt: true } },
        user: { select: { schoolId: true, deletedAt: true, isActive: true } },
      },
    });
    if (rows.length === 0) throw resourceNotFound("Transfer");

    const skipped: { id: string; reason: SkipReason }[] = [];
    const ready: typeof rows = [];
    for (const r of rows) {
      const status = effectiveStatus(r, now);
      const person = r.learner ?? r.user;
      if (status === "EXPIRED") skipped.push({ id: r.id, reason: "EXPIRED" });
      else if (status !== "PENDING") skipped.push({ id: r.id, reason: "NOT_PENDING" });
      else if (
        !person ||
        person.deletedAt ||
        (r.learner && r.learner.archivedAt) ||
        (r.user && !r.user.isActive)
      ) {
        skipped.push({ id: r.id, reason: "REMOVED" });
      } else if (person.schoolId !== r.schoolId) skipped.push({ id: r.id, reason: "MOVED" });
      else ready.push(r);
    }

    let placement: { gradeLevelId: string; sectionId: string; teacherId: string | null } | null = null;
    if (ready.some((r) => r.kind === "LEARNER")) {
      if (!parsed.placement) throw fieldError("placement", "Choose a grade and section for the learners");
      const section = await prisma.section.findFirst({
        where: {
          id: parsed.placement.sectionId,
          schoolId,
          gradeLevelId: parsed.placement.gradeLevelId,
          deletedAt: null,
          gradeLevel: { deletedAt: null, type: { not: "FLOATING" } },
        },
        select: { id: true, gradeLevelId: true, adviser: { select: { id: true, isActive: true, deletedAt: true } } },
      });
      if (!section) throw fieldError("placement", "That section was not found. Choose another section.");
      const adviser = section.adviser && section.adviser.isActive && !section.adviser.deletedAt ? section.adviser.id : null;
      placement = { gradeLevelId: section.gradeLevelId, sectionId: section.id, teacherId: adviser };
    }

    if (ready.length > 0) {
      await assertSchoolYearOpen(schoolId);
      for (const from of new Set(ready.map((r) => r.schoolId))) await assertSchoolYearOpen(from);

      await prisma.$transaction(async (tx) => {
        for (const r of ready) {
          const { count } = await tx.schoolTransferRequest.updateMany({
            where: { id: r.id, status: "PENDING" },
            data: { status: "ACCEPTED", decidedById: user.id, decidedAt: now },
          });
          if (count !== 1) throw new AppError("TRANSFER_REQUESTS_CHANGED");
          if (r.kind === "LEARNER") {
            await applyLearnerSchoolMove(tx, {
              learnerId: r.learnerId as string,
              toSchoolId: schoolId,
              gradeLevelId: placement!.gradeLevelId,
              sectionId: placement!.sectionId,
              teacherId: placement!.teacherId,
              actorId: user.id,
            });
          } else {
            await applyStaffSchoolMove(tx, {
              userId: r.userId as string,
              fromSchoolId: r.schoolId,
              toSchoolId: schoolId,
            });
          }
        }
      });

      const staff = ready.filter((r) => r.kind !== "LEARNER");
      if (staff.length > 0) {
        await writeAuditMany(
          staff.map((r) => ({
            userId: user.id,
            schoolId,
            action: AUDIT_ACTIONS.STAFF_SCHOOL_TRANSFER_ACCEPTED,
            resource: "User",
            resourceId: r.userId as string,
            metadata: { userId: r.userId, fromSchoolId: r.schoolId, toSchoolId: schoolId, transferId: r.id },
          }))
        );
      }

      await notifySchoolTransfer({ type: "DECIDED", ids: ready.map((r) => r.id), actorId: user.id });
      const schools = [schoolId, ...new Set(ready.map((r) => r.schoolId))];
      revalidateSchoolTransfers(schools);
      if (ready.some((r) => r.kind === "LEARNER")) {
        for (const id of schools) {
          revalidateLearnerScoped({ schoolId: id, teacherId: placement?.teacherId, teacherShell: true });
        }
      }
      for (const r of staff) revalidateTeacherCaches(r.userId as string);
    }

    return { ok: true, data: { accepted: ready.length, skipped } };
  },
  { verb: "accept the transfer" }
);
