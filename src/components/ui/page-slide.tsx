"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Parent and child pages move like the sign-in steps: the parent (a list) is
 * the left page, the child (one item) the right one. Opening a child slides it
 * in from the right; going back slides the parent in from the left. Same slide
 * as the sign-in card (`stepSlide` in login-form.tsx): full width, the slide
 * curve, none under Reduce Motion.
 *
 * Used by the Division Summary (summaries -> one summary), Learners
 * (directory -> one learner) and Schools (list -> one school). To add a pair,
 * wrap each page in `<PageSlide>` with its side, and make the links between
 * them `<PageNavLink>` (or call `markPageSlide` before a `router.push`). A
 * parent whose child links live deep in a table can pass `forwardHrefPrefix`
 * instead: any plain click on a link under that path slides forward.
 *
 * The direction is set by the link that was clicked (or the browser's back
 * and forward buttons) and read once by the page that mounts next. A page
 * loaded fresh, or reached any other way, does not slide.
 */
type Dir = "forward" | "back";
type Pending = Dir | "history" | null;

let pending: Pending = null;
/** When `pending` was set: a direction older than a navigation's worth is dropped. */
let pendingAt = 0;
const PENDING_TTL_MS = 20_000;

function setPending(next: Pending): void {
  pending = next;
  pendingAt = Date.now();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    setPending("history");
  });
}

/** Set the slide for the next page before navigating from script. */
export function markPageSlide(dir: Dir): void {
  setPending(dir);
}

const SLIDE = "animate-in fade-in-50 duration-slow ease-slide motion-reduce:animate-none";

export function PageSlide({
  side,
  forwardHrefPrefix,
  children,
}: {
  /** "parent" is the list (left page), "child" one item (right page). */
  side: "parent" | "child";
  /** Links whose href starts with this open a child: clicking one slides forward. */
  forwardHrefPrefix?: string;
  children: React.ReactNode;
}) {
  // Read in the initializer (so the first paint already slides) and clear in
  // an effect: StrictMode calls the initializer twice.
  const [dir] = useState<Dir | null>(() => {
    if (!pending || Date.now() - pendingAt > PENDING_TTL_MS) return null;
    return pending === "history" ? (side === "parent" ? "back" : "forward") : pending;
  });
  useEffect(() => {
    pending = null;
  }, []);

  return (
    // overflow-x-clip hides the page while it is off to one side without
    // making a scroll container, so sticky toolbars inside keep working.
    <div
      className="min-w-0 overflow-x-clip"
      onClickCapture={
        forwardHrefPrefix
          ? (e) => {
              const href = (e.target as Element).closest?.("a[href]")?.getAttribute("href");
              if (href?.startsWith(forwardHrefPrefix) && isPlainClick(e)) setPending("forward");
            }
          : undefined
      }
    >
      <div
        className={cn(
          "min-w-0",
          dir && SLIDE,
          dir === "forward" && "slide-in-from-right-full",
          dir === "back" && "slide-in-from-left-full",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** True for a plain left click that navigates in this tab. */
export function isPlainClick(e: React.MouseEvent): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** A link that slides the next page in from the `dir` side. */
export function PageNavLink({
  dir,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { dir: Dir }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        // A modified click opens a new tab: nothing here should slide.
        if (isPlainClick(e)) setPending(dir);
      }}
    />
  );
}
