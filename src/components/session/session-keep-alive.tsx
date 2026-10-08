"use client";

import { useEffect, useRef } from "react";
import { SESSION_REFRESH_INTERVAL_MS, SESSION_REFRESH_PATH } from "@/lib/auth/auth-cookies";

const STORAGE_KEY = "litrack.sessionRefreshAt";
const CHECK_MS = 60_000;

/**
 * Renews the signed session-cache cookie so page renders can read the session
 * from it instead of the database. A plain fetch, not a server action: an
 * action makes middleware stamp the short uncached-read cookie.
 */
export function SessionKeepAlive() {
  const memoryRefreshAt = useRef<number | null>(null);
  const signedOut = useRef(false);

  useEffect(() => {
    const readLast = (): number | null => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw !== null) {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) return Math.max(parsed, memoryRefreshAt.current ?? 0);
        }
      } catch {
        // storage blocked; the in-memory value stands in
      }
      return memoryRefreshAt.current;
    };

    const writeLast = (at: number) => {
      memoryRefreshAt.current = at;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(at));
      } catch {
        // storage blocked
      }
    };

    const refresh = () => {
      if (signedOut.current) return;
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      const now = Date.now();
      const last = readLast();
      if (last !== null && now - last < SESSION_REFRESH_INTERVAL_MS) return;
      writeLast(now);
      try {
        fetch(SESSION_REFRESH_PATH, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        })
          .then((res) => {
            if (res.status === 401) signedOut.current = true;
          })
          .catch(() => undefined);
      } catch {
        // best-effort
      }
    };

    refresh();
    const timer = window.setInterval(refresh, CHECK_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return null;
}
