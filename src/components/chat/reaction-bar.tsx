"use client";

import { REACTION_EMOJI, REACTION_LABELS, type ReactionEmoji } from "@/lib/chat/view";
import { cn } from "@/lib/utils";

/** The six quick reactions, shown on hover, focus or long-press of a message. */
export function ReactionBar({
  mine,
  onPick,
  className,
}: {
  /** Emoji this viewer has already used on the message. */
  mine: ReadonlySet<string>;
  onPick: (emoji: ReactionEmoji) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Reactions"
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-border/70 bg-popover p-0.5 shadow-md",
        className
      )}
    >
      {REACTION_EMOJI.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React with ${REACTION_LABELS[emoji]}`}
          aria-pressed={mine.has(emoji)}
          onClick={() => onPick(emoji)}
          className={cn(
            "flex size-11 items-center justify-center rounded-full text-lg leading-none transition-transform",
            "hover:scale-125 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-8 lg:text-base",
            mine.has(emoji) && "bg-primary/15"
          )}
        >
          <span aria-hidden>{emoji}</span>
        </button>
      ))}
    </div>
  );
}
