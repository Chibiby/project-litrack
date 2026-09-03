"use server";

import { revalidatePath } from "next/cache";
import type {
  Prisma,
  SupportTicketCategory,
  SupportTicketStatus,
  UnlockScope,
  UserRole,
} from "@prisma/client";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { revalidateSupportTicket } from "@/lib/cache/revalidate";
import { prisma } from "@/lib/prisma";
import { listMyTickets } from "@/lib/support/queries";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  declineTicketSchema,
  resolveTicketSchema,
  revokeGrantSchema,
  submitTicketSchema,
} from "@/lib/validators/support.schema";

/**
 * Support tickets and the unlock grants that answer them.
 *
 * Two trust boundaries meet here, and they are not the same boundary:
 *
 * - **Raising** a ticket is school-scoped. A teacher or school head files
 *   against their own school and can only ever read their own tickets.
 * - **Answering** one is cross-tenant and Super Admin only, like `/admin/audit`.
 *   The division admin is a division-wide role by definition, so the inbox
 *   deliberately has no `schoolId` filter.
 *
 * The PII rule is stricter here than anywhere else in the app: `subject` and
 * `body` are free text written by somebody describing a problem with their
 * class, so they will name learners. Those two columns are never copied into
 * `AuditLog.metadata`, never into a `Notification`, and never into an error
 * message. Audit rows carry ids, the category, and the grant's shape.
 */

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const SUPPORT_ROUTE = "/admin/support";

/**
 * One of the requester's own tickets, as the assistant renders it.
 *
 * Narrower than `TicketRow`: the panel lists subjects and outcomes, so the
 * body — the person's own free text about their class — never has to cross the
 * wire a second time to be shown back to them.
 */
export type MySupportTicket = {
  id: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  subject: string;
  createdAt: Date;
  resolutionNote: string | null;
  requestedScope: UnlockScope | null;
  requestedTargetKey: string | null;
  /** When the grant this ticket produced runs out, if it produced a live one. */
  grantExpiresAt: Date | null;
};

/** Five tickets an hour per person: enough for a bad day, not enough to flood the queue. */
const SUBMIT_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };

/** Roles that may raise a ticket. Super Admin answers them; it does not file them. */
const REQUESTER_ROLES: UserRole[] = ["TEACHER", "SCHOOL_HEAD"];

/**
 * Raise a ticket for the division admin.
 *
 * `requireSchoolUser` rather than `requireUser`, because a ticket needs a school
 * to belong to. That also means a Super Admin cannot file one — see the note in
 * the module comment.
 */
