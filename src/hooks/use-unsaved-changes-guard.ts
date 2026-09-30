"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setUnsavedChangesDirty } from "@/hooks/unsaved-changes-context";

const DEFAULT_MESSAGE =
  "You have unsaved changes. Leave this page? Your changes will be lost.";

/**
 * Opt-in unsaved-changes guard for App Router.
 * - `beforeunload` for refresh/close
 * - Capture-phase click interceptor for in-app `<a>` navigations; the caller
 *   renders the returned state in an app dialog (no browser confirm)
 * - Syncs dirty state into the unsaved-changes store for Sign out confirms
 *
 * Next.js 14 has no stable `useBlocker`; this covers the common cases.
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  enabled: boolean,
  message: string = DEFAULT_MESSAGE
) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Sync dirty → store. Clear only on unmount / disable, not between dep updates
  // (cleanup-set-false then set-true races made Sign out read a stale clean state).
  useEffect(() => {
    if (!enabled) {
      setUnsavedChangesDirty(false);
      return;
    }
    setUnsavedChangesDirty(Boolean(isDirty), message);
  }, [enabled, isDirty, message]);

  useEffect(() => {
    return () => setUnsavedChangesDirty(false);
  }, []);

  useEffect(() => {
    if (!enabled || !isDirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled, isDirty, message]);

  useEffect(() => {
    if (!enabled || !isDirty) return;

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = (e.target as HTMLElement | null)?.closest("a");
      if (!target) return;
      if (target.target === "_blank" || target.hasAttribute("download")) return;

      const href = target.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      if (href.startsWith("javascript:")) return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      // Held, not allowed through: the app dialog decides, and only "Discard
      // changes" replays the navigation.
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, isDirty]);

  return {
    /** In-app link the person tried to follow while the form was dirty. */
    leaveOpen: pendingHref !== null,
    keepEditing: () => setPendingHref(null),
    discardAndLeave: () => {
      const href = pendingHref;
      setPendingHref(null);
      // Clean first, so nothing re-intercepts the navigation we are replaying.
      setUnsavedChangesDirty(false);
      if (href) router.push(href);
    },
  };
}
