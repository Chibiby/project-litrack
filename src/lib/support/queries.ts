import "server-only";
import type { SupportTicketCategory, SupportTicketStatus, UnlockScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Reads for support tickets.
 *
 * Uncached on purpose. Both readers are `force-dynamic` pages showing a queue
 * whose whole value is being current: an admin looking at the inbox needs to see
 * the ticket that arrived a second ago, and a teacher checking their request
 * needs today's answer, not a 60-second-old one. `cachedQuery` would buy a round
 * trip and cost exactly the freshness the feature exists for.
 */

export type TicketRow = {
  id: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  subject: string;
  body: string;
  pageUrl: string | null;
  requestedScope: UnlockScope | null;
  requestedTargetKey: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  requesterName: string;
  requesterRole: string;
  schoolName: string;
  resolverName: string | null;
  /** The live grant this ticket produced, when it produced one and it is still in force. */
  activeGrant: { id: string; expiresAt: Date } | null;
};

const TICKET_SELECT = {
  id: true,
  category: true,
  status: true,
  subject: true,
  body: true,
  pageUrl: true,
  requestedScope: true,
  requestedTargetKey: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true,
  requester: { select: { fullName: true, role: true } },
  school: { select: { name: true } },
  resolver: { select: { fullName: true } },
  grant: { select: { id: true, expiresAt: true, revokedAt: true } },
} as const;

type RawTicket = {
  id: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  subject: string;
  body: string;
  pageUrl: string | null;
  requestedScope: UnlockScope | null;
  requestedTargetKey: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  requester: { fullName: string; role: string } | null;
  school: { name: string } | null;
  resolver: { fullName: string } | null;
  grant: { id: string; expiresAt: Date; revokedAt: Date | null } | null;
};

function toRow(ticket: RawTicket): TicketRow {
  const grant = ticket.grant;
  const live =
    grant && !grant.revokedAt && grant.expiresAt > new Date()
      ? { id: grant.id, expiresAt: grant.expiresAt }
      : null;
  return {
    id: ticket.id,
    category: ticket.category,
    status: ticket.status,
    subject: ticket.subject,
    body: ticket.body,
    pageUrl: ticket.pageUrl,
    requestedScope: ticket.requestedScope,
    requestedTargetKey: ticket.requestedTargetKey,
    resolutionNote: ticket.resolutionNote,
    resolvedAt: ticket.resolvedAt,
    createdAt: ticket.createdAt,
    requesterName: ticket.requester?.fullName ?? "Removed account",
    requesterRole: ticket.requester?.role ?? "",
    schoolName: ticket.school?.name ?? "",
    resolverName: ticket.resolver?.fullName ?? null,
    activeGrant: live,
  };
}

/**
 * The division admin's queue: every school's tickets, unanswered first.
 *
 * Deliberately unfiltered by school — see the trust-boundary note in
 * `src/lib/actions/support.ts`. Callers must already have established the
 * Super Admin role; this function does not check it.
 */
export async function listInboxTickets(limit = 100): Promise<TicketRow[]> {
  const tickets = await prisma.supportTicket.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: TICKET_SELECT,
  });
  return tickets.map(toRow);
}

/** One person's own tickets, newest first. What the assistant's Recent list shows. */
export async function listMyTickets(userId: string, limit = 6): Promise<TicketRow[]> {
  const tickets = await prisma.supportTicket.findMany({
    where: { requesterId: userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: TICKET_SELECT,
  });
  return tickets.map(toRow);
}

/** Count of tickets nobody has answered yet — the inbox badge. */
export async function countOpenTickets(): Promise<number> {
  return prisma.supportTicket.count({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
  });
}
