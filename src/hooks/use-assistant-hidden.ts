"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

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

/** The stored flag never changes from outside this hook; nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

function getServerHidden(): boolean {
  return false;
}

/**
 * Whether the assistant is hidden on this phone for this account, persisted in
 * localStorage. Missing/unreadable storage → visible (default).
 *
 * SSR / first paint always render visible; `useSyncExternalStore` swaps in the
 * stored value right after mount, same pattern as `useSidebarExpanded`, so
 * there is nothing for the server and the client to disagree on at hydration
 * time.
 */
export function useAssistantHidden(userId: string) {
  const getStoredHidden = useCallback(() => {
    try {
      return parseAssistantHidden(localStorage.getItem(assistantHiddenKey(userId)));
    } catch {
      // Private mode / blocked storage — keep default visible.
      return false;
    }
  }, [userId]);

  const storedHidden = useSyncExternalStore(subscribeNever, getStoredHidden, getServerHidden);

  const [override, setOverride] = useState<boolean | null>(null);
  const [prevUserId, setPrevUserId] = useState(userId);
  if (userId !== prevUserId) {
    // A different account on this device must not keep the last one's
    // in-session override — fall back to reading its own stored preference.
    setPrevUserId(userId);
    setOverride(null);
  }

  const hidden = override ?? storedHidden;

  const setHidden = useCallback(
    (value: boolean) => {
      setOverride(value);
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
