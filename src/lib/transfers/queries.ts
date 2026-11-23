import "server-only";
import type { SchoolTransferKind, SchoolTransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { effectiveStatus, normalizeDivision, transferKindForTeacher } from "@/lib/transfers/school-transfer-rules";

/**
 * Reads behind the Transfer page. Every read is scoped to the one school the
 * caller already resolved through `resolveSchoolContext` / admin scope.
 * `SchoolTransferRequest.schoolId` is the sending school.
 */

export type TransferTarget = { id: string; name: string };

export type TransferCandidate = {
  id: string;
  name: string;
  /** "Grade 4 · Mabini" for a learner; designation and advisory for staff. */
  detail: string;
  /** Receiving school's name while a transfer is waiting, else null. */
  pendingTo: string | null;
  /** Filter group: the learner's grade; empty for staff. */
  group: string;
};

export type TransferRow = {
  id: string;
  batchId: string;
  personName: string;
  detail: string;
  otherSchoolName: string;
  status: SchoolTransferStatus;
  reason: string | null;
  decisionNote: string | null;
  createdAt: string;
  expiresAt: string;
  requestedByName: string | null;
  direction: "outgoing" | "incoming";
};

export type PlacementOptions = {
  grades: { id: string; label: string; sections: { id: string; name: string; adviserName: string | null }[] }[];
};

const gradeLabel = (type: string | null | undefined) => (type ? GRADE_LEVEL_LABELS[type] ?? type : "No grade");

/** Active schools in the same division, this school excluded. */
export async function listTransferTargets(schoolId: string): Promise<TransferTarget[]> {
  const me = await prisma.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: { division: true },
  });
  const division = me?.division?.trim();
  if (!division || !normalizeDivision(division)) return [];
  const rows = await prisma.school.findMany({
    where: {
      id: { not: schoolId },
      isActive: true,
      deletedAt: null,
      isDemo: false,
      division: { equals: division, mode: "insensitive" },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows;
}

/** People of this school who could be sent, with any waiting transfer. */
export async function listTransferCandidates(
  schoolId: string,
  kind: SchoolTransferKind
): Promise<TransferCandidate[]> {
  const now = new Date();
  const pendingWhere = { status: "PENDING" as const, expiresAt: { gt: now } };
  const pendingSelect = { select: { toSchool: { select: { name: true } } }, take: 1 } as const;

  if (kind === "LEARNER") {
    const learners = await prisma.learner.findMany({
      where: { schoolId, deletedAt: null, archivedAt: null },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        schoolTransferRequests: { where: pendingWhere, ...pendingSelect },
      },
    });
    return learners.map((l) => ({
      id: l.id,
      name: l.fullName,
      detail: [gradeLabel(l.gradeLevel?.type), l.section?.name].filter(Boolean).join(" · "),
      pendingTo: l.schoolTransferRequests[0]?.toSchool.name ?? null,
      group: l.gradeLevel ? gradeLabel(l.gradeLevel.type) : "No grade",
    }));
  }

  const teachers = await prisma.user.findMany({
    where: { schoolId, role: "TEACHER", deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      teacherProfile: { select: { designation: true } },
      advisorySections: {
        where: { deletedAt: null },
        select: { name: true, gradeLevel: { select: { type: true } } },
      },
      schoolTransfers: { where: pendingWhere, ...pendingSelect },
    },
  });
  return teachers
    .filter((t) => transferKindForTeacher(t.teacherProfile?.designation) === kind)
    .map((t) => {
      const advisory = t.advisorySections.map((s) => `${gradeLabel(s.gradeLevel?.type)} · ${s.name}`).join(", ");
      return {
        id: t.id,
        name: t.fullName,
        detail: [t.teacherProfile?.designation, advisory ? `Advises ${advisory}` : null].filter(Boolean).join(" — "),
        pendingTo: t.schoolTransfers[0]?.toSchool.name ?? null,
        group: "",
      };
    });
}

const HISTORY_DAYS = 90;

/**
 * Outgoing: this school sent, still waiting. Incoming: sent here, waiting.
 * History: answered, cancelled or expired in the last 90 days, both ways.
 * Expired-but-unstored rows count as history, never as waiting.
 */
export async function listSchoolTransfers(
  schoolId: string,
  kind: SchoolTransferKind,
  direction: "outgoing" | "incoming" | "history"
): Promise<TransferRow[]> {
  const now = new Date();
  const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const side =
    direction === "outgoing"
      ? { schoolId }
      : direction === "incoming"
        ? { toSchoolId: schoolId }
        : { OR: [{ schoolId }, { toSchoolId: schoolId }] };
  const statusWhere =
    direction === "history"
      ? { OR: [{ status: { not: "PENDING" as const } }, { expiresAt: { lte: now } }], createdAt: { gte: since } }
      : { status: "PENDING" as const, expiresAt: { gt: now } };

  const rows = await prisma.schoolTransferRequest.findMany({
    where: { kind, AND: [side, statusWhere] },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      batchId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      reason: true,
      decisionNote: true,
      schoolId: true,
      fromSchool: { select: { name: true } },
      toSchool: { select: { name: true } },
      requestedBy: { select: { fullName: true } },
      learner: {
        select: {
          fullName: true,
          schoolId: true,
          gradeLevel: { select: { type: true } },
          section: { select: { name: true } },
        },
      },
      user: { select: { fullName: true, teacherProfile: { select: { designation: true } } } },
    },
  });

  return rows.map((r) => {
    const outgoing = r.schoolId === schoolId;
    // A learner's grade and section are shown only while they belong to the
    // viewing school, or to the sender of a transfer still waiting (what the
    // receiver decides on). Once moved, the sender never sees where at the
    // other school the learner was placed.
    const status = effectiveStatus(r, now);
    const placementVisible =
      r.learner &&
      (r.learner.schoolId === schoolId || (status === "PENDING" && r.learner.schoolId === r.schoolId));
    const detail = r.learner
      ? placementVisible
        ? [gradeLabel(r.learner.gradeLevel?.type), r.learner.section?.name].filter(Boolean).join(" · ")
        : ""
      : r.user?.teacherProfile?.designation ?? "";
    return {
      id: r.id,
      batchId: r.batchId,
      personName: r.learner?.fullName ?? r.user?.fullName ?? "Removed",
      detail,
      otherSchoolName: outgoing ? r.toSchool.name : r.fromSchool.name,
      status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      requestedByName: r.requestedBy?.fullName ?? null,
      direction: outgoing ? "outgoing" : "incoming",
    };
  });
}

