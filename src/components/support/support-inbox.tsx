"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, KeyRound, ShieldOff, X } from "lucide-react";
import { toast } from "sonner";
import type { TicketRow } from "@/lib/support/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  declineTicket,
  resolveTicket,
  revokeUnlockGrant,
} from "@/lib/actions/support";
import {
  DEFAULT_UNLOCK_DAYS,
  MAX_UNLOCK_DAYS,
} from "@/lib/validators/support.schema";
import {
  SUPPORT_TICKET_CATEGORY_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
  TERM_PERIOD_LABELS,
  UNLOCK_SCOPE_LABELS,
  USER_ROLE_LABELS,
} from "@/lib/constants/enum-labels";
import { TERM_PERIODS, type TermPeriodValue } from "@/lib/terms/windows";
import { formatWeekRange } from "@/lib/week-range";
import { LifeBuoy } from "lucide-react";

/**
 * The division admin's queue.
 *
 * Every ticket in every school, which is the point — a Super Admin is a
 * division-wide role, so `listInboxTickets` deliberately carries no `schoolId`
 * filter and the school name is a column rather than an assumption.
 *
 * The body is shown here in full, and it is the one place in the app where that
 * happens: it is free text somebody wrote about a problem in their class, so it
 * will name learners. Nothing on this screen copies it anywhere — not into the
 * resolution note, not into a toast, not into a URL.
 *
 * Answering is two decisions, not one. "Resolve" closes the ticket; the grant
 * checkbox is what actually reopens a window, and it is offered only on an
 * unlock request that named a period. `resolveTicket` re-checks that server-side
 * and refuses a grant on a ticket that cannot carry one, so this is presentation
 * of the rule rather than the rule.
 */

type Mode = "resolve" | "decline";

function isTermKey(value: string): value is TermPeriodValue {
  return (TERM_PERIODS as readonly string[]).includes(value);
}

/** The window a ticket asked about, in the words its requester picked it by. */
function targetLabel(ticket: TicketRow): string | null {
  if (!ticket.requestedScope || !ticket.requestedTargetKey) return null;
  if (ticket.requestedScope === "TERM_GRADES") {
    return isTermKey(ticket.requestedTargetKey)
      ? TERM_PERIOD_LABELS[ticket.requestedTargetKey]
      : ticket.requestedTargetKey;
  }
  return `Week of ${formatWeekRange(ticket.requestedTargetKey)}`;
}

const STATUS_VARIANT: Record<
  TicketRow["status"],
  "default" | "secondary" | "outline" | "violet"
> = {
  OPEN: "default",
  IN_PROGRESS: "secondary",
  RESOLVED: "outline",
  DECLINED: "outline",
};

