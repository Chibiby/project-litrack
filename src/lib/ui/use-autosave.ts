"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Autosave for an editable grid: once the teacher stops typing for
 * `delayMs`, the grid's own quiet save runs. Offline, it waits for the
 * connection to come back; on a failure it retries after `retryMs` (and on
 * the next edit). Edits are never lost meanwhile — `useGridDraft` keeps them
 * on the device until a save is confirmed.
 *
 * `save` must not disable the inputs or move focus: the teacher may still be
 * typing. It resolves true only when the server accepted everything it sent,
 * and `"blocked"` when it sent nothing because the input is not valid yet.
 */

export type AutosaveStatus = "idle" | "waiting" | "saving" | "saved" | "offline" | "error" | "blocked";

type Outcome = "saving" | "saved" | "offline" | "error" | "blocked" | null;

const DEFAULT_DELAY_MS = 2500;
const DEFAULT_RETRY_MS = 20_000;

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Pure: what the status line says, from the grid's state and the last attempt. */
export function autosaveStatus(enabled: boolean, dirty: boolean, outcome: Outcome): AutosaveStatus {
  if (!enabled) return "idle";
  if (outcome === "saving") return "saving";
  if (dirty) {
    return outcome === "offline" || outcome === "error" || outcome === "blocked" ? outcome : "waiting";
  }
  return outcome === null ? "idle" : "saved";
}

export function useAutosave({
  enabled,
  dirty,
  changeToken,
  busy,
  save,
  delayMs = DEFAULT_DELAY_MS,
  retryMs = DEFAULT_RETRY_MS,
}: {
  /** False for a locked or read-only grid. */
  enabled: boolean;
  dirty: boolean;
  /** Changes on every edit (e.g. the rows object): restarts the quiet period. */
  changeToken: unknown;
  /** A manual save is in flight: autosave stands aside. */
  busy: boolean;
  save: () => Promise<boolean | "blocked">;
  delayMs?: number;
  retryMs?: number;
}): { status: AutosaveStatus } {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const inFlight = useRef(false);
  const latest = useRef({ enabled, dirty, busy, save, retryMs });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    latest.current = { enabled, dirty, busy, save, retryMs };
  });

  useEffect(() => {
    runRef.current = async () => {
      const s = latest.current;
      if (!s.enabled || !s.dirty || s.busy || inFlight.current) return;
      if (!isOnline()) {
        setOutcome("offline");
        return;
      }
      inFlight.current = true;
      setOutcome("saving");
      let ok: boolean | "blocked" = false;
      try {
        ok = await s.save();
      } catch {
        ok = false;
      } finally {
        inFlight.current = false;
      }
      if (ok === "blocked") {
        setOutcome("blocked");
        return;
      }
      if (ok) {
        setOutcome("saved");
        return;
      }
      setOutcome(isOnline() ? "error" : "offline");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void runRef.current(), latest.current.retryMs);
    };
  }, []);

  // Every edit restarts the quiet period.
  useEffect(() => {
    if (!enabled || !dirty || busy) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void runRef.current(), delayMs);
    return () => clearTimeout(timer.current);
  }, [enabled, dirty, busy, changeToken, delayMs]);

  // Back online: save straight away.
  useEffect(() => {
    const onOnline = () => void runRef.current();
    const onOffline = () => {
      if (latest.current.dirty) setOutcome("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearTimeout(timer.current);
    };
  }, []);

  return { status: autosaveStatus(enabled, dirty, outcome) };
}
