"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

/**
 * Header light/dark switch (spec R9).
 *
 * Both icons render at all times, cross-faded with opacity, so the button
 * never changes size and there is no layout shift on toggle. Before hydration
 * the label reflects the light default, which matches what ThemeScript painted
 * for the overwhelming majority of visits.
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
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className={cn("shrink-0", className)}
    >
      <span className="relative block h-5 w-5">
        <Sun
          aria-hidden
          className={cn(
            "absolute inset-0 h-5 w-5",
            hydrated && "transition-opacity duration-200",
            isDark ? "opacity-0" : "opacity-100"
          )}
        />
        <Moon
          aria-hidden
          className={cn(
            "absolute inset-0 h-5 w-5",
            hydrated && "transition-opacity duration-200",
            isDark ? "opacity-100" : "opacity-0"
          )}
        />
      </span>
    </Button>
  );
}
