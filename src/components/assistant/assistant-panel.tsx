"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Bot,
  ChevronRight,
  LifeBuoy,
  Minus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssistantTicketForm } from "@/components/assistant/assistant-ticket-form";
import { answerQuery, findTopic, type HelpMatch } from "@/lib/help/search";
import { getQuickActions, type QuickAction } from "@/lib/help/quick-actions";
import { fetchMyTickets, type MySupportTicket } from "@/lib/actions/support";
import {
  SUPPORT_TICKET_STATUS_LABELS,
  TERM_PERIOD_LABELS,
  UNLOCK_SCOPE_LABELS,
} from "@/lib/constants/enum-labels";
import { TERM_PERIODS, type TermPeriodValue } from "@/lib/terms/windows";
import { formatWeekRange } from "@/lib/week-range";
import { cn } from "@/lib/utils";

/**
 * The assistant panel: a curated help index in front, a support ticket behind.
 *
 * Two rules shape everything here.
 *
 * The first is that this component never guesses. `answerQuery` returns an
 * empty array when nothing clears its threshold, and an empty array is rendered
 * as "I do not know, here is how to reach a person" — not as the closest topic
 * it could find. A school app that confidently mis-answers a question about a
 * locked grade sheet is worse than one that says nothing.
 *
 * The second is that nothing here is an authorization decision. The tiles are
 * filtered by role for tidiness; the ticket a teacher files is authorized by
 * `submitTicket`, and the access it might produce is authorized by
 * `resolveTicket`. Hiding a tile is a courtesy, never a gate.
 *
 * Mounted only after the first open (see `AssistantWidget`), so `Date.now()`
 * here never runs during SSR and the relative timestamps cannot hydrate stale.
 */

/** Matches `pageUrl` in `submitTicketSchema`: a bare pathname, no query string. */
const PAGE_PATH_RE = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/;

type Entry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "bot"; text?: string; matches: HelpMatch[] };

type Props = {
  role: UserRole;
  userName: string;
  /** True while the panel is on screen: drives focus, not mounting. */
  active: boolean;
  onMinimize: () => void;
  onClose: () => void;
};

let entrySeq = 0;
function nextId(): string {
  entrySeq += 1;
  return `e${entrySeq}`;
}

