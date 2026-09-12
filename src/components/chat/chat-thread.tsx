"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listMentionTargets,
  markChannelRead,
  openChannel,
  readChannel,
  sendChatMessage,
  type ChatChannelView,
  type ChatMessageView,
} from "@/lib/actions/chat";
import { segmentMessage } from "@/lib/chat/mentions";
import { cn } from "@/lib/utils";
import type { ChatChannelKind } from "@prisma/client";

/**
 * One conversation: the staff room, or a private line to the admin team.
 *
 * Polled, not streamed. A pilot of a few schools does not justify a realtime
 * subscription, its connection limits, or a second authorization surface in
 * Postgres policies — and polling degrades into "the message arrives a few
 * seconds later", which is the failure mode a staff room can absorb. The
 * interval only runs while the tab is actually visible, so a panel left open in
 * a background tab costs nothing.
 */

/** How often an open, visible thread asks for new messages. */
const POLL_MS = 6000;

type Props = {
  kind: ChatChannelKind;
  /** Admin only: whose school, and whose private thread. */
  schoolId?: string;
  memberId?: string;
  /** Shown when the thread is empty, to say what this room is for. */
  emptyHint: string;
  messageQuery?: string;
};

type MentionTarget = {
  id: string;
  username: string;
  displayName: string;
  roleLabel: string;
};

function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Same calendar day, so the transcript only dates a message when it needs to. */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayLabel(date: Date): string {
  const today = new Date();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
  }).format(date);
}

