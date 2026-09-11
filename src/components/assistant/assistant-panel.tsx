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
import { askAssistant, type AssistantLink } from "@/lib/actions/assistant";
import { ChatThread } from "@/components/chat/chat-thread";
import { getMyChatUnread } from "@/lib/actions/chat";
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
 * The assistant panel: one voice in front, a support ticket behind.
 *
 * Three rules shape everything here.
 *
 * The first is that there is exactly one answer per question, and it comes from
 * `askAssistant`. This panel used to render a curated answer from the offline
 * help index the instant Enter was pressed and then swap it for the model's
 * prose a second later, which meant a teacher watched an answer they had begun
 * reading get rewritten underneath them. The curated index is still the model's
 * reference material, on the server, but it no longer speaks here: a question
 * shows a thinking indicator and then becomes an answer. Never both.
 *
 * The second is that this component never guesses. When the model cannot answer
 * — not configured, over the rate limit, down, slow, or refusing — the action
 * returns a sentence saying so and the panel renders it with the route to a
 * person, rather than filling the silence with the closest help topic it could
 * find. A school app that confidently mis-answers a question about a locked
 * grade sheet is worse than one that says it does not know.
 *
 * The third is that nothing here is an authorization decision. The tiles are
 * filtered by role for tidiness; the ticket a teacher files is authorized by
 * `submitTicket`, and the access it might produce is authorized by
 * `resolveTicket`. Hiding a tile is a courtesy, never a gate.
 *
 * Mounted only after the first open (see `AssistantWidget`), so `Date.now()`
 * here never runs during SSR and the relative timestamps cannot hydrate stale.
 */

/** Matches `pageUrl` in `submitTicketSchema`: a bare pathname, no query string. */
const PAGE_PATH_RE = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/;

/** Shown when the action itself could not be reached. Never an exception text. */
const UNREACHABLE =
  "I could not reach the assistant just now. Try again in a moment, or send your question to the division admin.";

type Entry =
  | { id: string; kind: "user"; text: string }
  | {
      id: string;
      kind: "bot";
      /**
       * `asking` renders a thinking indicator and nothing else.
       *
       * This is the whole fix for the answer-then-rewrite flicker: a bubble
       * holds no words until it holds its final ones, so there is never a
       * sentence on screen that is about to be replaced by a different one.
       */
      state: "asking" | "answered" | "failed";
      text?: string;
      /** The app's own routes, resolved on the server. Empty while asking. */
      links: AssistantLink[];
    };

