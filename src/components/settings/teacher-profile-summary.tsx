import { BadgeCheck, Gauge, School, ShieldCheck, type LucideIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { profileCompletionMessage } from "@/lib/teachers/profile-completion";
import { cn } from "@/lib/utils";

function SummaryTile({
  label,
  icon: Icon,
  className,
  iconClassName,
  children,
}: {
  label: string;
  icon: LucideIcon;
  className: string;
  iconClassName: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 rounded-xl p-3 sm:p-4", className)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}
        >
          <Icon className="size-4" />
        </span>
        <h3 className="min-w-0 text-xs font-semibold text-muted-foreground sm:text-sm">{label}</h3>
      </div>
      {children}
    </div>
  );
}

function CompletionRing({ percent }: { percent: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label="Profile completion"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative size-14 shrink-0"
    >
      <svg viewBox="0 0 48 48" className="size-14 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="5" className="stroke-muted" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="stroke-primary"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums text-foreground">
        {clamped}%
      </span>
    </div>
  );
}

/** Settings → Profile "Quick Summary": role, account status, school, completion. */
export function TeacherProfileSummary({
  roleLabel,
  roleHint,
  isActive,
  schoolName,
  completionPercent,
}: {
  roleLabel: string;
  roleHint?: string;
  isActive: boolean;
  schoolName: string | null;
  completionPercent: number;
}) {
  return (
    <Surface as="section" aria-labelledby="teacher-quick-summary" className="rounded-2xl p-4 sm:p-5">
      <h2 id="teacher-quick-summary" className="text-base font-semibold text-foreground">
        Quick Summary
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryTile
          label="Teacher Role"
          icon={BadgeCheck}
          className="bg-primary/5"
          iconClassName="bg-primary/10 text-primary"
        >
          <p className="break-words text-sm font-bold text-foreground sm:text-base">{roleLabel}</p>
          {roleHint ? <p className="text-xs text-muted-foreground">{roleHint}</p> : null}
        </SummaryTile>

        <SummaryTile
          label="Account Status"
          icon={ShieldCheck}
          className="bg-emerald-50 dark:bg-emerald-950/30"
          iconClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-foreground sm:text-base">
            <span
              aria-hidden
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                isActive ? "bg-emerald-500" : "bg-muted-foreground"
              )}
            />
            {isActive ? "Active" : "Inactive"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isActive ? "All systems go!" : "Ask your School Head to reactivate it."}
          </p>
        </SummaryTile>

        <SummaryTile
          label="School"
          icon={School}
          className="bg-amber-50 dark:bg-amber-950/30"
          iconClassName="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
        >
          <p className="break-words text-sm font-bold text-foreground sm:text-base">
            {schoolName ?? "—"}
          </p>
        </SummaryTile>

        <SummaryTile
          label="Profile Completion"
          icon={Gauge}
          className="bg-muted/50"
          iconClassName="bg-primary/10 text-primary"
        >
          <div className="flex flex-wrap items-center gap-3">
            <CompletionRing percent={completionPercent} />
            <p className="min-w-0 text-xs text-muted-foreground sm:text-sm">
              {profileCompletionMessage(completionPercent)}
            </p>
          </div>
        </SummaryTile>
      </div>
    </Surface>
  );
}
