"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import {
  prefersReducedMotion,
  ripple,
  showSaved,
  sink,
  springBack,
  type PressTone,
} from "@/lib/ui/press-feedback";

const PRESSABLE = "[data-press]";

function pressable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(PRESSABLE);
  if (!el) return null;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

const toneOf = (el: HTMLElement): PressTone => (el.dataset.press === "dark" ? "dark" : "light");

/** Ids of every toast sonner has shown so far. */
function toastIds(): Set<string | number> {
  return new Set(toast.getHistory().map((t) => t.id));
}

/**
 * One listener for the whole app: every element marked `data-press` (Button,
 * the alert-dialog actions) sinks and ripples on press and springs back on
 * release. A `data-save` button whose save ended with a success toast, and no
 * error toast, draws the "Saved" ring and tick (see press-feedback.ts).
 */
export function PressFeedback() {
  useEffect(() => {
    let held: HTMLElement | null = null;

    const release = () => {
      if (held) springBack(held);
      held = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || prefersReducedMotion()) return;
      const el = pressable(event.target);
      if (!el) return;
      held = el;
      sink(el);
      ripple(el, event.clientX, event.clientY, toneOf(el));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      if (prefersReducedMotion()) return;
      const el = pressable(event.target);
      if (!el || el !== event.target) return;
      const rect = el.getBoundingClientRect();
      sink(el);
      ripple(el, rect.left + rect.width / 2, rect.top + rect.height / 2, toneOf(el));
      window.setTimeout(() => springBack(el), 90);
    };

    // Save success: Button sets aria-busy while `loading`. Remember which
    // toasts existed when a save button went busy; when it stops, a new
    // success toast and no new error means the save worked.
    const before = new WeakMap<Element, Set<string | number>>();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target;
        if (!(el instanceof HTMLElement) || !el.hasAttribute("data-save")) continue;
        if (el.getAttribute("aria-busy") === "true") {
          before.set(el, toastIds());
          continue;
        }
        const seen = before.get(el);
        if (!seen) continue;
        before.delete(el);
        const fresh = toast.getHistory().filter((t) => !seen.has(t.id));
        const ok = fresh.some((t) => "type" in t && t.type === "success");
        const failed = fresh.some((t) => "type" in t && t.type === "error");
        if (ok && !failed && el.isConnected && !prefersReducedMotion()) showSaved(el);
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["aria-busy"], subtree: true });

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    window.addEventListener("blur", release);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
