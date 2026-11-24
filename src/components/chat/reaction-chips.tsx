"use client";

import type { ChatReactionView } from "@/lib/actions/chat";
import { REACTION_LABELS } from "@/lib/chat/view";
import { cn } from "@/lib/utils";

/** Counts under a bubble. Tapping a chip toggles your own reaction. */
export function ReactionChips({
  reactions,
  viewerId,
  mine,
  onToggle,
}: {
  reactions: ChatReactionView[];
  viewerId: string;
  /** Own bubble: chips line up on the right. */
  mine: boolean;
  onToggle: (emoji: ChatReactionView["emoji"]) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className={cn("-mt-1.5 flex flex-wrap gap-1", mine ? "justify-end pr-1" : "pl-1")}>
      {reactions.map((r) => {
        const pressed = r.userIds.includes(viewerId);
        const who = r.names.join(", ");
        return (
          <button
            key={r.emoji}
            type="button"
            title={who}
            aria-label={`${REACTION_LABELS[r.emoji]}, ${r.userIds.length}: ${who}`}
            aria-pressed={pressed}
            onClick={() => onToggle(r.emoji)}
            className={cn(
              "relative z-[1] inline-flex h-7 items-center gap-1 rounded-full border bg-card px-2 text-xs tabular-nums shadow-sm",
              "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pressed ? "border-primary/50 bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground"
            )}
          >
            <span aria-hidden className="text-sm leading-none">
              {r.emoji}
            </span>
            {r.userIds.length > 1 && <span aria-hidden>{r.userIds.length}</span>}
          </button>
        );
      })}
    </div>
  );
}
