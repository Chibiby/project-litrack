"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { cn } from "@/lib/utils";

/**
 * The floating assistant button, and the panel it opens.
 *
 * Three states, not two. "Closed" has never been shown; "minimized" has, and
 * keeping the transcript through a minimize is the difference between glancing
 * at the page behind the panel and losing the answer you were reading.
 *
 * So the panel mounts on first open and then stays mounted, hidden with
 * `hidden` rather than unmounted, until the person actually closes it — at
 * which point `sessionKey` increments and the next open gets a genuinely fresh
 * panel. Deferring that first mount also keeps `Date.now()` and
 * `schoolToday()` out of the server render for everybody who never opens it.
 *
 * `z-40` puts it above page content and the header but below dialogs and the
 * mobile sidebar sheet, both `z-50`: a modal must be able to cover this.
 */

type Props = {
  role: UserRole;
  /** Used for the greeting only. First name is taken from it client-side. */
  userName: string;
};

export function AssistantWidget({ role, userName }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const fabRef = useRef<HTMLButtonElement>(null);

  const openPanel = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  const minimize = useCallback(() => {
    setOpen(false);
    fabRef.current?.focus();
  }, []);

  // Closing is the destructive one: it drops the transcript. Escape minimizes
  // instead, so a stray keypress never throws away what somebody just read.
  const close = useCallback(() => {
    setOpen(false);
    setMounted(false);
    setSessionKey((key) => key + 1);
    fabRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") minimize();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, minimize]);

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 print:hidden">
      {mounted && (
        <div className={cn(open ? "block" : "hidden")}>
          <AssistantPanel
            key={sessionKey}
            role={role}
            userName={userName}
            active={open}
            onMinimize={minimize}
            onClose={close}
          />
        </div>
      )}

      <button
        ref={fabRef}
        type="button"
        onClick={() => (open ? minimize() : openPanel())}
        aria-expanded={open}
        aria-label={open ? "Minimize the LITRACK Assistant" : "Open the LITRACK Assistant"}
        className="relative flex size-14 items-center justify-center rounded-full bg-violet text-violet-foreground shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95"
      >
        <Bot className="size-6" aria-hidden />
        <Sparkles className="absolute right-3 top-3 size-3" aria-hidden />
      </button>
    </div>
  );
}
