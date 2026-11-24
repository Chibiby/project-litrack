"use client";

import { useRef, useState } from "react";
import { CornerUpLeft, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatMessageView } from "@/lib/actions/chat";
import { segmentMessage } from "@/lib/chat/mentions";
import type { ReactionEmoji } from "@/lib/chat/view";
import { cn } from "@/lib/utils";
import { ReactionBar } from "@/components/chat/reaction-bar";
import { ReactionChips } from "@/components/chat/reaction-chips";

/** Hold this long on a touch screen to open a message's actions. */
const LONG_PRESS_MS = 450;

export function clockLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function fullTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export type BubblePosition = "single" | "first" | "middle" | "last";

export type MessageBubbleProps = {
  message: ChatMessageView;
  viewerId: string;
  position: BubblePosition;
  /** Shown while an optimistic send is in flight. */
  sending?: boolean;
  /** Rendered as a quote above the text; clicking jumps to the original. */
  onJumpTo?: (messageId: string) => void;
  canEdit: boolean;
  canDelete: boolean;
  onReact: (emoji: ReactionEmoji) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/**
 * One message: the bubble, its quote, its reactions, and — on hover, focus or
 * long-press — the reaction bar, Reply and More. Messenger shape: own messages
 * right in primary blue, others left on muted; corners tighten inside a group.
 */
export function MessageBubble({
  message,
  viewerId,
  position,
  sending = false,
  onJumpTo,
  canEdit,
  canDelete,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: MessageBubbleProps) {
  const mine = message.authorId === viewerId;
  const [active, setActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showActions = (active || menuOpen) && !message.deleted && !sending;
  const myReactions = new Set(message.reactions.filter((r) => r.userIds.includes(viewerId)).map((r) => r.emoji));
  const segments = message.deleted ? [] : segmentMessage(message.body, message.mentions);
  const createdAt = new Date(message.createdAt);

  const corner = mine
    ? {
        single: "rounded-2xl rounded-br-md",
        first: "rounded-2xl rounded-br-md",
        middle: "rounded-2xl rounded-r-md",
        last: "rounded-2xl rounded-tr-md",
      }[position]
    : {
        single: "rounded-2xl rounded-bl-md",
        first: "rounded-2xl rounded-bl-md",
        middle: "rounded-2xl rounded-l-md",
        last: "rounded-2xl rounded-tl-md",
      }[position];

  function clearPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  return (
    <div
      data-message-row
      id={`chat-message-${message.id}`}
      tabIndex={0}
      aria-label={`${message.author.displayName}, ${clockLabel(createdAt)}`}
      className={cn(
        "group/msg relative flex w-full flex-col rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
        mine ? "items-end" : "items-start"
      )}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setActive(true);
      }}
      onPointerLeave={(e) => {
        clearPress();
        if (e.pointerType === "mouse") setActive(false);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        clearPress();
        pressTimer.current = setTimeout(() => setActive(true), LONG_PRESS_MS);
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(e) => {
        // A long-press on a phone opens our actions, not the browser's menu.
        if (active) e.preventDefault();
      }}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
      }}
    >
      {message.replyTo && !message.deleted && (
        <button
          type="button"
          onClick={() => onJumpTo?.(message.replyTo!.id)}
          className={cn(
            "mb-0.5 max-w-[78%] truncate rounded-xl border-l-2 border-primary/50 bg-muted/60 px-3 py-1 text-left text-xs text-muted-foreground",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <span className="font-medium text-foreground">{message.replyTo.authorName}</span>
          {": "}
          {message.replyTo.deleted ? <em>Message removed</em> : message.replyTo.excerpt}
        </button>
      )}

      <div className={cn("relative flex max-w-[78%] items-center gap-1", mine && "flex-row-reverse")}>
        <div
          data-bubble
          title={fullTimeLabel(createdAt)}
          className={cn(
            "min-w-0 whitespace-pre-wrap break-words px-3 py-2 text-caption leading-relaxed",
            corner,
            message.deleted
              ? "border border-dashed border-border bg-transparent italic text-muted-foreground"
              : mine
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            sending && "opacity-70"
          )}
        >
          {message.deleted ? (
            "Message removed"
          ) : (
            segments.map((segment, index) =>
              segment.kind === "mention" ? (
                <span
                  key={index}
                  className={cn(
                    "rounded px-0.5 font-semibold",
                    mine ? "bg-primary-foreground/20" : "bg-primary/10 text-primary"
                  )}
                >
                  {segment.text}
                </span>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )
          )}
        </div>

        {showActions && (
          <div
            aria-live="off"
            className={cn(
              "absolute bottom-full z-10 mb-1 flex items-center gap-1",
              mine ? "right-0" : "left-0"
            )}
          >
            <ReactionBar mine={myReactions} onPick={onReact} />
            <div className="flex items-center rounded-full border border-border/70 bg-popover p-0.5 shadow-md">
              <button
                type="button"
                aria-label="Reply"
                onClick={onReply}
                className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-8"
              >
                <CornerUpLeft className="size-4" aria-hidden />
              </button>
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="More"
                    className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-8"
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={mine ? "end" : "start"}>
                  <DropdownMenuItem
                    onSelect={() => {
                      void navigator.clipboard?.writeText(message.body).catch(() => {});
                    }}
                  >
                    Copy
                  </DropdownMenuItem>
                  {canEdit && <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>}
                  {canDelete && (
                    <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>

      {!message.deleted && (
        <ReactionChips reactions={message.reactions} viewerId={viewerId} mine={mine} onToggle={onReact} />
      )}

      {(sending || message.editedAt || position === "last" || position === "single") && (
        <p className="mt-0.5 px-1 text-2xs text-muted-foreground">
          {sending ? (
            "Sending…"
          ) : (
            <>
              {(position === "last" || position === "single") && clockLabel(createdAt)}
              {message.editedAt && !message.deleted && (
                <>
                  {(position === "last" || position === "single") && " · "}
                  <span>edited</span>
                </>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}
