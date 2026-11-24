"use client";

import type { ReactNode } from "react";
import type { ChatAuthor } from "@/lib/actions/chat";
import { cn } from "@/lib/utils";

/** A speaker's avatar with an optional green "active now" dot. */
export function ChatAvatar({
  initials,
  online = false,
  className,
}: {
  initials: string;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-8 shrink-0", className)} aria-hidden>
      <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initials}
      </span>
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-success-500" />
      )}
    </span>
  );
}

/**
 * One sender's turn: the name once at the top (others only), the avatar once
 * at the bottom, and the bubbles between. Own turns carry no name or avatar.
 */
export function MessageGroup({
  author,
  mine,
  online,
  children,
}: {
  author: ChatAuthor;
  mine: boolean;
  online: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      {!mine && <ChatAvatar initials={author.initials} online={online} className="mb-5" />}
      <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", mine ? "items-end" : "items-start")}>
        {!mine && (
          <p className="px-1 text-2xs text-muted-foreground">
            <span className="font-medium text-foreground">{author.displayName}</span>
            {" · "}
            {author.roleLabel}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