export async function submitTicket(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireSchoolUser(REQUESTER_ROLES);

  const parsed = submitTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const limit = await checkRateLimit(`support-ticket:${user.id}`, SUBMIT_LIMIT);
  if (!limit.ok) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterMs / 60_000));
    return {
      ok: false,
      error: `You have sent several requests already. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const { category, subject, body, pageUrl, requestedScope, requestedTargetKey } =
    parsed.data;

  const ticket = await prisma.supportTicket.create({
    data: {
      schoolId: user.schoolId,
      requesterId: user.id,
      category,
      subject,
      body,
      pageUrl: pageUrl ?? null,
      requestedScope: requestedScope ?? null,
      requestedTargetKey: category === "UNLOCK_REQUEST" ? requestedTargetKey ?? null : null,
    },
    select: { id: true },
  });

  // Notify every Super Admin. One row each: the feed is per-recipient, and there
  // is no "role inbox" row type to write instead.
  const admins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        schoolId: user.schoolId,
        recipientId: admin.id,
        actorId: user.id,
        type: "SUPPORT_TICKET_SUBMITTED" as const,
        learnerIds: [],
        ticketId: ticket.id,
      })),
    });
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SUPPORT_TICKET_SUBMIT,
    resource: "SupportTicket",
    resourceId: ticket.id,
    // Category and scope only. The subject and body are the person's own words
    // about their class and never belong in an audit row.
    metadata: {
      category,
      requestedScope: requestedScope ?? null,
      notifiedAdmins: admins.length,
    },
  });

  revalidateSupportTicket(user.id);
  revalidatePath(SUPPORT_ROUTE);

  return { ok: true, data: { id: ticket.id } };
}

/**
 * Resolve a ticket, optionally by issuing the unlock it asked for.
 *
 * Ticket update and grant creation share one transaction: a grant whose ticket
 * failed to close would leave an open request against an already-open window,
 * and a ticket closed as "granted" with no grant is worse — the teacher is told
 * they have access they do not have.
 */
export async function resolveTicket(input: unknown): Promise<ActionResult> {
  const admin = await requireUser(["SUPER_ADMIN"]);

  const parsed = resolveTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { ticketId, note, grant } = parsed.data;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      schoolId: true,
      requesterId: true,
      category: true,
      status: true,
      requestedScope: true,
      requestedTargetKey: true,
    },
  });
  if (!ticket) return { ok: false, error: "Not found" };
  if (ticket.status === "RESOLVED" || ticket.status === "DECLINED") {
    return { ok: false, error: "This request has already been answered" };
  }

  // Granting is only meaningful for a request that named a window to reopen.
  // Refusing here rather than ignoring the flag keeps "resolved with access"
  // from ever being claimed about a ticket that cannot carry it.
  if (grant) {
    if (
      ticket.category !== "UNLOCK_REQUEST" ||
      !ticket.requestedScope ||
      !ticket.requestedTargetKey
    ) {
      return { ok: false, error: "This request did not ask for access to a period" };
    }
  }

  const expiresAt = grant
    ? new Date(Date.now() + grant.days * 24 * 60 * 60 * 1000)
    : null;

  const grantId = await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: "RESOLVED",
        resolverId: admin.id,
        resolutionNote: note ?? null,
        resolvedAt: new Date(),
      },
    });

    if (!grant || !expiresAt || !ticket.requestedScope || !ticket.requestedTargetKey) {
      return null;
    }

    // Upsert on the natural key: a second grant for the same window replaces the
    // first rather than stacking, which is what makes "is it open?" a lookup of
    // one row and not a question about ordering.
    const row = await tx.unlockGrant.upsert({
      where: {
        userId_scope_targetKey: {
          userId: ticket.requesterId,
          scope: ticket.requestedScope,
          targetKey: ticket.requestedTargetKey,
        },
      },
      create: {
        schoolId: ticket.schoolId,
        userId: ticket.requesterId,
        scope: ticket.requestedScope,
        targetKey: ticket.requestedTargetKey,
        grantedById: admin.id,
        ticketId: ticket.id,
        expiresAt,
      },
      update: {
        grantedById: admin.id,
        ticketId: ticket.id,
        expiresAt,
        // A re-grant clears any previous revocation; otherwise the new expiry
        // would sit on a row that every read still treats as revoked.
        revokedAt: null,
        revokedById: null,
      },
      select: { id: true },
    });
    return row.id;
  });

  await notifyRequester(ticket.schoolId, ticket.requesterId, admin.id, ticket.id);

  await writeAudit({
    userId: admin.id,
    schoolId: ticket.schoolId,
    action: AUDIT_ACTIONS.SUPPORT_TICKET_RESOLVE,
    resource: "SupportTicket",
    resourceId: ticket.id,
    metadata: { category: ticket.category, granted: grantId !== null },
  });

  if (grantId && expiresAt) {
    await writeAudit({
      userId: admin.id,
      schoolId: ticket.schoolId,
      action: AUDIT_ACTIONS.UNLOCK_GRANT_ISSUE,
      resource: "UnlockGrant",
      resourceId: grantId,
      metadata: {
        ticketId: ticket.id,
        userId: ticket.requesterId,
        scope: ticket.requestedScope,
        targetKey: ticket.requestedTargetKey,
        expiresAt: expiresAt.toISOString(),
      },
    });
  }

  revalidateSupportTicket(ticket.requesterId);
  revalidatePath(SUPPORT_ROUTE);

  return { ok: true };
}

/** Close a ticket without granting anything. The note is required — see the schema. */
export async function declineTicket(input: unknown): Promise<ActionResult> {
  const admin = await requireUser(["SUPER_ADMIN"]);

  const parsed = declineTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: parsed.data.ticketId },
    select: { id: true, schoolId: true, requesterId: true, category: true, status: true },
  });
  if (!ticket) return { ok: false, error: "Not found" };
  if (ticket.status === "RESOLVED" || ticket.status === "DECLINED") {
    return { ok: false, error: "This request has already been answered" };
  }

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: "DECLINED",
      resolverId: admin.id,
      resolutionNote: parsed.data.note,
      resolvedAt: new Date(),
    },
  });

  await notifyRequester(ticket.schoolId, ticket.requesterId, admin.id, ticket.id);

  await writeAudit({
    userId: admin.id,
    schoolId: ticket.schoolId,
    action: AUDIT_ACTIONS.SUPPORT_TICKET_DECLINE,
    resource: "SupportTicket",
    resourceId: ticket.id,
    metadata: { category: ticket.category },
  });

  revalidateSupportTicket(ticket.requesterId);
  revalidatePath(SUPPORT_ROUTE);

  return { ok: true };
}

/**
 * End a grant before it expires.
 *
 * Revoking sets `revokedAt` rather than deleting the row: the question "who
 * could write into that closed week, and until when" has to stay answerable
 * after the fact.
 */
export async function revokeUnlockGrant(input: unknown): Promise<ActionResult> {
  const admin = await requireUser(["SUPER_ADMIN"]);

  const parsed = revokeGrantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grant = await prisma.unlockGrant.findUnique({
    where: { id: parsed.data.grantId },
    select: {
      id: true,
      schoolId: true,
      userId: true,
      scope: true,
      targetKey: true,
      revokedAt: true,
    },
  });
  if (!grant) return { ok: false, error: "Not found" };
  if (grant.revokedAt) return { ok: true };

  await prisma.unlockGrant.update({
    where: { id: grant.id },
    data: { revokedAt: new Date(), revokedById: admin.id },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: grant.schoolId,
    action: AUDIT_ACTIONS.UNLOCK_GRANT_REVOKE,
    resource: "UnlockGrant",
    resourceId: grant.id,
    metadata: { userId: grant.userId, scope: grant.scope, targetKey: grant.targetKey },
  });

  revalidateSupportTicket(grant.userId);
  revalidatePath(SUPPORT_ROUTE);

  return { ok: true };
}

/**
 * Grant access directly, without a ticket.
 *
 * Kept separate from `resolveTicket` rather than folded into it: this path has
 * no requester to check the scope against, so the caller states the user, the
 * scope and the target outright and the tenancy check is explicit.
 */
export async function grantUnlockDirect(input: {
  userId: string;
  scope: UnlockScope;
  targetKey: string;
  days: number;
}): Promise<ActionResult<{ id: string }>> {
  const admin = await requireUser(["SUPER_ADMIN"]);

  const target = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null, schoolId: { not: null } },
    select: { id: true, schoolId: true },
  });
  if (!target?.schoolId) return { ok: false, error: "Not found" };

  const days = Math.min(Math.max(Math.trunc(input.days), 1), 30);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const grant = await prisma.unlockGrant.upsert({
    where: {
      userId_scope_targetKey: {
        userId: target.id,
        scope: input.scope,
        targetKey: input.targetKey,
      },
    },
    create: {
      schoolId: target.schoolId,
      userId: target.id,
      scope: input.scope,
      targetKey: input.targetKey,
      grantedById: admin.id,
      expiresAt,
    },
    update: { grantedById: admin.id, expiresAt, revokedAt: null, revokedById: null },
    select: { id: true },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: target.schoolId,
    action: AUDIT_ACTIONS.UNLOCK_GRANT_ISSUE,
    resource: "UnlockGrant",
    resourceId: grant.id,
    metadata: {
      userId: target.id,
      scope: input.scope,
      targetKey: input.targetKey,
      expiresAt: expiresAt.toISOString(),
      direct: true,
    },
  });

  revalidateSupportTicket(target.id);
  revalidatePath(SUPPORT_ROUTE);

  return { ok: true, data: { id: grant.id } };
}

/**
 * Tell the requester their ticket was answered.
 *
 * Carries the ticket id and nothing else — the sentence the recipient reads is
 * composed at read time from the current ticket row, the same rule the ARAL
 * notification follows for learners.
 */
async function notifyRequester(
  schoolId: string,
  requesterId: string,
  actorId: string,
  ticketId: string
): Promise<void> {
  const data: Prisma.NotificationCreateInput = {
    school: { connect: { id: schoolId } },
    recipient: { connect: { id: requesterId } },
    actor: { connect: { id: actorId } },
    type: "SUPPORT_TICKET_RESOLVED",
    learnerIds: [],
    ticket: { connect: { id: ticketId } },
  };
  await prisma.notification.create({ data });
}

/**
 * The caller's own tickets, for the assistant's Recent list.
 *
 * A server action rather than a layout read on purpose. The teacher layout is
 * explicit that everything awaited there blocks the sidebar and header for
 * *every* `/teacher` route; this list is worth one round trip when somebody
 * opens the panel, and nothing at all when they never do.
 *
 * `requireUser` with no role argument, because the assistant mounts for all
 * three roles. A Super Admin has no tickets of their own to return — filing one
 * takes `requireSchoolUser`, and an admin holds no school to file against — so
 * the empty list is the correct answer rather than a refusal to render.
 *
 * Scoped to `user.id` inside `listMyTickets`, which is the whole tenancy
 * story here: a ticket belongs to the person who wrote it, and nobody but a
 * Super Admin reading the inbox ever sees somebody else's.
 */
export async function fetchMyTickets(): Promise<ActionResult<MySupportTicket[]>> {
  const user = await requireUser();

  const tickets = await listMyTickets(user.id, 6);

  return {
    ok: true,
    data: tickets.map((ticket) => ({
      id: ticket.id,
      category: ticket.category,
      status: ticket.status,
      subject: ticket.subject,
      createdAt: ticket.createdAt,
      resolutionNote: ticket.resolutionNote,
      requestedScope: ticket.requestedScope,
      requestedTargetKey: ticket.requestedTargetKey,
      grantExpiresAt: ticket.activeGrant?.expiresAt ?? null,
    })),
  };
}
