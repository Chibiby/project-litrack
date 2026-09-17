"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Bot, ChevronLeft, Loader2, Sparkles } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { useAssistantHidden } from "@/hooks/use-assistant-hidden";
import { cn } from "@/lib/utils";

/**
 * Loads the ~670-line panel — ChatThread, the ticket form, the assistant
 * server actions — only once someone opens it, instead of on every role
 * shell. `loadPanel` is also called eagerly on hover/focus of the FAB below,
 * so the common "hover then click" path already has the chunk in flight
 * before `openPanel` runs.
 */
const loadPanel = () => import("@/components/assistant/assistant-panel");
const AssistantPanel = dynamic(() => loadPanel().then((m) => m.AssistantPanel), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="flex h-[560px] max-h-[calc(100dvh-6rem)] w-[360px] max-w-[calc(100vw-2rem)] items-center justify-center rounded-2xl border bg-card shadow-2xl"
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

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
  /** Whether the panel should disclose that answers are sent to Google. */
  aiEnabled?: boolean;
  /** Keys the "hide the assistant on this phone" preference to this account. */
  userId: string;
};

export function AssistantWidget({ role, userName, aiEnabled, userId }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const fabRef = useRef<HTMLButtonElement>(null);
  const { hidden, setHidden } = useAssistantHidden(userId);

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

  // Hiding is a minimize, not a close: the transcript survives. Only the panel
  // and the round button leave the screen, until the edge tab brings them back.
  const hide = useCallback(() => {
    setOpen(false);
    setHidden(true);
  }, [setHidden]);

  const show = useCallback(() => {
    setHidden(false);
  }, [setHidden]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") minimize();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, minimize]);

  return (
    <>
      <div
        className={cn(
          "fixed bottom-4 right-4 z-40 flex-col items-end gap-3 print:hidden",
          // Hiding applies on phones only — at `md` and up the FAB always
          // shows, regardless of the stored preference.
          hidden ? "hidden md:flex" : "flex"
        )}
      >
        {mounted && (
          <div className={cn(open ? "block" : "hidden")}>
            <AssistantPanel
              key={sessionKey}
              role={role}
              userName={userName}
              aiEnabled={aiEnabled}
              active={open}
              onMinimize={minimize}
              onClose={close}
              onHide={hide}
            />
          </div>
        )}

        <Button
          ref={fabRef}
          size="icon"
          type="button"
          onClick={() => (open ? minimize() : openPanel())}
          onMouseEnter={loadPanel}
          onFocus={loadPanel}
          aria-expanded={open}
          aria-label={open ? "Minimize the LITRACK Assistant" : "Open the LITRACK Assistant"}
          className="relative size-14 rounded-full bg-violet text-violet-foreground shadow-lg outline-none transition-transform hover:scale-105 hover:bg-violet focus-visible:ring-offset-background active:scale-95"
        >
          <Bot className="size-6" aria-hidden />
          <Sparkles className="absolute right-3 top-3 size-3" aria-hidden />
        </Button>
      </div>

      {hidden && (
        <Button
          type="button"
          onClick={show}
          aria-label="Show the LITRACK Assistant"
          className="fixed bottom-4 right-0 z-40 h-12 w-8 rounded-l-full bg-violet p-0 text-violet-foreground shadow-lg hover:bg-violet/90 md:hidden print:hidden"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
      )}
    </>
  );
}
