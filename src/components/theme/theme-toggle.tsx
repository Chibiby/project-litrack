"use client";

import { useId, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeOrigin } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

/** The centre of an element in viewport pixels: where the theme circle grows from. */
export function originOf(el: Element): ThemeOrigin {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * One drawing that morphs between a sun and a moon. In dark mode the core
 * grows, a masked bite slides in to carve the crescent, and the rays spin
 * away; in light mode the same moves run backwards. Transforms only, so it
 * animates in every browser and costs no layout.
 */
export function ThemeIcon({
  dark,
  animate = true,
  className,
}: {
  dark: boolean;
  /** False before hydration, so the first paint does not play the morph. */
  animate?: boolean;
  className?: string;
}) {
  const maskId = `theme-moon-${useId().replace(/:/g, "")}`;
  const ease = animate ? "transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]" : "";
  const fade = animate ? "transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]" : "";
  const viewBoxOrigin = "[transform-box:view-box] [transform-origin:12px_12px]";

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn(
        "h-5 w-5",
        viewBoxOrigin,
        ease,
        dark ? "-rotate-[30deg]" : "rotate-0",
        className
      )}
    >
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <circle
          cx="17"
          cy="7"
          r="7"
          fill="black"
          className={cn(ease, dark ? "translate-x-0 translate-y-0" : "translate-x-[10px] -translate-y-[10px]")}
        />
      </mask>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="currentColor"
        mask={`url(#${maskId})`}
        className={cn(viewBoxOrigin, ease, dark ? "scale-100" : "scale-[0.5]")}
      />
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={cn(
          viewBoxOrigin,
          fade,
          dark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        )}
      >
        <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M4.6 19.4L6 18M18 6l1.4-1.4" />
      </g>
    </svg>
  );
}

/**
 * Header light/dark switch (spec R9). The icon morphs sun to moon and back;
 * the new theme spreads from the button as a growing circle. The button keeps
 * one size throughout, so nothing around it shifts.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme, hydrated } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={(e: MouseEvent<HTMLButtonElement>) => toggleTheme(originOf(e.currentTarget))}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className={cn("shrink-0", className)}
    >
      <ThemeIcon dark={isDark} animate={hydrated} />
    </Button>
  );
}
