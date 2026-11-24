"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteChatMessage,
  editChatMessage,
  listMentionTargets,
  markChannelRead,
  openChannel,
  readChannel,
  sendChatMessage,
  toggleChatReaction,
  type ChatChannelView,
  type ChatMessageView,
} from "@/lib/actions/chat";
import { callAction } from "@/lib/ui/call-action";
import { canEditMessage, groupMessages, seenLabel, typingLabel, type ReactionEmoji } from "@/lib/chat/view";
import { getPresenceStatus } from "@/lib/presence/status";
import { cn } from "@/lib/utils";
import type { ChatChannelKind } from "@prisma/client";
import { MessageBubble, type BubblePosition } from "@/components/chat/message-bubble";
import { MessageGroup } from "@/components/chat/message-group";
import { ChatComposer, type ChatComposerHandle, type ComposerMode, type MentionTarget } from "@/components/chat/chat-composer";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { useChatLive } from "@/components/chat/use-chat-live";

/**
 * One conversation: the staff room, or a private line to the admin team.
 *
 * Live when it can be, polled always. A WebSocket to the channel's room
 * (`useChatLive`) delivers messages, edits, reactions, reads, typing and
 * presence at once; polling keeps running underneath — every 6–30 s without
 * the socket, every 60 s with it — so a missing room or a dropped connection
 * only means a change arrives a few seconds later. Polling only runs while the
 * tab is visible, so a panel left open in a background tab costs nothing.
 */

/**
 * How long to wait before the next poll, by how long the thread has been quiet.
 * A live conversation polls every 6 s; a room nobody has written in for a
 * minute slows to 15 s, and after five minutes to 30 s. Any new message, or
 * coming back to the tab, puts it back on 6 s.
 */
export function chatPollDelayMs(quietForMs: number): number {
  if (quietForMs < 60_000) return 6_000;
  if (quietForMs < 5 * 60_000) return 15_000;
  return 30_000;
}

/** Safety-net poll while the live socket is connected. */
const LIVE_POLL_MS = 60_000;

/** Consecutive failed polls before the thread says it is stale. */
const POLL_FAILURES_BEFORE_NOTICE = 3;

/** A read marker is written at most this often per channel. */
const MARK_READ_MIN_GAP_MS = 5_000;

/** Within this many pixels of the bottom counts as "at the latest message". */
const AT_BOTTOM_PX = 48;

type Props = {
  kind: ChatChannelKind;
  /** Existing channels can skip the create/open round trip. */
  channelId?: string;
  initialChannel?: ChatChannelView | null;
  /** Admin only: whose school, and whose private thread. */
  schoolId?: string;
  memberId?: string;
  /** Shown when the thread is empty, to say what this room is for. */
  emptyHint: string;
  messageQuery?: string;
};

type Pending = { tempId: string; body: string; replyTo: ChatMessageView["replyTo"] };

/** Same calendar day, so the transcript only dates a message when it needs to. */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(date: Date): string {
  const today = new Date();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(date);
}

/** Cheap "did anything visible change" fingerprint, so a poll only re-renders on change. */
function fingerprint(view: ChatChannelView): string {
  const messages = (view.messages ?? [])
    .map(
      (m) =>
        `${m.id}:${m.deleted ? 1 : 0}:${m.editedAt ? new Date(m.editedAt).getTime() : 0}:${m.body.length}:${(m.reactions ?? [])
          .map((r) => `${r.emoji}${r.userIds.join(",")}`)
          .join(";")}`
    )
    .join("|");
  const readers = (view.readers ?? []).map((r) => `${r.userId}@${new Date(r.readAt).getTime()}`).join(",");
  return `${messages}#${readers}`;
}

function positionIn(index: number, count: number): BubblePosition {
  if (count === 1) return "single";
  if (index === 0) return "first";
  if (index === count - 1) return "last";
  return "middle";
}

