"use client";

import { useEffect } from "react";
import { setUnsavedChangesDirty } from "@/hooks/unsaved-changes-context";

const DEFAULT_MESSAGE =
  "You have unsaved changes. Leave this page? Your changes will be lost.";

/**
 * Opt-in unsaved-changes guard for App Router.
 * - `beforeunload` for refresh/close
 * - Capture-phase click interceptor for in-app `<a>` navigations
 * - Syncs dirty state into the unsaved-changes store for Sign out confirms
 *
 * Next.js 14 has no stable `useBlocker`; this covers the common cases.
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  enabled: boolean,
  message: string = DEFAULT_MESSAGE
) {
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

      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, isDirty, message]);
}
