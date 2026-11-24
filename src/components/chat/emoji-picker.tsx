"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/**
 * A small built-in emoji grid for typing. Not the reaction set: reactions stay
 * the six fixed ones. No dependency, no search — a staff chat needs the common
 * faces and gestures, not 3,000 glyphs.
 */
export const COMPOSER_EMOJI = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂",
  "😉", "😊", "😍", "🥰", "😘", "😎", "🤔", "🤗",
  "😮", "😢", "😭", "😡", "😴", "🙄", "😬", "🥳",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "🤝",
  "❤️", "💙", "💯", "✅", "⭐", "🎉", "📚", "✏️",
] as const;

export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Insert emoji"
          disabled={disabled}
          className="size-11 shrink-0 text-muted-foreground lg:size-9"
        >
          <Smile className="size-5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto p-2">
        <div role="grid" aria-label="Emoji" className="grid grid-cols-8 gap-0.5">
          {COMPOSER_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Insert ${emoji}`}
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              className="flex size-9 items-center justify-center rounded-md text-xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
