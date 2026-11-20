"use client";

import { useEffect } from "react";
import { isUnsavedChangesDirty } from "@/hooks/unsaved-changes-context";
import { hasUnsavedGridInput } from "@/lib/ui/unsaved-guard";
import { isNewerDeployment, shouldReloadForUpdate } from "@/lib/app-update/policy";

const CURRENT = process.env.NEXT_PUBLIC_LITRACK_DEPLOYMENT_ID;
const VERSION_URL = "/litrack-version.json";
const CHECK_EVERY_MS = 10 * 60_000;
const MIN_GAP_MS = 60_000;
const APPLY_TICK_MS = 15_000;

function busy(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
  return document.querySelector('[role="dialog"],[role="alertdialog"]') !== null;
}

/**
 * Picks up a new release without asking anyone to reload.
 *
 * A tab compares its build's deployment ID with the static version file (served
 * by the asset layer, so a check costs no Worker request). Once a newer one is
 * live, the tab reloads itself when that cannot disturb anyone: hidden, or idle
 * with nothing typed and unsaved (`shouldReloadForUpdate`). Until then, Next's
 * own `deploymentId` check turns the next navigation into a full page load, so
 * a stale tab never shows an update error just for moving between pages.
 */
export function SilentUpdater() {
  useEffect(() => {
    if (!CURRENT) return;
    let updateReady = false;
    let lastInput = Date.now();
    let lastCheck = 0;

    const tryApply = () => {
      const reload = shouldReloadForUpdate({
        updateReady,
        hidden: document.visibilityState === "hidden",
        unsavedWork: isUnsavedChangesDirty() || hasUnsavedGridInput(),
        busy: busy(),
        idleMs: Date.now() - lastInput,
      });
      if (reload) window.location.reload();
    };

    const check = async () => {
      if (updateReady || Date.now() - lastCheck < MIN_GAP_MS) return tryApply();
      lastCheck = Date.now();
      try {
        const res = await fetch(VERSION_URL, { cache: "no-cache" });
        if (res.ok && isNewerDeployment(CURRENT, await res.json())) updateReady = true;
      } catch {
        // Offline or a blocked request: try again on the next check.
      }
      tryApply();
    };

    const onInput = () => {
      lastInput = Date.now();
    };
    const onVisibility = () => void check();
    const inputs = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const type of inputs) window.addEventListener(type, onInput, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    const checkTimer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const applyTimer = window.setInterval(() => {
      if (updateReady) tryApply();
    }, APPLY_TICK_MS);

    return () => {
      for (const type of inputs) window.removeEventListener(type, onInput, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.clearInterval(checkTimer);
      window.clearInterval(applyTimer);
    };
  }, []);

  return null;
}
