"use client";

import { useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import type { SupportTicketCategory, UnlockScope } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitTicket } from "@/lib/actions/support";
import {
  SUPPORT_TICKET_CATEGORIES,
  UNLOCK_SCOPES,
  submitTicketSchema,
} from "@/lib/validators/support.schema";
import {
  SUPPORT_TICKET_CATEGORY_LABELS,
  TERM_PERIOD_LABELS,
  UNLOCK_SCOPE_LABELS,
} from "@/lib/constants/enum-labels";
import { TERM_PERIODS, type TermPeriodValue } from "@/lib/terms/windows";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { formatWeekRange } from "@/lib/week-range";
import { getMonday } from "@/lib/utils";

/**
 * The hand-off: everything the assistant cannot answer by itself.
 *
 * Validated with `submitTicketSchema`, the same schema `submitTicket` re-parses
 * on the server. The client half is a courtesy so somebody sees the rule before
 * they wait for a round trip; the server is the gate.
 *
 * The week field snaps whatever date is picked to that week's Monday, because
 * `UnlockGrant.targetKey` for attendance IS the Monday key the grid navigates
 * by. A grant issued against a Wednesday would name a window no save ever asks
 * about, and the teacher would be told they had access that did nothing.
 */

type Props = {
  /** Category the form opens on. The Request Access tile hands over UNLOCK_REQUEST. */
  initialCategory?: SupportTicketCategory;
  /** Pathname the assistant was opened from, already matched against the schema. */
  pageUrl?: string;
  onBack: () => void;
  onSubmitted: (subject: string) => void;
};

export function AssistantTicketForm({
  initialCategory = "UNLOCK_REQUEST",
  pageUrl,
  onBack,
  onSubmitted,
}: Props) {
  const [category, setCategory] = useState<SupportTicketCategory>(initialCategory);
  const [scope, setScope] = useState<UnlockScope>("ARAL_WEEKLY_ATTENDANCE");
  // Starts empty rather than on this week: the only weeks worth requesting are
  // already closed, so prefilling an open one would be a default nobody wants.
  const [weekKey, setWeekKey] = useState("");
  const [term, setTerm] = useState<TermPeriodValue>("FIRST");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isUnlock = category === "UNLOCK_REQUEST";

  function pickWeek(value: string) {
    if (!value) {
      setWeekKey("");
      return;
    }
    setWeekKey(formatLocalDateKey(getMonday(parseLocalDateKey(value))));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = submitTicketSchema.safeParse({
      category,
      subject,
      body,
      pageUrl,
      // Only an access request may name a period — the schema refuses a stray
      // scope outright rather than dropping it, so the shape has to follow the
      // category the person actually picked.
      ...(isUnlock
        ? {
            requestedScope: scope,
            requestedTargetKey: scope === "TERM_GRADES" ? term : weekKey,
          }
        : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Check the form and try again");
      return;
    }

    setPending(true);
    const result = await submitTicket(parsed.data);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSubmitted(parsed.data.subject);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="sr-only">Back to the assistant</span>
        </Button>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Ask the division admin</p>
          <p className="text-xs text-muted-foreground">
            They can reopen a closed period, or help with anything else.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assistant-category" className="text-xs">
          What do you need?
        </Label>
        <Select
          value={category}
          onValueChange={(value) => setCategory(value as SupportTicketCategory)}
        >
          <SelectTrigger id="assistant-category" className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_TICKET_CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>
                {SUPPORT_TICKET_CATEGORY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isUnlock && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="assistant-scope" className="text-xs">
              Which sheet is locked?
            </Label>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as UnlockScope)}
            >
              <SelectTrigger id="assistant-scope" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNLOCK_SCOPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {UNLOCK_SCOPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {scope === "ARAL_WEEKLY_ATTENDANCE" ? (
            <div className="space-y-1.5">
              <Label htmlFor="assistant-week" className="text-xs">
                Which week?
              </Label>
              <Input
                id="assistant-week"
                type="date"
                value={weekKey}
                onChange={(event) => pickWeek(event.target.value)}
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                {weekKey
                  ? `Week of ${formatWeekRange(weekKey)}.`
                  : "Pick any day in the week you need reopened."}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="assistant-term" className="text-xs">
                Which term?
              </Label>
              <Select
                value={term}
                onValueChange={(value) => setTerm(value as TermPeriodValue)}
              >
                <SelectTrigger id="assistant-term" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERM_PERIODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {TERM_PERIOD_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="assistant-subject" className="text-xs">
          Subject
        </Label>
        <Input
          id="assistant-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={120}
          placeholder="In a few words"
          className="h-9 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assistant-body" className="text-xs">
          Details
        </Label>
        <Textarea
          id="assistant-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="What happened, and what you need to do."
          className="min-h-[84px] text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full bg-violet text-violet-foreground hover:bg-violet/90"
        loading={pending}
        loadingText="Sending"
      >
        <Send className="size-4" aria-hidden />
        Send request
      </Button>
    </form>
  );
}
