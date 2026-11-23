import "server-only";
import type { SchoolTransferKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import type { ShellNotification } from "@/components/shell/notifications-menu";

/**
 * Bell notifications for cross-school transfers. One row per recipient per
 * batch, pointing at the batch by `Notification.batchId`; the sentence is
 * composed at read time from the transfer rows, like the other bell types, so
 * no names are copied into the notification table.
 *
 *  - REQUESTED → every active School Head of the receiving school.
 *  - DECIDED   → every active School Head of the sending school, plus each
 *                accepted teacher or volunteer (written under their NEW school).
 *
 * Never throws: a failed notification must not undo a transfer.
 */
export type SchoolTransferEvent =
  | { type: "REQUESTED"; batchId: string; actorId: string }
  | { type: "DECIDED"; ids: string[]; actorId: string };

async function schoolHeadIds(schoolId: string): Promise<string[]> {
  const heads = await prisma.user.findMany({
    where: { schoolId, role: "SCHOOL_HEAD", deletedAt: null, isActive: true },
    select: { id: true },
  });
  return heads.map((h) => h.id);
}

export async function notifySchoolTransfer(event: SchoolTransferEvent): Promise<void> {
  try {
    if (event.type === "REQUESTED") {
      const first = await prisma.schoolTransferRequest.findFirst({
        where: { batchId: event.batchId },
        select: { toSchoolId: true },
      });
      if (!first) return;
      const heads = await schoolHeadIds(first.toSchoolId);
      if (heads.length === 0) return;
      await prisma.notification.createMany({
        data: heads.map((recipientId) => ({
          schoolId: first.toSchoolId,
          recipientId,
          actorId: event.actorId,
          type: "SCHOOL_TRANSFER_REQUESTED" as const,
          learnerIds: [],
          batchId: event.batchId,
        })),
      });
      return;
    }

    const rows = await prisma.schoolTransferRequest.findMany({
      where: { id: { in: event.ids } },
      select: { batchId: true, schoolId: true, toSchoolId: true, status: true, userId: true },
    });
    const data: {
      schoolId: string;
      recipientId: string;
      actorId: string;
      type: "SCHOOL_TRANSFER_DECIDED";
      learnerIds: string[];
      batchId: string;
    }[] = [];
    const batches = new Map<string, string>();
    for (const r of rows) batches.set(r.batchId, r.schoolId);
    for (const [batchId, fromSchoolId] of batches) {
      for (const recipientId of await schoolHeadIds(fromSchoolId)) {
        data.push({ schoolId: fromSchoolId, recipientId, actorId: event.actorId, type: "SCHOOL_TRANSFER_DECIDED", learnerIds: [], batchId });
      }
    }
    for (const r of rows) {
      if (r.status === "ACCEPTED" && r.userId) {
        data.push({
          schoolId: r.toSchoolId,
          recipientId: r.userId,
          actorId: event.actorId,
          type: "SCHOOL_TRANSFER_DECIDED",
          learnerIds: [],
          batchId: r.batchId,
        });
      }
    }
    if (data.length > 0) await prisma.notification.createMany({ data });
  } catch (err) {
    console.error("[notifications] school transfer write failed:", err);
  }
}

const PLURAL: Record<SchoolTransferKind, [string, string]> = {
  LEARNER: ["learner", "learners"],
  TEACHER: ["teacher", "teachers"],
  ARAL_VOLUNTEER: ["ARAL volunteer", "ARAL volunteers"],
};

function count(n: number, kind: SchoolTransferKind): string {
  return `${n} ${PLURAL[kind][n === 1 ? 0 : 1]}`;
}

/** The moved teacher's notice shows this long, then drops off the bell. */
const MOVED_NOTICE_DAYS = 14;

/**
 * Unread transfer notices for the header bell. A School Head's notices clear
 * when they open the Transfer page (`markSchoolTransferNoticesRead`); a moved
 * teacher's notice simply ages out, since there is no one page it points at.
 */
export async function getSchoolTransferBellNotifications(user: {
  id: string;
  schoolId: string;
  role: UserRole;
}): Promise<ShellNotification[]> {
  const since = new Date(Date.now() - MOVED_NOTICE_DAYS * 24 * 60 * 60 * 1000);
  const notices = await prisma.notification.findMany({
    where: {
      recipientId: user.id,
      schoolId: user.schoolId,
      type: { in: ["SCHOOL_TRANSFER_REQUESTED", "SCHOOL_TRANSFER_DECIDED"] },
      readAt: null,
      batchId: { not: null },
      ...(user.role === "TEACHER" ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, type: true, batchId: true },
  });
  if (notices.length === 0) return [];

  const batchIds = [...new Set(notices.map((n) => n.batchId as string))];
  const rows = await prisma.schoolTransferRequest.findMany({
    where: { batchId: { in: batchIds } },
    select: {
      batchId: true,
      kind: true,
      status: true,
      userId: true,
      fromSchool: { select: { name: true } },
      toSchool: { select: { name: true } },
    },
  });

  const href = SCHOOL_HEAD_ROUTES.transfer;
  const out: ShellNotification[] = [];
  for (const n of notices) {
    const batch = rows.filter((r) => r.batchId === n.batchId);
    if (batch.length === 0) continue;
    const { kind, fromSchool, toSchool } = batch[0];

    if (user.role === "TEACHER") {
      const mine = batch.find((r) => r.userId === user.id && r.status === "ACCEPTED");
      if (!mine) continue;
      out.push({
        id: n.id,
        title: `You moved to ${toSchool.name}.`,
        description: `Next time you sign in, choose ${toSchool.name}.`,
        href: "/teacher",
        tone: "amber",
      });
      continue;
    }

    if (n.type === "SCHOOL_TRANSFER_REQUESTED") {
      out.push({
        id: n.id,
        title: `${fromSchool.name} sent ${count(batch.length, kind)} to your school.`,
        description: "Review them on Transfer.",
        href,
        tone: "amber",
      });
    } else {
      const accepted = batch.filter((r) => r.status === "ACCEPTED").length;
      const declined = batch.filter((r) => r.status === "DECLINED").length;
      out.push({
        id: n.id,
        title: `${toSchool.name} accepted ${accepted} and declined ${declined} of your transfer of ${count(batch.length, kind)}.`,
        description: "See the details on Transfer.",
        href,
        tone: "muted",
      });
    }
  }
  return out;
}

/** Clear a School Head's transfer notices; called when the Transfer page renders. */
export async function markSchoolTransferNoticesRead(input: {
  recipientId: string;
  schoolId: string;
}): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      recipientId: input.recipientId,
      schoolId: input.schoolId,
      type: { in: ["SCHOOL_TRANSFER_REQUESTED", "SCHOOL_TRANSFER_DECIDED"] },
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

/** Pending, unexpired transfers waiting for this school's answer. */
export async function countIncomingTransfers(schoolId: string): Promise<number> {
  return prisma.schoolTransferRequest.count({
    where: { toSchoolId: schoolId, status: "PENDING", expiresAt: { gt: new Date() } },
  });
}