type Props = {
  role: UserRole;
  userName: string;
  /** Whether to disclose that questions reach Google. See RoleShell. */
  aiEnabled?: boolean;
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
  aiEnabled,
  active,
  onMinimize,
  onClose,
}: Props) {
  const pathname = usePathname();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"chat" | "ticket">("chat");
  /** Which room is on screen. The assistant is the default deliberately. */
  const [view, setView] = useState<"assistant" | "school" | "admin">("assistant");
  const [recent, setRecent] = useState<MySupportTicket[] | null>(null);
  const [unread, setUnread] = useState({ school: false, admin: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Super Admin answers tickets rather than filing them: `submitTicket` takes
  // `requireSchoolUser`, and an admin holds no school to file against. The
  // whole escalation path is hidden for them rather than offered and refused.
  const canEscalate = role !== "SUPER_ADMIN";
  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const pageUrl = pathname && PAGE_PATH_RE.test(pathname) ? pathname : undefined;

  // Typed to the bot shape rather than `Omit<Entry, "id">`: omitting a key from
  // a union collapses it to the keys the members share, which drops `links`.
  const say = useCallback((entry: Omit<Extract<Entry, { kind: "bot" }>, "id">) => {
    setEntries((current) => [...current, { ...entry, id: nextId() }]);
  }, []);

  /** Settle the bubble this question is waiting on, whatever the outcome. */
  const settle = useCallback((replyId: string, next: Partial<Extract<Entry, { kind: "bot" }>>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === replyId && entry.kind === "bot" ? { ...entry, ...next } : entry
      )
    );
  }, []);

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      // Every message goes to the model — a greeting included. The panel used
      // to answer small talk itself from a canned string and route everything
      // else through a second path, which is how one question came to have two
      // authors. Rule 4 of the system instruction covers the greeting now.
      const replyId = nextId();

      setEntries((current) => [
        ...current,
        { id: nextId(), kind: "user", text: trimmed },
        { id: replyId, kind: "bot", state: "asking", links: [] },
      ]);
      setDraft("");

      void askAssistant({ question: trimmed, pathname: pageUrl })
        .then((result) => {
          if (result.ok && result.data) {
            settle(replyId, {
              state: "answered",
              text: result.data.text,
              links: result.data.links,
            });
            return;
          }
          // `error` is fixed copy chosen by the action for this person to read
          // — it is never an exception message. See `askAssistant`.
          settle(replyId, {
            state: "failed",
            text: result.ok ? UNREACHABLE : result.error,
          });
        })
        // A server action can fail before it returns anything at all: a dropped
        // connection, a deploy mid-request. That is the same silence to a
        // reader as a spent quota, so it reads the same.
        .catch(() => settle(replyId, { state: "failed", text: UNREACHABLE }));
    },
    [pageUrl, settle]
  );

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

  // Which rooms have something waiting. Refreshed when the panel opens and when
  // the reader leaves a room, which is when the answer can have changed.
  useEffect(() => {
    if (!canEscalate) return;
    let cancelled = false;
    void getMyChatUnread()
      .then((result) => {
        if (!cancelled && result.ok && result.data) setUnread(result.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canEscalate, view]);

  useEffect(() => {
    if (active && mode === "chat" && view === "assistant") inputRef.current?.focus();
  }, [active, mode, view]);

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

      {/*
        Three rooms behind one button. The assistant is first and is what opens,
        because it is the one that answers immediately and at any hour; the other
        two need another person to be awake. A Super Admin holds no school of
        their own, so they get the assistant alone and read school chat from
        their own admin pages instead.
      */}
      {canEscalate && mode !== "ticket" && (
        <div
          role="tablist"
          aria-label="Assistant sections"
          className="flex gap-1 border-b px-2 py-1.5"
        >
          {(
            [
              { id: "assistant", label: "Assistant", unread: false },
              { id: "school", label: "School chat", unread: unread.school },
              { id: "admin", label: "Ask admin", unread: unread.admin },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={view === tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors",
                view === tab.id
                  ? "bg-violet-soft text-violet-soft-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.unread && view !== tab.id && (
                <span
                  className="size-1.5 rounded-full bg-violet"
                  aria-label="Unread messages"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {mode !== "ticket" && view === "school" ? (
        <ChatThread
          // Both tabs render a ChatThread in the same slot, so without a key
          // React reuses one instance across the switch: the staff room's
          // transcript would appear under "Ask admin", and a message sent
          // before the new channel resolved would land in the old room.
          key="school"
          kind="SCHOOL"
          emptyHint="This is your school's staff room. Everyone at your school can read it. Type @ to mention a colleague or a division admin."
        />
      ) : mode !== "ticket" && view === "admin" ? (
        <ChatThread
          key="admin"
          kind="ADMIN_DIRECT"
          emptyHint="A private line to the division admins. Only you and the admin team can read this thread — ask anything about the system here."
        />
      ) : mode === "ticket" ? (
        <div className="flex-1 overflow-y-auto p-4">
          <AssistantTicketForm
            pageUrl={pageUrl}
            onBack={() => setMode("chat")}
            onSubmitted={(subject) => {
              setMode("chat");
              say({
                kind: "bot",
                state: "answered",
                text: `Sent. The division admin has your request about "${subject}" and their answer will show up here.`,
                links: [],
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

                {/* Said plainly, before anyone types. Answers are generated
                    outside the country from data about real children, and a
                    teacher is entitled to know that without hunting for it. */}
                {aiEnabled ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Answers are generated by Google Gemini. Your question and a
                    summary of your own class — counts, this week&rsquo;s
                    attendance, and learners still needing a profile — are sent
                    to Google to produce them. No other teacher&rsquo;s learners
                    and no other school are ever included.
                  </p>
                ) : (
                  /* Gemini is the only thing that answers here now, so with no
                     key there is nothing to ask. Better said here, once, than
                     discovered one question at a time. */
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    The assistant is not switched on for this deployment yet, so
                    it cannot answer questions here.
                    {canEscalate
                      ? " Send anything you need to the division admin below."
                      : ""}
                  </p>
                )}

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
 * One answer, in exactly one of three states.
 *
 * `asking` is a bubble with no words in it. That is deliberate and it is the
 * point: a bubble that shows prose while a different answer is on its way is a
 * bubble a reader watches get rewritten, which is what this panel used to do.
 *
 * `failed` is the honest "I cannot answer this", carrying the sentence the
 * action chose. The escalation button appears there and only there, so the
 * offer to bother a person tracks the moment the assistant actually failed.
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
  if (entry.state === "asking") {
    return (
      <div
        className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-3"
        role="status"
      >
        <span className="sr-only">Thinking…</span>
        {/* A staggered fade, not a hop. `animate-bounce` translates 25% on a
            bounce curve, which on a 6px dot is a jump; the pulse keeps the
            familiar typing rhythm without the dated easing. */}
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${dot * 160}ms` }}
            aria-hidden
          />
        ))}
      </div>
    );
  }

  if (entry.state === "failed") {
    return (
      <div className="max-w-[85%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5">
        <p className="text-[13px] leading-relaxed">{entry.text}</p>
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
      <div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed">
        {entry.text}
      </div>
      {/* The prose came from the model; these are the app's own routes, picked
          on the server, which a paragraph cannot carry and a model must not
          invent. */}
      {entry.links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          {link.label}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
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