/** Short relative age, e.g. "2h" or "3d". Client-only — see the module note. */
function shortAge(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function isTermKey(value: string): value is TermPeriodValue {
  return (TERM_PERIODS as readonly string[]).includes(value);
}

/** What a ticket asked to reopen, in the words the person chose it by. */
function targetLabel(ticket: MySupportTicket): string | null {
  if (!ticket.requestedScope || !ticket.requestedTargetKey) return null;
  if (ticket.requestedScope === "TERM_GRADES") {
    return isTermKey(ticket.requestedTargetKey)
      ? TERM_PERIOD_LABELS[ticket.requestedTargetKey]
      : UNLOCK_SCOPE_LABELS[ticket.requestedScope];
  }
  return `Week of ${formatWeekRange(ticket.requestedTargetKey)}`;
}

const STATUS_TINT: Record<MySupportTicket["status"], string> = {
  OPEN: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
  IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200",
  RESOLVED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200",
  DECLINED: "bg-muted text-muted-foreground",
};

export function AssistantPanel({
  role,
  userName,
  active,
  onMinimize,
  onClose,
}: Props) {
  const pathname = usePathname();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"chat" | "ticket">("chat");
  const [recent, setRecent] = useState<MySupportTicket[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Super Admin answers tickets rather than filing them: `submitTicket` takes
  // `requireSchoolUser`, and an admin holds no school to file against. The
  // whole escalation path is hidden for them rather than offered and refused.
  const canEscalate = role !== "SUPER_ADMIN";
  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const actions = getQuickActions(role);
  const pageUrl = pathname && PAGE_PATH_RE.test(pathname) ? pathname : undefined;

  // Typed to the bot shape rather than `Omit<Entry, "id">`: omitting a key from
  // a union collapses it to the keys the members share, which drops `matches`.
  const say = useCallback((entry: Omit<Extract<Entry, { kind: "bot" }>, "id">) => {
    setEntries((current) => [...current, { ...entry, id: nextId() }]);
  }, []);

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      const matches = answerQuery(trimmed, { role, pathname: pathname ?? undefined });
      setEntries((current) => [
        ...current,
        { id: nextId(), kind: "user", text: trimmed },
        { id: nextId(), kind: "bot", matches },
      ]);
      setDraft("");
    },
    [pathname, role]
  );

  function openTopic(action: QuickAction) {
    if (action.kind === "ticket") {
      setMode("ticket");
      return;
    }
    const topic = action.topicId
      ? findTopic(action.topicId, { role, pathname: pathname ?? undefined })
      : null;
    setEntries((current) => [
      ...current,
      { id: nextId(), kind: "user", text: action.label },
      {
        id: nextId(),
        kind: "bot",
        matches: topic ? [{ topic, score: 99 }] : [],
      },
    ]);
  }

  // Loaded once, when the panel first mounts — which is the first time somebody
  // opens it, never on a page load nobody asked a question on.
  useEffect(() => {
    let cancelled = false;
    // A failed load means "no recent requests", never a crash — the help half of
    // this panel is static and must keep working when the query does not.
    void fetchMyTickets()
      .then((result) => {
        if (cancelled) return;
        setRecent(result.ok ? result.data ?? [] : []);
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (active && mode === "chat") inputRef.current?.focus();
  }, [active, mode]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [entries]);

  const isHome = entries.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="LITRACK Assistant"
      className="flex h-[560px] max-h-[calc(100dvh-6rem)] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
    >
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet text-violet-foreground"
          aria-hidden
        >
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">LITRACK Assistant</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            Online
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onMinimize}
        >
          <Minus className="size-4" aria-hidden />
          <span className="sr-only">Minimize the assistant</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close the assistant</span>
        </Button>
      </header>

      {mode === "ticket" ? (
        <div className="flex-1 overflow-y-auto p-4">
          <AssistantTicketForm
            pageUrl={pageUrl}
            onBack={() => setMode("chat")}
            onSubmitted={(subject) => {
              setMode("chat");
              say({
                kind: "bot",
                text: `Sent. The division admin has your request about "${subject}" and their answer will show up here.`,
                matches: [],
              });
              void fetchMyTickets()
                .then((result) => {
                  setRecent(result.ok ? result.data ?? [] : []);
                })
                .catch(() => {});
            }}
          />
        </div>
      ) : (
        <>
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            className="flex-1 space-y-4 overflow-y-auto p-4"
          >
            {isHome ? (
              <>
                <div className="rounded-xl bg-violet-soft p-3.5 text-violet-soft-foreground">
                  <p className="text-sm font-semibold">Hi {firstName}!</p>
                  <p className="mt-1 text-[13px] leading-relaxed">
                    Ask me how anything in LITRACK works. What I cannot answer, I
                    can pass to the division admin.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Quick actions
                  </p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {actions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => openTopic(action)}
                        className="flex flex-col items-center gap-1.5 rounded-xl border bg-background p-2.5 text-center transition-colors hover:bg-accent"
                      >
                        <span
                          className={cn(
                            "flex size-9 items-center justify-center rounded-lg",
                            action.tint
                          )}
                          aria-hidden
                        >
                          <action.icon className="size-4" />
                        </span>
                        <span className="text-[11px] font-medium leading-tight">
                          {action.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {canEscalate && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Recent Requests
                    </p>
                    <RecentRequests tickets={recent} />
                  </div>
                )}
              </>
            ) : (
              entries.map((entry) =>
                entry.kind === "user" ? (
                  <div key={entry.id} className="flex justify-end">
                    <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-violet px-3.5 py-2 text-[13px] leading-relaxed text-violet-foreground">
                      {entry.text}
                    </p>
                  </div>
                ) : (
                  <BotEntry
                    key={entry.id}
                    entry={entry}
                    canEscalate={canEscalate}
                    onEscalate={() => setMode("ticket")}
                  />
                )
              )
            )}
          </div>

          {canEscalate && !isHome && (
            <button
              type="button"
              onClick={() => setMode("ticket")}
              className="flex items-center gap-2 border-t px-4 py-2.5 text-left text-[12px] font-medium text-violet transition-colors hover:bg-accent"
            >
              <LifeBuoy className="size-4 shrink-0" aria-hidden />
              Ask the division admin
              <ArrowRight className="ml-auto size-3.5 shrink-0" aria-hidden />
            </button>
          )}

          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              ask(draft);
            }}
          >
            <Input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about LITRACK"
              aria-label="Ask about LITRACK"
              className="h-10 rounded-full text-sm"
            />
            <Button
              type="submit"
              size="icon"
              disabled={draft.trim().length === 0}
              className="size-10 shrink-0 rounded-full bg-violet text-violet-foreground hover:bg-violet/90"
            >
              <Send className="size-4" aria-hidden />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

/**
 * One answer.
 *
 * `matches.length === 0` is the honest "I do not know" — see the module note.
 * The escalation button appears there and only there, so the offer to bother a
 * person tracks the moment the index actually failed.
 */
function BotEntry({
  entry,
  canEscalate,
  onEscalate,
}: {
  entry: Extract<Entry, { kind: "bot" }>;
  canEscalate: boolean;
  onEscalate: () => void;
}) {
  if (entry.text) {
    return (
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed">
        {entry.text}
      </div>
    );
  }

  if (entry.matches.length === 0) {
    return (
      <div className="max-w-[85%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5">
        <p className="text-[13px] leading-relaxed">
          I could not find that in my help index, so I would rather not guess.
        </p>
        {canEscalate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full text-xs"
            onClick={onEscalate}
          >
            <LifeBuoy className="size-3.5" aria-hidden />
            Send it to the division admin
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entry.matches.map(({ topic }) => (
        <div
          key={topic.id}
          className="max-w-[85%] space-y-1.5 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5"
        >
          <p className="text-[13px] font-semibold">{topic.title}</p>
          {topic.body.map((paragraph, index) => (
            <p key={index} className="text-[13px] leading-relaxed">
              {paragraph}
            </p>
          ))}
          {topic.action && (
            <Link
              href={topic.action.href}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-violet hover:underline"
            >
              {topic.action.label}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The requester's own tickets.
 *
 * The mockup calls this "Recent Chats". It shows support tickets instead,
 * because that is the only history this system actually keeps — transcripts are
 * never stored, and inventing a chat list would mean showing rows that do not
 * exist anywhere.
 */
function RecentRequests({ tickets }: { tickets: MySupportTicket[] | null }) {
  if (tickets === null) {
    return (
      <div className="space-y-2">
        {[0, 1].map((row) => (
          <div key={row} className="h-12 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-3 text-[12px] text-muted-foreground">
        Nothing sent yet. Anything I cannot answer can go to the division admin
        from here.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {tickets.map((ticket) => {
        const target = targetLabel(ticket);
        return (
          <li key={ticket.id}>
            <div className="flex items-center gap-2.5 rounded-xl border p-2.5">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold",
                  STATUS_TINT[ticket.status]
                )}
                aria-hidden
              >
                <Sparkles className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{ticket.subject}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
                  {target ? ` · ${target}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {shortAge(ticket.createdAt)}
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
