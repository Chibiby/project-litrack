"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { CalendarClock, CalendarX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import type { ClosedReason } from "@/lib/school-year/window";

/**
 * What the header needs from the school-year gate (`getGateForUser`): plain and
 * serializable, so a server layout can pass it — or a promise of it — through
 * the client shell.
 */
export type HeaderSchoolYearGate = {
  open: boolean;
  reason: ClosedReason | null;
  isLastMonth: boolean;
  label: string | null;
  /** `YYYY-MM-DD` */
  activeStart: string | null;
  activeEnd: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-06-01` → "Jun 2026" */
function monthOf(key: string | null): string {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : key;
}

/** The one line that changes with why the year is closed. */
export function closedReasonLine(gate: HeaderSchoolYearGate, isDivisionAdmin = false): string {
  switch (gate.reason) {
    case "NOT_STARTED":
      return `${gate.label ?? "The school year"} opens ${monthOf(gate.activeStart)}.`;
    case "ENDED":
      return `${gate.label ?? "The school year"} ended ${monthOf(gate.activeEnd)}.`;
    default:
      return isDivisionAdmin
        ? "Set an active duration on the School Years page to open it."
        : "Wait for the Division Admin to set an active school year.";
  }
}

const BADGE_CLASS =
  "h-8 shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-semibold";

function ClosedBadge({ gate, isDivisionAdmin }: { gate: HeaderSchoolYearGate; isDivisionAdmin: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={`${BADGE_CLASS} border-warning-300 bg-warning-50 text-warning-900 hover:bg-warning-100 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-200 dark:hover:bg-warning-500/20`}
          aria-label="No active school year. What does this mean?"
        >
          <CalendarX2 className="size-4 sm:size-3.5" aria-hidden />
          {/* Icon only on narrow phones, where the brand needs the room. */}
          <span className="hidden min-[420px]:inline sm:hidden">No school year</span>
          <span className="hidden sm:inline">No active school year</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarX2 className="size-5 text-warning-600 dark:text-warning-400" aria-hidden />
            No active school year
          </DialogTitle>
          <DialogDescription>
            There is no active school year right now. Learners, ARAL, MOSY, BOSY and
            every school record are read-only until the Division Admin sets an
            active school year.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium text-foreground">{closedReasonLine(gate, isDivisionAdmin)}</p>
        {isDivisionAdmin ? (
          <DialogFooter>
            <Button asChild>
              <Link href={ADMIN_ROUTES.schoolYears}>Set the active school year</Link>
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LastMonthBadge({ label }: { label: string | null }) {
  return (
    <span
      className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-xs font-medium text-muted-foreground sm:inline-flex"
      title="Promotion is open this month"
    >
      <CalendarClock className="size-3.5" aria-hidden />
      Last month of {label ?? "the school year"}
    </span>
  );
}

/** Renders nothing while the year is open, except a subtle note in its last month. */
export function SchoolYearBadgeView({
  gate,
  isDivisionAdmin = false,
}: {
  gate: HeaderSchoolYearGate | null;
  isDivisionAdmin?: boolean;
}) {
  if (!gate) return null;
  if (!gate.open) return <ClosedBadge gate={gate} isDivisionAdmin={isDivisionAdmin} />;
  if (gate.isLastMonth) return <LastMonthBadge label={gate.label} />;
  return null;
}

function Resolved({
  gate,
  isDivisionAdmin,
}: {
  gate: Promise<HeaderSchoolYearGate | null>;
  isDivisionAdmin: boolean;
}) {
  return <SchoolYearBadgeView gate={use(gate)} isDivisionAdmin={isDivisionAdmin} />;
}

/**
 * Header badge. Takes the gate resolved or as a promise the layout started
 * without awaiting (streamed behind its own Suspense, like notifications), so
 * the chrome never waits on it.
 */
export function SchoolYearBadge({
  gate,
  isDivisionAdmin = false,
}: {
  gate?: HeaderSchoolYearGate | null | Promise<HeaderSchoolYearGate | null>;
  isDivisionAdmin?: boolean;
}) {
  if (gate === undefined) return null;
  if (gate === null || !(gate instanceof Promise)) {
    return <SchoolYearBadgeView gate={gate} isDivisionAdmin={isDivisionAdmin} />;
  }
  return (
    <Suspense fallback={null}>
      <Resolved gate={gate} isDivisionAdmin={isDivisionAdmin} />
    </Suspense>
  );
}
