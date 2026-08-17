"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The dashboard's closing notice strip.
 *
 * The approved design places two standing notes here. Their wording states the
 * program's recording cadence rather than describing an automatic record lock:
 * LITRACK has no lock, deadline, or submission state in its schema, and a
 * dashboard that announces one would be telling teachers a rule the system
 * does not enforce. Restore the lock wording only if locking is actually built.
 *
 * Dismissal is remembered per browser, not per account — there is no
 * preference store, and inventing a server round-trip for a banner would cost
 * more than the banner is worth.
 */

const STORAGE_KEY = "litrack.teacher.notice.dismissed.v1";

const NOTES = [
  {
    id: "cadence",
    icon: CalendarClock,
    title: "Recording cadence",
    body: "Attendance is marked weekly, Monday to Friday. Reading levels are assessed once each month.",
  },
  {
    id: "reminder",
    icon: Lightbulb,
    title: "Reminder",
    body: "Finish each month's assessments before it ends so your end-of-term reports cover the full period.",
  },
];

export function NoticeStrip() {
  // Starts hidden so a dismissed strip never flashes in before hydration.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(STORAGE_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <section className="relative rounded-xl border border-violet-200 bg-violet-50/70 px-5 py-4 dark:border-violet-900/60 dark:bg-violet-950/30">
      <div className="grid gap-4 pr-8 sm:grid-cols-2 sm:gap-6">
        {NOTES.map((n) => (
          <div key={n.id} className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200"
            >
              <n.icon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-100">
                {n.title}
              </h3>
              <p className="mt-0.5 text-sm leading-relaxed text-violet-900/75 dark:text-violet-100/75">
                {n.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => {
          setVisible(false);
          try {
            localStorage.setItem(STORAGE_KEY, "1");
          } catch {
            // A browser refusing storage still gets the dismissal this session.
          }
        }}
        aria-label="Dismiss these notes"
        className="absolute right-2 top-2 size-8 text-violet-700/70 hover:bg-violet-100 hover:text-violet-900 dark:text-violet-200/70 dark:hover:bg-violet-900/50 dark:hover:text-violet-50"
      >
        <X aria-hidden className="size-4" />
      </Button>
    </section>
  );
}
