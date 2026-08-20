"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The comp's underline tab strip, hand-rolled.
 *
 * `@radix-ui/react-tabs` is not a dependency and this is the only tab strip in
 * the app, so a ~50-line implementation is cheaper than a new package. It
 * carries the full ARIA tab pattern: `tablist` / `tab` / `tabpanel` wiring,
 * roving tabindex, and Arrow / Home / End key navigation.
 */

export type ProfileTabKey =
  | "profile"
  | "attendance"
  | "reading"
  | "grades"
  | "aral";

export const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "attendance", label: "Attendance" },
  { key: "reading", label: "Reading Level" },
  { key: "grades", label: "Grades" },
  { key: "aral", label: "ARAL Progress" },
];

export function tabId(key: ProfileTabKey) {
  return `learner-profile-tab-${key}`;
}

export function panelId(key: ProfileTabKey) {
  return `learner-profile-panel-${key}`;
}

export function ProfileTabs({
  active,
  onChange,
  className,
}: {
  active: ProfileTabKey;
  onChange: (key: ProfileTabKey) => void;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const move = (delta: number) => {
    const index = PROFILE_TABS.findIndex((t) => t.key === active);
    const next =
      (index + delta + PROFILE_TABS.length) % PROFILE_TABS.length;
    const key = PROFILE_TABS[next].key;
    onChange(key);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${tabId(key)}`)
      ?.focus();
  };

  const jump = (key: ProfileTabKey) => {
    onChange(key);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${tabId(key)}`)
      ?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        jump(PROFILE_TABS[0].key);
        break;
      case "End":
        event.preventDefault();
        jump(PROFILE_TABS[PROFILE_TABS.length - 1].key);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Student profile sections"
      onKeyDown={handleKeyDown}
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-border px-2 sm:px-4",
        className
      )}
    >
      {PROFILE_TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            id={tabId(tab.key)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(tab.key)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