export function SupportInbox({ tickets }: { tickets: TicketRow[] }) {
  const router = useRouter();
  const [active, setActive] = useState<{ ticket: TicketRow; mode: Mode } | null>(
    null
  );

  if (tickets.length === 0) {
    return (
      <EmptyState
        title="No requests yet"
        description="Teachers and school heads can send access requests and questions from the assistant on any page."
        icon={LifeBuoy}
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            onAnswer={(mode) => setActive({ ticket, mode })}
            onChanged={() => router.refresh()}
          />
        ))}
      </div>

      {active && (
        <AnswerDialog
          ticket={active.ticket}
          mode={active.mode}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function TicketCard({
  ticket,
  onAnswer,
  onChanged,
}: {
  ticket: TicketRow;
  onAnswer: (mode: Mode) => void;
  onChanged: () => void;
}) {
  const [revoking, startRevoke] = useTransition();
  const answered = ticket.status === "RESOLVED" || ticket.status === "DECLINED";
  const target = targetLabel(ticket);

  function revoke(grantId: string) {
    startRevoke(async () => {
      const result = await revokeUnlockGrant({ grantId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Access ended");
      onChanged();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">{ticket.subject}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {ticket.requesterName}
              {ticket.requesterRole in USER_ROLE_LABELS
                ? ` · ${USER_ROLE_LABELS[ticket.requesterRole as keyof typeof USER_ROLE_LABELS]}`
                : ""}
              {ticket.schoolName ? ` · ${ticket.schoolName}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              {SUPPORT_TICKET_CATEGORY_LABELS[ticket.category]}
            </Badge>
            <Badge variant={STATUS_VARIANT[ticket.status]}>
              {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
            </Badge>
          </div>
        </div>

        {target && (
          <p className="flex items-center gap-1.5 text-sm">
            <KeyRound className="size-4 shrink-0 text-violet" aria-hidden />
            <span className="text-muted-foreground">
              Asked to reopen {UNLOCK_SCOPE_LABELS[ticket.requestedScope!].toLowerCase()}
              {" — "}
            </span>
            <span className="font-medium">{target}</span>
          </p>
        )}

        {/* The requester's own words. Displayed as text, never re-published. */}
        <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm leading-relaxed">
          {ticket.body}
        </p>

        {ticket.pageUrl && (
          <p className="text-xs text-muted-foreground">
            Sent from <code className="font-mono">{ticket.pageUrl}</code>
          </p>
        )}

        {ticket.resolutionNote && (
          <div className="rounded-lg bg-violet-soft p-3 text-violet-soft-foreground">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-soft-foreground/70">
              Your reply
              {ticket.resolverName ? ` · ${ticket.resolverName}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.resolutionNote}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {ticket.activeGrant ? (
            <>
              <Badge variant="violet" className="gap-1">
                <Clock className="size-3" aria-hidden />
                Access until {ticket.activeGrant.expiresAt.toLocaleDateString()}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={revoking}
                loadingText="Ending"
                onClick={() => revoke(ticket.activeGrant!.id)}
              >
                <ShieldOff className="size-4" aria-hidden />
                End access now
              </Button>
            </>
          ) : null}

          {!answered && (
            <>
              <Button
                type="button"
                size="sm"
                className="bg-violet text-violet-foreground hover:bg-violet/90"
                onClick={() => onAnswer("resolve")}
              >
                <Check className="size-4" aria-hidden />
                Answer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onAnswer("decline")}
              >
                <X className="size-4" aria-hidden />
                Decline
              </Button>
            </>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {ticket.createdAt.toLocaleString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AnswerDialog({
  ticket,
  mode,
  onClose,
  onDone,
}: {
  ticket: TicketRow;
  mode: Mode;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [grantAccess, setGrantAccess] = useState(mode === "resolve");
  const [days, setDays] = useState(String(DEFAULT_UNLOCK_DAYS));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Only a request that named a period can carry a grant. `resolveTicket`
  // enforces the same rule and refuses otherwise, so hiding the control here
  // just stops an admin from asking for something that will be rejected.
  const canGrant =
    ticket.category === "UNLOCK_REQUEST" &&
    Boolean(ticket.requestedScope && ticket.requestedTargetKey);
  const target = targetLabel(ticket);

  async function submit() {
    setError(null);
    setPending(true);
    const result =
      mode === "decline"
        ? await declineTicket({ ticketId: ticket.id, note })
        : await resolveTicket({
            ticketId: ticket.id,
            note: note.trim() ? note : undefined,
            ...(canGrant && grantAccess
              ? { grant: { days: Number(days) } }
              : {}),
          });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(
      mode === "decline"
        ? "Request declined"
        : canGrant && grantAccess
          ? "Answered and access granted"
          : "Request answered"
    );
    onDone();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "decline" ? "Decline this request" : "Answer this request"}
          </DialogTitle>
          <DialogDescription>
            {ticket.requesterName}
            {ticket.schoolName ? ` · ${ticket.schoolName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {canGrant && mode === "resolve" && (
            <div className="space-y-3 rounded-lg border border-violet/40 bg-violet-soft/40 p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={grantAccess}
                  onChange={(event) => setGrantAccess(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-violet"
                />
                <span>
                  <span className="font-medium">Reopen {target}</span>
                  <span className="block text-xs text-muted-foreground">
                    {UNLOCK_SCOPE_LABELS[ticket.requestedScope!]} — only for this
                    person, only this period.
                  </span>
                </span>
              </label>

              {grantAccess && (
                <div className="space-y-1.5">
                  <Label htmlFor="grant-days" className="text-xs">
                    Days of access
                  </Label>
                  <Input
                    id="grant-days"
                    type="number"
                    min={1}
                    max={MAX_UNLOCK_DAYS}
                    value={days}
                    onChange={(event) => setDays(event.target.value)}
                    className="h-9 w-24 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Access ends by itself after this. Up to {MAX_UNLOCK_DAYS} days.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="answer-note" className="text-sm">
              {mode === "decline" ? "Why not?" : "Reply"}
              {mode === "resolve" && (
                <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
              )}
            </Label>
            <Textarea
              id="answer-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              rows={4}
              placeholder={
                mode === "decline"
                  ? "Say what they should do instead."
                  : "What you did, and anything they need to know."
              }
              className="text-sm"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            loading={pending}
            loadingText="Sending"
            className={
              mode === "decline"
                ? undefined
                : "bg-violet text-violet-foreground hover:bg-violet/90"
            }
          >
            {mode === "decline" ? "Decline" : "Send answer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