export function ChatThread({ kind, channelId, initialChannel, schoolId, memberId, emptyHint, messageQuery = "" }: Props) {
  const [channel, setChannel] = useState<ChatChannelView | null>(initialChannel ?? null);
  const [openedId, setOpenedId] = useState<string | null>(channelId ?? initialChannel?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<ComposerMode>({ kind: "new" });
  const [pending, setPending] = useState<Pending[]>([]);
  const [targets, setTargets] = useState<MentionTarget[]>([]);
  const [pickerQuery, setPickerQuery] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState(false);
  const [pollStalled, setPollStalled] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const pollFailuresRef = useRef(0);
  /** When the thread last showed a new message, for the poll back-off. */
  const lastChangeAtRef = useRef(0);
  const refreshNoticeRef = useRef(false);
  const atBottomRef = useRef(true);
  const lastMarkAtRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const channelIdRef = useRef<string | null>(channelId ?? initialChannel?.id ?? null);
  /**
   * Fingerprint of what is rendered, so a poll can tell "changed" cheaply.
   * `undefined` means nothing has been rendered yet — distinct from an empty
   * room, which would otherwise leave the thread stuck on its loading state.
   */
  const shownRef = useRef<string | undefined>(initialChannel ? fingerprint(initialChannel) : undefined);
  const newestIdRef = useRef<string | null>(initialChannel?.messages.at(-1)?.id ?? null);
  const forceScrollRef = useRef(true);
  /** Set when the first load failed, so a later successful poll can clear it. */
  const loadFailedRef = useRef(false);

  /** A mark the throttle held back, sent once the gap has passed. */
  const markTimerRef = useRef<number | undefined>(undefined);

  const markRead = useCallback((id: string, force = false) => {
    const canMark = () =>
      (typeof document === "undefined" || document.visibilityState === "visible") && atBottomRef.current;
    const send = () => {
      window.clearTimeout(markTimerRef.current);
      markTimerRef.current = undefined;
      lastMarkAtRef.current = Date.now();
      void callAction(() => markChannelRead({ channelId: id }));
    };
    if (!canMark()) return;
    const wait = MARK_READ_MIN_GAP_MS - (Date.now() - lastMarkAtRef.current);
    if (force || wait <= 0) {
      send();
      return;
    }
    // Throttled, not dropped: the newest message must still end up read.
    if (markTimerRef.current === undefined) {
      markTimerRef.current = window.setTimeout(() => {
        markTimerRef.current = undefined;
        if (canMark()) send();
      }, wait);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(markTimerRef.current), []);

  /** Resolves to the failure message, or null. Pollers ignore it and keep the previous messages. */
  const refresh = useCallback(
    async (id: string, options: { force?: boolean } = {}): Promise<string | null> => {
      const result = await callAction(() => readChannel({ channelId: id }));
      if (!result.ok) return result.error;
      if (!result.data) return null;

      if (pollFailuresRef.current > 0) {
        pollFailuresRef.current = 0;
        setPollStalled(false);
      }
      if (refreshNoticeRef.current) {
        refreshNoticeRef.current = false;
        setRefreshNotice(false);
      }
      if (loadFailedRef.current) {
        loadFailedRef.current = false;
        setError(null);
      }

      const print = fingerprint(result.data);
      if (!options.force && shownRef.current !== undefined && print === shownRef.current) return null;
      shownRef.current = print;

      const messages = result.data.messages ?? [];
      const newest = messages.at(-1)?.id ?? null;
      if (newest !== newestIdRef.current) {
        lastChangeAtRef.current = Date.now();
        if (!atBottomRef.current && newestIdRef.current !== null) {
          const previousIndex = messages.findIndex((m) => m.id === newestIdRef.current);
          const added = previousIndex === -1 ? 1 : messages.length - 1 - previousIndex;
          if (added > 0) setUnseenCount((n) => n + added);
        }
        newestIdRef.current = newest;
      }
      setChannel(result.data);
      markRead(id);
      return null;
    },
    [markRead]
  );

  const reportLoadFailure = useCallback((message: string | null) => {
    if (!message || shownRef.current !== undefined) return;
    loadFailedRef.current = true;
    setError(message);
  }, []);

  // Open the channel once, then keep it. `openChannel` creates on first use, so
  // a school with no staff room yet gets one the moment somebody looks.
  useEffect(() => {
    let cancelled = false;
    if (channelId) {
      channelIdRef.current = channelId;
      if (!initialChannel || initialChannel.id !== channelId) {
        void refresh(channelId).then((message) => {
          if (!cancelled) reportLoadFailure(message);
        });
      } else {
        markRead(channelId, true);
      }
      void callAction(() => listMentionTargets({ channelId })).then((people) => {
        if (!cancelled && people.ok && people.data) setTargets(people.data);
      });
      return () => {
        cancelled = true;
      };
    }
    void callAction(() => openChannel({ kind, schoolId, memberId })).then(async (result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) {
        loadFailedRef.current = true;
        setError(result.ok ? "Could not open this conversation" : result.error);
        return;
      }
      const id = result.data.id;
      channelIdRef.current = id;
      setOpenedId(id);
      const message = await refresh(id);
      if (!cancelled) reportLoadFailure(message);
      const people = await callAction(() => listMentionTargets({ channelId: id }));
      if (!cancelled && people.ok && people.data) setTargets(people.data);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, channelId, initialChannel, schoolId, memberId, refresh, reportLoadFailure, markRead]);

  const live = useChatLive(channelId ?? openedId, () => {
    const id = channelIdRef.current;
    if (id) void refresh(id);
  });
  const liveRef = useRef(live.live);
  useEffect(() => {
    liveRef.current = live.live;
  }, [live.live]);

  // Poll only while the tab is visible. A backgrounded phone should not be
  // making a request every six seconds on a teacher's mobile data.
  useEffect(() => {
    lastChangeAtRef.current = Date.now();
    let timer: number | undefined;
    function poll() {
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      const id = channelIdRef.current;
      if (!id) return;
      void refresh(id).then((message) => {
        if (!message) return;
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= POLL_FAILURES_BEFORE_NOTICE) setPollStalled(true);
      });
    }
    function schedule() {
      window.clearTimeout(timer);
      const delay = liveRef.current ? LIVE_POLL_MS : chatPollDelayMs(Date.now() - lastChangeAtRef.current);
      timer = window.setTimeout(() => {
        poll();
        schedule();
      }, delay);
    }
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      // Back on the tab: whatever arrived while away is now in view, so mark
      // it read; then check now, and poll at the live rate again.
      lastChangeAtRef.current = Date.now();
      const id = channelIdRef.current;
      if (id) markRead(id, true);
      poll();
      schedule();
    }
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // live.live: reschedule the moment the socket comes up or drops.
  }, [refresh, markRead, live.live]);

  const scrollToBottom = useCallback(() => {
    const log = logRef.current;
    log?.scrollTo({ top: log.scrollHeight });
    atBottomRef.current = true;
    setAtBottom(true);
    setUnseenCount(0);
    // The scroll handler sees "already at bottom" and returns early, so mark here.
    const id = channelIdRef.current;
    if (id) markRead(id, true);
  }, [markRead]);

  useEffect(() => {
    if (forceScrollRef.current || atBottomRef.current) {
      forceScrollRef.current = false;
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }
  }, [channel, pending]);

  function onLogScroll() {
    const log = logRef.current;
    if (!log) return;
    const bottom = log.scrollHeight - log.scrollTop - log.clientHeight <= AT_BOTTOM_PX;
    if (bottom === atBottomRef.current) return;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) {
      setUnseenCount(0);
      const id = channelIdRef.current;
      if (id) markRead(id);
    }
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    // The @ picker opens on the token being typed at the caret.
    const match = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(value);
    setPickerQuery(match ? match[1].toLowerCase() : null);
  }

  function applyMention(target: MentionTarget) {
    setDraft((current) => current.replace(/@([a-z0-9._-]*)$/i, `@${target.username} `));
    setPickerQuery(null);
    composerRef.current?.focus();
  }

  const viewerId = channel?.viewerId ?? "";
  const viewerIsAdmin = channel?.viewerIsAdmin ?? false;

  function startReply(message: ChatMessageView) {
    setMode({
      kind: "reply",
      messageId: message.id,
      authorName: message.author.displayName,
      excerpt: message.body.split(/\r?\n/)[0]?.slice(0, 80) ?? "",
    });
    composerRef.current?.focus();
  }

  function startEdit(message: ChatMessageView) {
    setMode({ kind: "edit", messageId: message.id });
    setDraft(message.body);
    setPickerQuery(null);
    composerRef.current?.focus();
  }

  function cancelMode() {
    if (mode.kind === "edit") setDraft("");
    setMode({ kind: "new" });
  }

  function editLast() {
    const last = [...(channel?.messages ?? [])].reverse().find((m) => canEditMessage({ ...m, deletedAt: m.deleted ? new Date() : null }, viewerId));
    if (last) startEdit(last);
  }

  async function afterWrite(id: string) {
    const failure = await refresh(id, { force: true });
    return failure;
  }

  async function submit() {
    const body = draft.trim();
    const id = channelIdRef.current;
    if (!body || !id || sending) return;
    live.sendTyping(false);

    if (mode.kind === "edit") {
      setSending(true);
      let result;
      try {
        result = await callAction(() => editChatMessage({ messageId: mode.messageId, body }));
      } finally {
        setSending(false);
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setDraft("");
      setMode({ kind: "new" });
      await afterWrite(id);
      return;
    }

    const replyMode = mode.kind === "reply" ? mode : null;
    const replyToId = replyMode?.messageId;
    const tempId = `pending-${Date.now()}`;
    setPending((list) => [
      ...list,
      {
        tempId,
        body,
        replyTo: replyMode
          ? { id: replyMode.messageId, authorName: replyMode.authorName, excerpt: replyMode.excerpt, deleted: false }
          : null,
      },
    ]);
    setDraft("");
    setPickerQuery(null);
    setMode({ kind: "new" });
    forceScrollRef.current = true;
    setSending(true);
    let result;
    try {
      result = await callAction(() => sendChatMessage({ channelId: id, body, ...(replyToId ? { replyToId } : {}) }));
    } finally {
      setSending(false);
    }

    if (!result.ok) {
      // Not sent: take the bubble back and give the words back, so nothing is
      // lost and a retry is one tap.
      setPending((list) => list.filter((p) => p.tempId !== tempId));
      setDraft(body);
      if (replyMode) setMode(replyMode);
      setError(result.error);
      return;
    }
    setError(null);
    forceScrollRef.current = true;
    const refreshFailure = await afterWrite(id);
    setPending((list) => list.filter((p) => p.tempId !== tempId));
    // The message is saved, so the draft stays cleared: restoring it would invite a duplicate.
    if (refreshFailure) {
      refreshNoticeRef.current = true;
      setRefreshNotice(true);
    }
  }

  async function react(message: ChatMessageView, emoji: ReactionEmoji) {
    const id = channelIdRef.current;
    if (!id) return;
    const result = await callAction(() => toggleChatReaction({ messageId: message.id, emoji }));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await afterWrite(id);
  }

  async function confirmDelete() {
    const messageId = confirmDeleteId;
    const id = channelIdRef.current;
    setConfirmDeleteId(null);
    if (!messageId || !id) return;
    const result = await callAction(() => deleteChatMessage({ messageId }));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (mode.kind !== "new" && mode.messageId === messageId) cancelMode();
    await afterWrite(id);
  }

  function jumpTo(messageId: string) {
    const target = document.getElementById(`chat-message-${messageId}`);
    if (!target) return;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((current) => (current === messageId ? null : current)), 1600);
  }

  const suggestions =
    pickerQuery === null
      ? []
      : targets
          .filter((t) => t.username.toLowerCase().startsWith(pickerQuery) || t.displayName.toLowerCase().includes(pickerQuery))
          .slice(0, 5);

  const query = messageQuery.trim().toLowerCase();
  const allMessages = useMemo<ChatMessageView[]>(() => {
    // Tolerate views from before reactions and replies existed (a deploy
    // overlapping an open tab), so a missing field renders as "none".
    const saved = (channel?.messages ?? []).map((m) => ({
      ...m,
      reactions: m.reactions ?? [],
      replyTo: m.replyTo ?? null,
      deleted: m.deleted ?? false,
      editedAt: m.editedAt ?? null,
    }));
    const own = channel?.messages.find((m) => m.authorId === viewerId)?.author;
    const optimistic: ChatMessageView[] = pending.map((p) => ({
      id: p.tempId,
      authorId: viewerId,
      body: p.body,
      createdAt: new Date(),
      editedAt: null,
      deleted: false,
      author: own ?? { id: viewerId, displayName: "You", roleLabel: "", initials: "", isSelf: true },
      mentions: [],
      reactions: [],
      replyTo: p.replyTo,
    }));
    return [...saved, ...optimistic];
  }, [channel, pending, viewerId]);

  const visibleMessages = query
    ? allMessages.filter((m) => !m.deleted && m.body.toLowerCase().includes(query))
    : allMessages;

  // Who is here: connected to the room right now, or active in the app in the
  // last 3 minutes. Super Admins are already removed for staff by the server
  // and by the room.
  const onlineIds = useMemo(() => {
    const ids = new Set(live.onlineUserIds);
    for (const m of channel?.members ?? []) {
      if (getPresenceStatus(m.lastOnlineAt ? new Date(m.lastOnlineAt) : null).online) ids.add(m.userId);
    }
    return ids;
  }, [live.onlineUserIds, channel?.members]);
  const onlineNames = (channel?.members ?? []).filter((m) => onlineIds.has(m.userId)).map((m) => m.name);

  // "Seen" goes under your newest message only.
  const newestOwn = [...(channel?.messages ?? [])].reverse().find((m) => m.authorId === viewerId && !m.deleted);
  const seen = newestOwn
    ? seenLabel(
        channel?.kind ?? kind,
        (channel?.readers ?? []).filter((r) => new Date(r.readAt).getTime() >= new Date(newestOwn.createdAt).getTime())
      )
    : null;

  const groups = groupMessages(visibleMessages);
  const pendingIds = new Set(pending.map((p) => p.tempId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onlineNames.length > 0 && (
        <p
          className="flex items-center gap-1.5 border-b border-border/50 bg-card px-4 py-1.5 text-2xs text-muted-foreground"
          title={onlineNames.join(", ")}
        >
          <span className="size-2 rounded-full bg-success-500" aria-hidden />
          {onlineNames.length === 1
            ? `${onlineNames[0]} is active now`
            : `${onlineNames[0]} and ${onlineNames.length - 1} other${onlineNames.length - 1 === 1 ? "" : "s"} active now`}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={logRef}
          onScroll={onLogScroll}
          className="flex-1 space-y-3 overflow-y-auto bg-muted/15 px-3 pb-3 pt-8 sm:px-5"
          role="log"
          aria-live="polite"
        >
          {channel === null && !error && (
            <div aria-label="Loading conversation" className="space-y-3">
              <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-muted" />
              <div className="ml-auto h-12 w-1/2 animate-pulse rounded-2xl bg-muted" />
            </div>
          )}

          {channel && allMessages.length === 0 && (
            <p className="text-caption leading-relaxed text-muted-foreground">{emptyHint}</p>
          )}

          {channel && allMessages.length > 0 && visibleMessages.length === 0 && (
            <p className="text-caption leading-relaxed text-muted-foreground">No messages match your search.</p>
          )}

          {groups.map((group, groupIndex) => {
            const first = group.items[0];
            const previous = groups[groupIndex - 1];
            const showDay = !previous || previous.dayKey !== group.dayKey;
            const mine = group.authorId === viewerId;
            return (
              <Fragment key={first.id}>
                {showDay && (
                  <p className="pt-1 text-center text-2xs font-medium text-muted-foreground">
                    {dayLabel(new Date(first.createdAt))}
                  </p>
                )}
                <MessageGroup author={first.author} mine={mine} online={!mine && onlineIds.has(group.authorId)}>
                  {group.items.map((message, index) => (
                    <div
                      key={message.id}
                      className={cn(
                        "flex w-full flex-col rounded-lg transition-colors",
                        mine ? "items-end" : "items-start",
                        highlightId === message.id && "bg-primary/10"
                      )}
                    >
                      <MessageBubble
                        message={message}
                        viewerId={viewerId}
                        position={positionIn(index, group.items.length)}
                        sending={pendingIds.has(message.id)}
                        onJumpTo={jumpTo}
                        canEdit={canEditMessage({ ...message, deletedAt: message.deleted ? new Date() : null }, viewerId)}
                        canDelete={message.authorId === viewerId || viewerIsAdmin}
                        onReact={(emoji) => void react(message, emoji)}
                        onReply={() => startReply(message)}
                        onEdit={() => startEdit(message)}
                        onDelete={() => setConfirmDeleteId(message.id)}
                      />
                      {seen && newestOwn?.id === message.id && (
                        <p className="px-1 text-2xs text-muted-foreground">{seen}</p>
                      )}
                    </div>
                  ))}
                </MessageGroup>
              </Fragment>
            );
          })}
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 text-xs font-medium shadow-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {unseenCount > 0 ? `Jump to latest · ${unseenCount} new` : "Jump to latest"}
          </button>
        )}
      </div>

      <TypingIndicator label={typingLabel(live.typingNames)} />

      {error && (
        <p className="px-4 pb-2 text-[12px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {refreshNotice && (
        <p className="px-4 pb-2 text-[12px] text-muted-foreground" role="status">
          Sent — couldn&rsquo;t refresh the conversation. It will update shortly.
        </p>
      )}

      {pollStalled && !refreshNotice && (
        <p className="px-4 pb-2 text-[12px] text-muted-foreground" role="status">
          Can&rsquo;t refresh right now — retrying
        </p>
      )}

      <ChatComposer
        ref={composerRef}
        value={draft}
        onChange={handleDraftChange}
        onSubmit={() => void submit()}
        mode={mode}
        onCancelMode={cancelMode}
        onEditLast={editLast}
        suggestions={suggestions}
        onPickMention={applyMention}
        disabled={!channel}
        sending={sending}
        onTyping={live.sendTyping}
      />

      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in this conversation will see &ldquo;Message removed&rdquo; instead. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
