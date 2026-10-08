import "server-only";
import type { SectionTransferRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  evaluateSectionTransfer,
  type TransferBlockReason,
} from "@/lib/learners/section-transfer";

/**
 * Read helpers for section transfers (docs/specs/learner-section-transfers.md
 * §2d). All uncached — they back pages a School Head or teacher expects fresh
 * right after deciding — and every one filters by `schoolId` in its `where`.
 * Callers pass `user.schoolId` from `requireSchoolUser`, or the school resolved
 * by `resolveSchoolContext` for a Super Admin drill-down, never a request value.
 */

export type TransferDestination = {
  id: string;
  name: string;
  gradeLevelId: string;
  /** Null when the section has no adviser, or one who cannot take learners. */
  adviser: { id: string; fullName: string } | null;
};

/**
 * Live sections in the given grades, for the transfer dialog. The FLOATING
 * grade has no sections to move within and is excluded. An adviser who is
 * removed, deactivated or not a teacher is reported as no adviser — the same
 * rule `evaluateSectionTransfer` refuses on (`no-adviser`).
 */
export async function listTransferDestinations(
  schoolId: string,
  gradeLevelIds: string[]
): Promise<TransferDestination[]> {
  if (gradeLevelIds.length === 0) return [];
  const sections = await prisma.section.findMany({
    where: {
      schoolId,
      deletedAt: null,
      gradeLevelId: { in: gradeLevelIds },
      gradeLevel: { deletedAt: null, type: { not: "FLOATING" } },
    },
    select: {
      id: true,
      name: true,
      gradeLevelId: true,
      adviser: {
        select: { id: true, fullName: true, deletedAt: true, isActive: true, role: true },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return sections.map((s) => {
    const a = s.adviser;
    const usable = a && !a.deletedAt && a.isActive && a.role === "TEACHER";
    return {
      id: s.id,
      name: s.name,
      gradeLevelId: s.gradeLevelId,
      adviser: usable ? { id: a.id, fullName: a.fullName } : null,
    };
  });
}

export type PendingTransfer = {
  requestId: string;
  toSectionName: string;
  /**
   * Who filed the request. Only that teacher can cancel it
   * (`cancelSectionTransferRequest` filters `requestedById: user.id`), so the
   * roster offers Cancel only when this equals the viewer's id. Null when the
   * requester's account was removed.
   */
  requestedById: string | null;
};

/** The waiting request, if any, for each of these learners (one per learner by index). */
export async function pendingTransfersByLearner(
  schoolId: string,
  learnerIds: string[]
): Promise<Map<string, PendingTransfer>> {
  if (learnerIds.length === 0) return new Map();
  const rows = await prisma.sectionTransferRequest.findMany({
    where: { schoolId, learnerId: { in: learnerIds }, status: "PENDING" },
    select: {
      id: true,
      learnerId: true,
      requestedById: true,
      toSection: { select: { name: true } },
    },
  });
  return new Map(
    rows.map((r) => [
      r.learnerId,
      { requestId: r.id, toSectionName: r.toSection.name, requestedById: r.requestedById },
    ])
  );
}

/**
 * Every waiting request in the school. `listPendingTransferRequests` returns at
 * most `take` rows (oldest first), so the panel compares the row count against
 * this to say it is showing only the oldest ones. Same `where` as the dashboard
 * count, so the two numbers agree.
 */
export async function countPendingTransferRequests(schoolId: string): Promise<number> {
  return prisma.sectionTransferRequest.count({ where: { schoolId, status: "PENDING" } });
}

export type PendingTransferRequestRow = {
  id: string;
  learner: { id: string; fullName: string; gradeLevelId: string; gradeType: string };
  fromSection: { id: string; name: string };
  toSection: { id: string; name: string; adviser: { id: string; fullName: string } | null };
  requestedBy: { id: string; fullName: string } | null;
  /** Teacher's note. Shown to the School Head; never written to audit metadata. */
  reason: string | null;
  createdAt: Date;
  /** Why approving would be refused right now, or null when it would go through. */
  staleReason: TransferBlockReason | null;
};

/**
 * The School Head's waiting requests, oldest first, each re-evaluated against
 * current data so the panel can flag the ones an approval would refuse.
 * Requests for a learner removed or archived since are kept on purpose: they
 * come back flagged `learner-unavailable`, so the School Head can decline them
 * instead of their waiting forever.
 */
export async function listPendingTransferRequests(
  schoolId: string,
  take = 100
): Promise<PendingTransferRequestRow[]> {
  const rows = await prisma.sectionTransferRequest.findMany({
    where: { schoolId, status: "PENDING" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
    select: {
      id: true,
      reason: true,
      createdAt: true,
      fromSectionId: true,
      learner: {
        select: {
          id: true,
          fullName: true,
          schoolId: true,
          gradeLevelId: true,
          sectionId: true,
          deletedAt: true,
          archivedAt: true,
          gradeLevel: { select: { type: true } },
        },
      },
      fromSection: { select: { id: true, name: true } },
      toSection: {
        select: {
          id: true,
          name: true,
          schoolId: true,
          gradeLevelId: true,
          deletedAt: true,
          gradeLevel: { select: { deletedAt: true } },
          adviser: {
            select: { id: true, fullName: true, deletedAt: true, isActive: true, role: true },
          },
        },
      },
      requestedBy: { select: { id: true, fullName: true } },
    },
  });

  return rows.map((r) => {
    const { learner, toSection } = r;
    const verdict = evaluateSectionTransfer({
      actorSchoolId: schoolId,
      learner: {
        id: learner.id,
        schoolId: learner.schoolId,
        gradeLevelId: learner.gradeLevelId,
        gradeType: learner.gradeLevel.type,
        sectionId: learner.sectionId,
        deletedAt: learner.deletedAt,
        archivedAt: learner.archivedAt,
      },
      destination: {
        id: toSection.id,
        schoolId: toSection.schoolId,
        gradeLevelId: toSection.gradeLevelId,
        deletedAt: toSection.deletedAt,
        gradeDeletedAt: toSection.gradeLevel.deletedAt,
        adviser: toSection.adviser,
      },
      expectedFromSectionId: r.fromSectionId,
      hasPendingRequest: false,
    });
    const adviser = toSection.adviser;
    const usableAdviser = adviser && !adviser.deletedAt && adviser.isActive && adviser.role === "TEACHER";
    return {
      id: r.id,
      learner: {
        id: learner.id,
        fullName: learner.fullName,
        gradeLevelId: learner.gradeLevelId,
        gradeType: learner.gradeLevel.type,
      },
      fromSection: r.fromSection,
      toSection: {
        id: toSection.id,
        name: toSection.name,
        adviser: usableAdviser ? { id: adviser.id, fullName: adviser.fullName } : null,
      },
      requestedBy: r.requestedBy,
      reason: r.reason,
      createdAt: r.createdAt,
      staleReason: verdict.ok ? null : verdict.reason,
    };
  });
}

export type TeacherTransferRequestRow = {
  id: string;
  status: SectionTransferRequestStatus;
  learner: { id: string; fullName: string };
  fromSectionName: string;
  toSectionName: string;
  reason: string | null;
  /** The School Head's decline note. */
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/**
 * A teacher's own requests: every pending one, plus those decided (approved,
 * declined or withdrawn) in the last `sinceDays` days. Newest first. This strip
 * is the teacher's only notice of a decision (operator decision §9.6).
 */
export async function listTeacherTransferRequests(
  schoolId: string,
  teacherId: string,
  sinceDays = 14
): Promise<TeacherTransferRequestRow[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.sectionTransferRequest.findMany({
    where: {
      schoolId,
      requestedById: teacherId,
      learner: { deletedAt: null },
      OR: [{ status: "PENDING" }, { decidedAt: { gte: since } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      status: true,
      reason: true,
      decisionNote: true,
      createdAt: true,
      decidedAt: true,
      learner: { select: { id: true, fullName: true } },
      fromSection: { select: { name: true } },
      toSection: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    learner: r.learner,
    fromSectionName: r.fromSection.name,
    toSectionName: r.toSection.name,
    reason: r.reason,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
  }));
}