export function ChatThread({ kind, schoolId, memberId, emptyHint, messageQuery = "" }: Props) {
  const [channel, setChannel] = useState<ChatChannelView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [targets, setTargets] = useState<MentionTarget[]>([]);
  const [pickerQuery, setPickerQuery] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const channelIdRef = useRef<string | null>(null);
  /**
   * Newest message id already rendered, so a poll can tell "changed" cheaply.
   * `undefined` means nothing has been rendered yet — distinct from `null`,
   * which is an empty room. Conflating the two leaves a conversation with no
   * messages stuck on "Opening the conversation…" forever, because its newest
   * id matches the initial value and the first read never reaches state.
   */
  const latestRef = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async (channelId: string, markRead: boolean) => {
    const result = await readChannel({ channelId });
    if (!result.ok || !result.data) return;

    const newest = result.data.messages.at(-1)?.id ?? null;
    if (latestRef.current !== undefined && newest === latestRef.current) return;
    latestRef.current = newest;
    setChannel(result.data);

    if (markRead) void markChannelRead({ channelId });
  }, []);

  // Open the channel once, then keep it. `openChannel` creates on first use, so
  // a school with no staff room yet gets one the moment somebody looks.
  useEffect(() => {
    let cancelled = false;
    void openChannel({ kind, schoolId, memberId }).then(async (result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setError(result.ok ? "Could not open this conversation" : result.error);
        return;
      }
      channelIdRef.current = result.data.id;
      await refresh(result.data.id, true);
      const people = await listMentionTargets({ channelId: result.data.id });
      if (!cancelled && people.ok && people.data) setTargets(people.data);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, schoolId, memberId, refresh]);

  // Poll only while the tab is visible. A backgrounded phone should not be
  // making a request every six seconds on a teacher's mobile data.
  useEffect(() => {
    function tick() {
      if (document.visibilityState !== "visible") return;
      const id = channelIdRef.current;
      if (id) void refresh(id, true);
    }
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [channel]);

  function handleDraftChange(value: string) {
    setDraft(value);
    // The @ picker opens on the token being typed at the caret.
    const match = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(value);
    setPickerQuery(match ? match[1].toLowerCase() : null);
  }

  function applyMention(target: MentionTarget) {
    setDraft((current) => current.replace(/@([a-z0-9._-]*)$/i, `@${target.username} `));
    setPickerQuery(null);
    inputRef.current?.focus();
  }

  async function submit() {
    const body = draft.trim();
    const channelId = channelIdRef.current;
    if (!body || !channelId || sending) return;

    setSending(true);
    const result = await sendChatMessage({ channelId, body });
    setSending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft("");
    setPickerQuery(null);
    // Force the next read to render: the poll skips when the newest id is
    // unchanged, and our own message changes it.
    latestRef.current = undefined;
    await refresh(channelId, true);
  }

  const suggestions =
    pickerQuery === null
      ? []
      : targets
          .filter(
            (t) =>
              t.username.toLowerCase().startsWith(pickerQuery) ||
              t.displayName.toLowerCase().includes(pickerQuery)
          )
          .slice(0, 5);

  const visibleMessages = channel?.messages.filter((message) =>
    message.body.toLowerCase().includes(messageQuery.trim().toLowerCase())
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto p-4" role="log">
        {channel === null && !error && (
          <p className="text-[13px] text-muted-foreground">Opening the conversation…</p>
        )}

        {channel?.messages.length === 0 && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{emptyHint}</p>
        )}

        {channel && channel.messages.length > 0 && visibleMessages?.length === 0 && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">No messages match your search.</p>
        )}

        {visibleMessages?.map((message, index) => {
          const previous = visibleMessages[index - 1];
          const showDay =
            !previous || !sameDay(new Date(previous.createdAt), new Date(message.createdAt));
          // Messenger's rule: the name appears when the speaker changes, not on
          // every line, so a burst from one person reads as one turn.
          const showAuthor = !previous || previous.author.id !== message.author.id || showDay;

          return (
            <div key={message.id} className="space-y-1.5">
              {showDay && (
                <p className="pt-1 text-center text-[11px] font-medium text-muted-foreground">
                  {dayLabel(new Date(message.createdAt))}
                </p>
              )}
              <ChatBubble message={message} showAuthor={showAuthor} />
            </div>
          );
        })}
      </div>

      {error && (
        <p className="px-4 pb-2 text-[12px] text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="relative border-t border-border/60 p-3">
        {suggestions.length > 0 && (
          <ul className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-lg border bg-popover shadow-md">
            {suggestions.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  onClick={() => applyMention(target)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-accent"
                >
                  <span className="font-medium">{target.displayName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {target.roleLabel} · @{target.username}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            placeholder="Write a message. Use @ to mention someone."
            aria-label="Message"
            className="h-11 text-[13px] sm:h-9"
            disabled={!channel}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!draft.trim() || sending || !channel}
            className="size-11 shrink-0 sm:size-9"
          >
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      </div>
    </div>
  );
}

/** One message, with the sender named the way Messenger names them. */
function ChatBubble({
  message,
  showAuthor,
}: {
  message: ChatMessageView;
  showAuthor: boolean;
}) {
  const mine = message.author.isSelf;
  const segments = segmentMessage(message.body, message.mentions);

  return (
    <div className={cn("flex gap-2", mine && "flex-row-reverse")}>
      <span
        className={cn(
          "mt-auto flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
          showAuthor ? "bg-violet-soft text-violet-soft-foreground" : "invisible"
        )}
        aria-hidden
      >
        {message.author.initials}
      </span>

      <div className={cn("min-w-0 max-w-[78%] space-y-0.5", mine && "items-end text-right")}>
        {showAuthor && (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{message.author.displayName}</span>
            {" · "}
            {message.author.roleLabel}
          </p>
        )}
        <div
          className={cn(
            "inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-[13px] leading-relaxed",
            mine
              ? "rounded-br-sm bg-violet text-violet-foreground"
              : "rounded-bl-sm bg-muted text-foreground"
          )}
        >
          {segments.map((segment, index) =>
            segment.kind === "mention" ? (
              <span
                key={index}
                className={cn(
                  "rounded px-0.5 font-semibold",
                  // On the sender's own violet bubble the mention has to lift
                  // off the same hue, so it tints with the bubble's own
                  // foreground rather than introducing a second colour.
                  mine
                    ? "bg-violet-foreground/20"
                    : "bg-violet-soft text-violet-soft-foreground"
                )}
              >
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            )
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {timeLabel(new Date(message.createdAt))}
        </p>
      </div>
    </div>
  );
}
