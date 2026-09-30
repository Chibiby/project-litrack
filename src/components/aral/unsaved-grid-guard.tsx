"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  internalNavigationHref,
  registerUnsavedGuard,
} from "@/lib/ui/unsaved-guard";

/**
 * Renders the "unsaved changes" dialog and wires the page-level protections for
 * one grid: the dialog for in-app moves that would discard it, and the browser's
 * own prompt for closing or reloading the tab.
 *
 * The grid's panel owns the decision to leave (week, month, grade, section,
 * pager); it asks through `runGuarded` from `@/lib/ui/unsaved-guard`. Plain
 * links (sidebar, pager, term tabs) are caught here so they need no changes.
 * Browser back/forward cannot be held back from script and is not covered.
 */
export function UnsavedGridGuard({
  dirty,
  saving = false,
  what,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  /** A save is already in flight elsewhere on the page. */
  saving?: boolean;
  /** Plural noun for the dialog text, e.g. "attendance marks". */
  what: string;
  /** Resolves true only when the server accepted the save (or nothing needed saving). */
  onSave: () => Promise<boolean>;
  /** Puts the grid back to its last saved values. */
  onDiscard?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(dirty);
  const pendingRef = useRef(pending);
  // Set once the teacher has answered (saved or discarded) and the move is on its
  // way. The sync effect below must not overwrite it: the grid stays "dirty" for
  // a render or two while the move is in flight, and a second click in that gap
  // must not ask again. Cleared when the grid is clean again or typed into.
  const answeredRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
    pendingRef.current = pending;
    if (!dirty) answeredRef.current = false;
  });

  useEffect(() => {
    function onEdit() {
      answeredRef.current = false;
    }
    document.addEventListener("input", onEdit, true);
    return () => document.removeEventListener("input", onEdit, true);
  }, []);

  useEffect(
    () =>
      registerUnsavedGuard({
        isDirty: () => dirtyRef.current && !answeredRef.current,
        request: (proceed) => {
          if (pendingRef.current) return;
          setPending({ proceed });
        },
      }),
    []
  );

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dirtyRef.current || answeredRef.current || pendingRef.current) return;
      const anchor =
        event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      const href = internalNavigationHref(
        anchor as HTMLAnchorElement,
        event,
        window.location
      );
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ proceed: () => router.push(href) });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  const working = busy || saving;

  async function saveAndContinue() {
    if (!pending || working) return;
    setBusy(true);
    let ok = false;
    try {
      ok = await onSave();
    } finally {
      setBusy(false);
    }
    // A refused save has already said why; the teacher stays with input intact.
    const next = pending;
    setPending(null);
    if (ok) proceed(next.proceed);
  }

  function proceed(run: () => void) {
    answeredRef.current = true;
    run();
  }

  function discard() {
    if (!pending || working) return;
    const next = pending;
    setPending(null);
    onDiscard?.();
    proceed(next.proceed);
  }

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !working) setPending(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            Your {what} on this page are not saved yet. Save them before you
            continue, or discard them and lose what you typed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:flex-wrap">
          <AlertDialogCancel disabled={working} className="h-11 lg:h-10">
            Stay
          </AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={working}
            onClick={discard}
            className="h-11 text-destructive hover:text-destructive lg:h-10"
          >
            Discard changes
          </Button>
          <Button
            type="button"
            onClick={() => void saveAndContinue()}
            disabled={working}
            loading={working}
            loadingText="Saving…"
            className="h-11 lg:h-10"
          >
            Save and continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The "Unsaved changes" marker beside Save. The live region stays mounted so the
 * change is announced when it appears, and the words carry the state, not colour.
 */
export function UnsavedChangesBadge({
  dirty,
  className,
}: {
  dirty: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(dirty ? "col-span-2 flex sm:col-span-1" : "sr-only", className)}
    >
      {dirty ? (
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          Unsaved changes
        </Badge>
      ) : null}
    </div>
  );
}
