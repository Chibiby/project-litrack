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

/** Buttons: sink, ripple and spring back. */
const PRESSABLE = "[data-press]";
/**
 * Everything else a person can tap (cards, sidebar and menu rows, tabs, list
 * links): the same ripple from the press point, without the sink, which would
 * make a whole card or row jump. `data-no-ripple` opts an element out.
 */
const CLICKABLE = [
  PRESSABLE,
  "a[href]",
  "button",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  "summary",
].join(",");

/** A touch that turns into a scroll inside this window gets no ripple. */
const TOUCH_DELAY_MS = 60;

function isDisabled(el: HTMLElement): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute("aria-disabled") === "true" ||
    el.hasAttribute("data-disabled")
  );
}

function pressable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(CLICKABLE);
  if (!el || isDisabled(el) || el.closest("[data-no-ripple]")) return null;
  // A link inside a sentence is text, not a surface: no ripple over the words.
  if (!el.hasAttribute("data-press") && getComputedStyle(el).display === "inline") return null;
  return el;
}

/** Plain clickables ripple in their own text colour, like an outline button. */
const toneOf = (el: HTMLElement): PressTone => (el.dataset.press === "light" ? "light" : "dark");
const sinks = (el: HTMLElement) => el.hasAttribute("data-press");

/** Ids of every toast sonner has shown so far. */
function toastIds(): Set<string | number> {
  return new Set(toast.getHistory().map((t) => t.id));
}

/**
 * One listener for the whole app: every element marked `data-press` (Button,
 * the alert-dialog actions) sinks and ripples on press and springs back on
 * release; every other clickable (cards, sidebar and menu rows, tabs, links)
 * ripples from the press point. A `data-save` button whose save ended with a success toast, and no
 * error toast, draws the "Saved" ring and tick (see press-feedback.ts).
 */
export function PressFeedback() {
  useEffect(() => {
    let held: HTMLElement | null = null;
    let pending: number | undefined;

    const start = (el: HTMLElement, x: number, y: number) => {
      if (!el.isConnected) return;
      if (sinks(el)) {
        held = el;
        sink(el);
      }
      ripple(el, x, y, toneOf(el));
    };

    const release = () => {
      window.clearTimeout(pending);
      pending = undefined;
      if (held) springBack(held);
      held = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || prefersReducedMotion()) return;
      const el = pressable(event.target);
      if (!el) return;
      const { clientX, clientY } = event;
      if (event.pointerType !== "touch") {
        start(el, clientX, clientY);
        return;
      }
      // On a touch screen wait a moment: a finger that starts a scroll fires
      // pointercancel, which clears this, so swiping a list does not flash.
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        pending = undefined;
        start(el, clientX, clientY);
      }, TOUCH_DELAY_MS);
    };

    // A quick tap lifts before the delay ends: show the ripple anyway.
    const onPointerUp = (event: PointerEvent) => {
      if (pending !== undefined) {
        window.clearTimeout(pending);
        pending = undefined;
        const el = pressable(event.target);
        if (el) ripple(el, event.clientX, event.clientY, toneOf(el));
      }
      release();
    };

    const onPointerCancel = () => {
      window.clearTimeout(pending);
      pending = undefined;
      release();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      if (prefersReducedMotion()) return;
      const el = pressable(event.target);
      if (!el || el !== event.target) return;
      const rect = el.getBoundingClientRect();
      if (sinks(el)) {
        sink(el);
        window.setTimeout(() => springBack(el), 90);
      }
      ripple(el, rect.left + rect.width / 2, rect.top + rect.height / 2, toneOf(el));
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
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("pointercancel", onPointerCancel, { passive: true });
    window.addEventListener("blur", release);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown);
      window.clearTimeout(pending);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", release);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