/** Grades (not FLOATING) and their sections at this school, for an accept. */
export async function listPlacementOptions(schoolId: string): Promise<PlacementOptions> {
  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId, deletedAt: null, type: { not: "FLOATING" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      sections: {
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, adviser: { select: { fullName: true, isActive: true, deletedAt: true } } },
      },
    },
  });
  return {
    grades: grades.map((g) => ({
      id: g.id,
      label: gradeLabel(g.type),
      sections: g.sections.map((s) => ({
        id: s.id,
        name: s.name,
        adviserName: s.adviser && s.adviser.isActive && !s.adviser.deletedAt ? s.adviser.fullName : null,
      })),
    })),
  };
}

/** This school's division as stored, or null when it has none. */
export async function getTransferDivision(schoolId: string): Promise<string | null> {
  const school = await prisma.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: { division: true },
  });
  const division = school?.division?.trim();
  return division && normalizeDivision(division) ? division : null;
}

/** Waiting, unexpired transfers sent to this school, per kind (tab badges). */
export async function countIncomingByKind(schoolId: string): Promise<Record<SchoolTransferKind, number>> {
  const groups = await prisma.schoolTransferRequest.groupBy({
    by: ["kind"],
    where: { toSchoolId: schoolId, status: "PENDING", expiresAt: { gt: new Date() } },
    _count: { _all: true },
  });
  const counts: Record<SchoolTransferKind, number> = { LEARNER: 0, TEACHER: 0, ARAL_VOLUNTEER: 0 };
  for (const g of groups) counts[g.kind] = g._count._all;
  return counts;
}

/** The `?kind=` values of the Transfer page. */
export const TRANSFER_KIND_PARAMS = {
  learners: "LEARNER",
  teachers: "TEACHER",
  "aral-volunteers": "ARAL_VOLUNTEER",
} as const satisfies Record<string, SchoolTransferKind>;

export type TransferKindParam = keyof typeof TRANSFER_KIND_PARAMS;

/** `?kind=` to a kind; anything unknown is learners. */
export function parseTransferKind(raw: string | undefined): { param: TransferKindParam; kind: SchoolTransferKind } {
  const param = (raw && raw in TRANSFER_KIND_PARAMS ? raw : "learners") as TransferKindParam;
  return { param, kind: TRANSFER_KIND_PARAMS[param] };
}

/** Everything the workspace needs for one school and one kind, in parallel. */
export async function loadTransferWorkspace(schoolId: string, kind: SchoolTransferKind) {
  const [division, targets, candidates, outgoing, incoming, history, placement, incomingCounts] = await Promise.all([
    getTransferDivision(schoolId),
    listTransferTargets(schoolId),
    listTransferCandidates(schoolId, kind),
    listSchoolTransfers(schoolId, kind, "outgoing"),
    listSchoolTransfers(schoolId, kind, "incoming"),
    listSchoolTransfers(schoolId, kind, "history"),
    kind === "LEARNER" ? listPlacementOptions(schoolId) : Promise.resolve<PlacementOptions>({ grades: [] }),
    countIncomingByKind(schoolId),
  ]);
  return { division, targets, candidates, rows: { outgoing, incoming, history }, placement, incomingCounts };
}
