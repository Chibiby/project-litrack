"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-account, per-device: two accounts sharing a phone must not hide the
 * assistant for each other.
 */
export function assistantHiddenKey(userId: string): string {
  return `litrack:assistant-hidden:${userId}`;
}

/** Only the literal string "true" means hidden — anything else, including a
 * garbled or missing value, reads as visible. */
export function parseAssistantHidden(value: string | null): boolean {
  return value === "true";
}

/**
 * Whether the assistant is hidden on this phone for this account, persisted in
 * localStorage. Missing/unreadable storage → visible (default).
 *
 * SSR / first paint always render visible; after mount we sync from storage,
 * same pattern as `useSidebarExpanded`, so there is nothing for the server and
 * the client to disagree on at hydration time.
 */
export function useAssistantHidden(userId: string) {
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    try {
      setHiddenState(parseAssistantHidden(localStorage.getItem(assistantHiddenKey(userId))));
    } catch {
      // Private mode / blocked storage — keep default visible.
    }
  }, [userId]);

  const setHidden = useCallback(
    (value: boolean) => {
      setHiddenState(value);
      try {
        localStorage.setItem(assistantHiddenKey(userId), String(value));
      } catch {
        // ignore
      }
    },
    [userId]
  );

  return { hidden, setHidden };
}
