"use client";

import { useEffect } from "react";

const PREFIX = /^\(\d+\)\s/;

/**
 * Puts the unread count in the browser tab — "(2) Support · LITRACK" — so a
 * message is noticed from another tab. Zero, or leaving the page, puts the
 * title back as the page set it. Reads the title each time rather than
 * remembering it, so a navigation that retitles the page is never undone.
 */
export function useUnreadTitle(count: number): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = document.title.replace(PREFIX, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = document.title.replace(PREFIX, "");
    };
  }, [count]);
}
