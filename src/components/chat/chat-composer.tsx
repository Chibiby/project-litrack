"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { cn } from "@/lib/utils";

export type MentionTarget = {
  id: string;
  username: string;
  displayName: string;
  roleLabel: string;
};

export type ComposerMode =
  | { kind: "new" }
  | { kind: "reply"; messageId: string; authorName: string; excerpt: string }
  | { kind: "edit"; messageId: string };

export type ChatComposerHandle = { focus(): void };

/** Auto-grow stops at about six lines; after that the box scrolls. */
const MAX_HEIGHT_PX = 152;

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  mode: ComposerMode;
  onCancelMode: () => void;
  /** Up arrow on an empty box: edit your last message. */
  onEditLast: () => void;
  suggestions: MentionTarget[];
  onPickMention: (target: MentionTarget) => void;
  disabled: boolean;
  sending: boolean;
  onTyping?: (on: boolean) => void;
};

/**
 * The message box: auto-growing textarea (Enter sends, Shift+Enter newline,
 * Escape cancels a reply or edit), an emoji grid, the @mention picker, and a
 * reply / edit chip above it.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer(
  { value, onChange, onSubmit, mode, onCancelMode, onEditLast, suggestions, onPickMention, disabled, sending, onTyping },
  ref
) {
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => boxRef.current?.focus() }), []);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  function insertAtCaret(text: string) {
    const box = boxRef.current;
    if (!box) {
      onChange(value + text);
      return;
    }
    const start = box.selectionStart ?? value.length;
    const end = box.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      box.focus();
      const caret = start + text.length;
      box.setSelectionRange(caret, caret);
    });
  }

  const canSend = Boolean(value.trim()) && !disabled && !sending;

  return (
    <div className="relative border-t border-border/60 bg-card p-2 sm:p-3">
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-lg border bg-popover shadow-md">
          {suggestions.map((target) => (
            <li key={target.id}>
              {/*
                A mention-suggestion row sets its own height rather than the
                primitive's 44px touch floor (same carve-out as before): a 44px
                row would push the popover over the composer it anchors to.
              */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => onPickMention(target)}
                className="h-auto w-full justify-between gap-2 rounded-none px-3 py-2 text-left text-caption font-normal"
              >
                <span className="font-medium">{target.displayName}</span>
                <span className="text-2xs text-muted-foreground">
                  {target.roleLabel} · @{target.username}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {mode.kind !== "new" && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/60 px-3 py-1.5 text-xs">
          <p className="min-w-0 flex-1 truncate text-muted-foreground">
            {mode.kind === "reply" ? (
              <>
                <span className="font-medium text-foreground">Replying to {mode.authorName}</span>
                {mode.excerpt && <>: {mode.excerpt}</>}
              </>
            ) : (
              <span className="font-medium text-foreground">Editing message</span>
            )}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={mode.kind === "reply" ? "Cancel reply" : "Cancel edit"}
            onClick={onCancelMode}
            className="size-8 shrink-0"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      <form
        className="flex items-end gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) onSubmit();
        }}
      >
        <EmojiPicker onPick={insertAtCaret} disabled={disabled} />
        <textarea
          ref={boxRef}
          rows={1}
          value={value}
          aria-label="Message"
          placeholder="Write a message. Use @ to mention someone."
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            onTyping?.(event.target.value.trim().length > 0);
          }}
          onBlur={() => onTyping?.(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (suggestions.length > 0) {
                onPickMention(suggestions[0]);
                return;
              }
              if (canSend) onSubmit();
              return;
            }
            if (event.key === "Escape" && mode.kind !== "new") {
              event.preventDefault();
              onCancelMode();
              return;
            }
            if (event.key === "ArrowUp" && value === "" && mode.kind === "new") {
              event.preventDefault();
              onEditLast();
            }
          }}
          className={cn(
            "min-h-11 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-caption leading-relaxed lg:min-h-9 lg:py-2",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={mode.kind === "edit" ? "Save edit and send" : "Send message"}
          disabled={!canSend}
          className="size-11 shrink-0 rounded-full lg:size-9"
        >
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
});
