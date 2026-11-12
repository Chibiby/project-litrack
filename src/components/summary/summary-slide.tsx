"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The summaries move like the sign-in steps: the list of summaries is the
 * left page, each summary the right one. Opening a summary slides it in from
 * the right; going back slides the list in from the left. Same slide as the
 * sign-in card (`stepSlide` in login-form.tsx): full width, iOS push curve,
 * none under Reduce Motion.
 *
 * The direction is set by the link that was clicked (or the browser's back
 * and forward buttons) and read once by the page that mounts next. A page
 * loaded fresh, or reached any other way, does not slide.
 */
type Dir = "forward" | "back";
type Pending = Dir | "history" | null;

let pending: Pending = null;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    pending = "history";
  });
}

const SLIDE =
  "animate-in fade-in-50 [animation-duration:420ms] [animation-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none";

export function SummarySlide({
  side,
  children,
}: {
  /** "list" is the index of summaries (left page), "summary" one summary (right page). */
  side: "list" | "summary";
  children: React.ReactNode;
}) {
  // Read in the initializer (so the first paint already slides) and clear in
  // an effect: StrictMode calls the initializer twice.
  const [dir] = useState<Dir | null>(() =>
    pending === "history" ? (side === "list" ? "back" : "forward") : pending,
  );
  useEffect(() => {
    pending = null;
  }, []);

  return (
    // overflow-x-clip hides the page while it is off to one side without
    // making a scroll container, so sticky toolbars inside keep working.
    <div className="min-w-0 overflow-x-clip">
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

/** A link that slides the next summary page in from the `dir` side. */
export function SummaryNavLink({
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
        if (
          !e.defaultPrevented &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey
        )
          pending = dir;
      }}
    />
  );
}
