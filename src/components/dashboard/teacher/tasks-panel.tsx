import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  ChevronRight,
  ClipboardCheck,
  FileText,
  UserPlus,
  Zap,
} from "lucide-react";
import type { DashboardTask } from "@/lib/dashboard/teacher-overview";

/**
 * Upcoming tasks and quick actions (v2 mockup images 3 and 4).
 *
 * Task due dates are the program's own cadence (attendance weekly, reading
 * level monthly), computed from the calendar. LITRACK stores no deadline and
 * no lock, so no badge here claims a record is locked or overdue-by-policy;
 * a badge only ever counts real outstanding work or reports it complete.
 */

const BADGE: Record<DashboardTask["tone"], string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  primary: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  muted: "bg-muted text-muted-foreground",
};

export function UpcomingTasksPanel({
  tasks,
  viewAllHref,
}: {
  tasks: DashboardTask[];
  viewAllHref: string;
}) {
  return (
    <Surface as="section" className="flex flex-col rounded-2xl">
      <div className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
        >
          <ClipboardCheck className="size-5" />
        </span>
        <h2 className="flex-1 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
          Upcoming Tasks
        </h2>
        <PrefetchLink
          href={viewAllHref}
          prefetch
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-violet-300"
        >
          View all
          <ArrowRight aria-hidden className="size-4 xl:hidden" />
        </PrefetchLink>
      </div>

      <ul className="px-4 pb-2 pt-2 sm:px-5">
        {tasks.map((t) => (
          <li key={t.id} className="border-b border-border/60 last:border-0">
            <PrefetchLink
              href={t.href}
              prefetch
              className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-full border-2 border-muted-foreground/40"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug text-foreground">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{t.detail}</span>
              </span>
              {t.badge ? (
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    BADGE[t.tone]
                  )}
                >
                  {t.badge}
                </span>
              ) : null}
            </PrefetchLink>
          </li>
        ))}
      </ul>
    </Surface>
  );
}

export function QuickActionsPanel({
  attendanceHref,
  addLearnerHref,
  reportsHref,
}: {
  attendanceHref: string;
  addLearnerHref: string;
  reportsHref: string;
}) {
  // "Generate Report" and "View Reports" share a target: exports live on the
  // Reports page, and LITRACK has no separate generation flow.
  const actions = [
    {
      id: "attendance",
      label: "Take Attendance",
      icon: CalendarCheck,
      href: attendanceHref,
      tone: "bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-200",
    },
    {
      id: "add-learner",
      label: "Add Learner",
      icon: UserPlus,
      href: addLearnerHref,
      tone: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200",
    },
    {
      id: "reports",
      label: "View Reports",
      icon: BarChart3,
      href: reportsHref,
      tone: "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-200",
    },
    {
      id: "generate",
      label: "Generate Report",
      icon: FileText,
      href: reportsHref,
      tone: "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200",
    },
  ];

  return (
    <Surface as="section" className="rounded-2xl">
      <div className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
        >
          <Zap className="size-5" />
        </span>
        <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
          Quick Actions
        </h2>
      </div>

      <ul className="grid grid-cols-2 gap-2.5 px-4 pb-4 pt-3 sm:gap-3 sm:px-5 sm:pb-5">
        {actions.map((a) => (
          <li key={a.id}>
            <PrefetchLink
              href={a.href}
              prefetch
              className={cn(
                "flex h-full items-center gap-2.5 rounded-xl px-3 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3 sm:px-4",
                a.tone
              )}
            >
              <a.icon aria-hidden className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 leading-snug">{a.label}</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 xl:hidden" />
            </PrefetchLink>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
