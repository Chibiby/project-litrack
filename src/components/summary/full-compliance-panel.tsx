"use client";

import * as React from "react";
import {
  Award,
  CalendarClock,
  ChevronDown,
  Flame,
  Percent,
  School,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatCard, STAT_GRID } from "@/components/dashboard/teacher/stat-cards";
import { Button } from "@/components/ui/button";
import {
  CellText,
  NoValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExpandableStackedItem,
  ResponsiveTable,
  StackedList,
} from "@/components/ui/responsive-table";
import {
  FULL_COMPLIANCE_STATUSES,
  FULL_COMPLIANCE_STATUS_DEFINITIONS,
  FULL_COMPLIANCE_STATUS_LABELS,
  type FullComplianceStatus,
} from "@/lib/summary/shape/full-compliance";
import type {
  FullComplianceSchool,
  FullComplianceView,
} from "@/lib/summary/types";

/**
 * The Full Compliance page: the other side of Non-compliance. Everything it
 * draws comes from `FullComplianceView` (shaped server-side, already fenced to
 * the viewer's scope); this component only filters and expands.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2026-09-01` → `Sep 1, 2026`, with no time zone involved. */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Badge colours per status. Never violet: that is the ARAL accent. */
const STATUS_TONE: Record<FullComplianceStatus, string> = {
  CONSISTENT: "bg-success-100 text-success-strong dark:bg-success-950/60",
  FULL: "bg-success-50 text-success-strong dark:bg-success-950/40",
  NEW: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200",
  AT_RISK: "bg-warning-100 text-warning-strong dark:bg-warning-950/40",
  NON_COMPLIANT: "bg-destructive/10 text-destructive",
  NOT_EVALUATED: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: FullComplianceStatus }) {
  return (
    <span
      title={FULL_COMPLIANCE_STATUS_DEFINITIONS[status]}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        STATUS_TONE[status],
      )}
    >
      {FULL_COMPLIANCE_STATUS_LABELS[status]}
    </span>
  );
}

const dayWord = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function Panel({
  title,
  icon: Icon,
  iconClassName,
  description,
  children,
  className,
}: {
  title: string;
  icon: LucideIcon;
  iconClassName: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "min-w-0 rounded-lg border border-border/80 bg-card text-card-foreground shadow-card",
        className,
      )}
    >
      <div className="flex items-start gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
        <span
          aria-hidden
          className={cn(
            "icon-glass flex size-10 shrink-0 items-center justify-center rounded-md",
            iconClassName,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="font-semibold text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SchoolLine({
  school,
  right,
  sub,
}: {
  school: FullComplianceSchool;
  right: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <span
          title={school.name}
          className="block truncate font-medium text-foreground"
        >
          {school.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {school.district}
          {sub ? <> · {sub}</> : null}
        </span>
      </div>
      <div className="shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-foreground">
        {right}
      </div>
    </li>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">
      {children}
    </p>
  );
}

function DistrictRanking({
  ranking,
}: {
  ranking: FullComplianceView["ranking"];
}) {
  return (
    <Panel
      title="District ranking"
      icon={TrendingUp}
      iconClassName="text-blue-700 dark:text-blue-200"
      description="Share of each district's active schools that are compliant today."
    >
      <ol className="grid grid-cols-1 gap-x-8 gap-y-3 px-4 py-4 sm:px-5 lg:grid-cols-2">
        {ranking.map((r, i) => (
          <li key={r.district} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span
                className="min-w-0 truncate font-medium text-foreground"
                title={r.district}
              >
                <span className="mr-2 tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                {r.district}
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{r.pct}%</span>{" "}
                · {r.compliant} of {r.total}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`${r.district}: ${r.compliant} of ${r.total} schools compliant`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={r.pct}
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  r.pct >= 80
                    ? "bg-success-500"
                    : r.pct >= 50
                      ? "bg-blue-500"
                      : "bg-warning-500",
                )}
                style={{ width: `${r.pct}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

type HistoryEntry = FullComplianceSchool["history"][number];

function historyText(e: HistoryEntry): string {
  if (e.to === "COMPLIANT") return "Became compliant";
  if (e.to === "NOT_EVALUATED")
    return "Not evaluated (no learners or no active school year)";
  return e.from === "COMPLIANT" ? "Lost compliance" : "Flagged non-compliant";
}

function HistoryList({
  school,
  trackingSince,
}: {
  school: FullComplianceSchool;
  trackingSince: string | null;
}) {
  if (school.history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No status change in the last 90 days
        {trackingSince ? ` (tracked since ${formatDayKey(trackingSince)})` : ""}
        .
      </p>
    );
  }
  return (
    <ol className="space-y-2 border-l border-border/80 pl-4">
      {school.history.map((e, i) => (
        <li key={`${e.dateKey}-${i}`} className="relative text-sm">
          <span
            aria-hidden
            className={cn(
              "absolute -left-[1.3rem] top-1.5 size-2 rounded-full",
              e.to === "COMPLIANT"
                ? "bg-success-500"
                : e.to === "NON_COMPLIANT"
                  ? "bg-destructive"
                  : "bg-muted-foreground",
            )}
          />
          <span className="font-medium tabular-nums text-foreground">
            {formatDayKey(e.dateKey)}
          </span>
          <span className="text-muted-foreground"> · {historyText(e)}</span>
          {e.flags.length > 0 ? (
            <span className="block text-xs text-muted-foreground">
              Flags: {e.flags.join(", ")}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const PAGE = 50;

function Directory({ view }: { view: FullComplianceView }) {
  const [status, setStatus] = React.useState<FullComplianceStatus | "ALL">(
    "ALL",
  );
  const [shown, setShown] = React.useState(PAGE);
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const baseId = React.useId();

  const counts = React.useMemo(() => {
    const c = new Map<FullComplianceStatus, number>();
    for (const s of view.directory) c.set(s.status, (c.get(s.status) ?? 0) + 1);
    return c;
  }, [view.directory]);
  const rows =
    status === "ALL"
      ? view.directory
      : view.directory.filter((s) => s.status === status);
  const visible = rows.slice(0, shown);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chip = (
    value: FullComplianceStatus | "ALL",
    label: string,
    count: number,
  ) => (
    <button
      key={value}
      type="button"
      aria-pressed={status === value}
      onClick={() => {
        setStatus(value);
        setShown(PAGE);
      }}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8",
        status === value
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/80 bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );

  const flagsCell = (s: FullComplianceSchool) =>
    s.flags.length > 0 ? s.flags.length : 0;
  const streakText = (s: FullComplianceSchool) =>
    s.streak === null ? null : dayWord(s.streak);

  return (
    <Panel
      title="School compliance directory"
      icon={School}
      iconClassName="text-blue-700 dark:text-blue-200"
      description="Every active school in scope. Open a row for its last 90 days of status changes."
    >
      <div
        role="group"
        aria-label="Filter by status"
        className="flex flex-wrap gap-2 border-b border-border/60 px-4 py-3 sm:px-5"
      >
        {chip("ALL", "All", view.directory.length)}
        {FULL_COMPLIANCE_STATUSES.map((s) =>
          chip(s, FULL_COMPLIANCE_STATUS_LABELS[s], counts.get(s) ?? 0),
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyLine>No school has this status.</EmptyLine>
      ) : (
        <ResponsiveTable
          table={
            <Table aria-label="School compliance directory">
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead numeric>Flags</TableHead>
                  <TableHead numeric>Streak</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">History</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((s) => {
                  const isOpen = open.has(s.schoolId);
                  const panelId = `${baseId}-h-${s.schoolId}`;
                  const streak = streakText(s);
                  return (
                    <React.Fragment key={s.schoolId}>
                      <TableRow>
                        <TableCell className="max-w-[18rem]">
                          <CellText title={s.name}>{s.name}</CellText>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {s.schoolIdCode}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[10rem]">
                          <CellText>{s.district}</CellText>
                        </TableCell>
                        <TableCell
                          numeric
                          title={s.flags.join(", ") || undefined}
                        >
                          {flagsCell(s)}
                        </TableCell>
                        <TableCell numeric>
                          {streak ?? <NoValue label="No streak" />}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={s.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            aria-label={`${isOpen ? "Hide" : "Show"} history for ${s.name}`}
                            onClick={() => toggle(s.schoolId)}
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronDown
                              aria-hidden
                              className={cn(
                                "size-4 transition-transform duration-base",
                                isOpen && "rotate-180",
                              )}
                            />
                          </button>
                        </TableCell>
                      </TableRow>
                      <TableRow
                        id={panelId}
                        hidden={!isOpen}
                        className="[&[hidden]]:hidden hover:bg-transparent"
                      >
                        <TableCell
                          colSpan={6}
                          className="bg-muted/30 px-6 py-4"
                        >
                          {s.flags.length > 0 ? (
                            <p className="mb-3 text-sm text-foreground">
                              <span className="font-medium">Open flags:</span>{" "}
                              {s.flags.join(", ")}
                            </p>
                          ) : null}
                          <HistoryList
                            school={s}
                            trackingSince={view.trackingSince}
                          />
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          }
          stacked={
            <StackedList aria-label="School compliance directory (list)">
              {visible.map((s) => (
                <ExpandableStackedItem
                  key={s.schoolId}
                  label={s.name}
                  summary={
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span
                          title={s.name}
                          className="min-w-0 truncate font-medium text-foreground"
                        >
                          {s.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-foreground">
                          {streakText(s) ?? <NoValue label="No streak" />}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <StatusBadge status={s.status} />
                        <span>{s.district}</span>
                        {s.flags.length > 0 ? (
                          <span className="tabular-nums">
                            {s.flags.length}{" "}
                            {s.flags.length === 1 ? "flag" : "flags"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  }
                >
                  {s.flags.length > 0 ? (
                    <p className="mb-3 text-sm text-foreground">
                      <span className="font-medium">Open flags:</span>{" "}
                      {s.flags.join(", ")}
                    </p>
                  ) : null}
                  <HistoryList school={s} trackingSince={view.trackingSince} />
                </ExpandableStackedItem>
              ))}
            </StackedList>
          }
        />
      )}

      {rows.length > shown ? (
        <div className="flex justify-center border-t border-border/60 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShown((n) => n + PAGE)}
          >
            Show {Math.min(PAGE, rows.length - shown)} more of{" "}
            {rows.length - shown}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

export function FullCompliancePanel({ view }: { view: FullComplianceView }) {
  const { cards } = view;
  return (
    <div className="min-w-0 space-y-4">
      <div className={STAT_GRID}>
        <StatCard
          title="Active schools"
          value={cards.total}
          hint="In this scope"
          icon={School}
          tone="primary"
          denseOnPhone
        />
        <StatCard
          title="Fully compliant schools"
          value={cards.compliant}
          hint="No flags today"
          icon={ShieldCheck}
          tone="emerald"
          denseOnPhone
        />
        <StatCard
          title="Consistently compliant"
          value={cards.consistent}
          hint="No flags for 30+ days"
          icon={Award}
          tone="amber"
          denseOnPhone
        />
        <StatCard
          title="Overall compliance rate"
          value={`${cards.ratePct}%`}
          hint={`${cards.compliant} of ${cards.total} ${cards.total === 1 ? "school" : "schools"}`}
          icon={Percent}
          tone="emerald"
          progress={cards.ratePct}
          progressLabel={`${cards.compliant} of ${cards.total} ${cards.total === 1 ? "school" : "schools"} compliant`}
          denseOnPhone
        />
      </div>

      {view.ranking.length > 1 ? (
        <DistrictRanking ranking={view.ranking} />
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Recently achieved compliance"
          icon={TrendingUp}
          iconClassName="text-success-strong"
          description="Schools that became compliant in the last 7 days."
        >
          {view.recent.length === 0 ? (
            <EmptyLine>
              No school became compliant in the last 7 days.
            </EmptyLine>
          ) : (
            <ul className="divide-y divide-border/60">
              {view.recent.map((r) => (
                <SchoolLine
                  key={r.school.schoolId}
                  school={r.school}
                  right={formatDayKey(r.dateKey)}
                />
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Lost compliance"
          icon={TrendingDown}
          iconClassName="text-destructive"
          description="Schools that were compliant and gained a flag in the last 7 days."
        >
          {view.lost.length === 0 ? (
            <EmptyLine>No school lost compliance in the last 7 days.</EmptyLine>
          ) : (
            <ul className="divide-y divide-border/60">
              {view.lost.map((r) => (
                <SchoolLine
                  key={r.school.schoolId}
                  school={r.school}
                  right={formatDayKey(r.dateKey)}
                  sub={r.flags.length > 0 ? r.flags.join(", ") : undefined}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Longest streaks"
          icon={Flame}
          iconClassName="text-warning-strong"
          description="Top 10 schools by days compliant in a row."
        >
          {view.leaderboard.length === 0 ? (
            <EmptyLine>
              No streaks yet. They start with the first daily check.
            </EmptyLine>
          ) : (
            <ol className="divide-y divide-border/60">
              {view.leaderboard.map((s, i) => (
                <SchoolLine
                  key={s.schoolId}
                  school={s}
                  sub={`#${i + 1}`}
                  right={dayWord(s.streak ?? 0)}
                />
              ))}
            </ol>
          )}
        </Panel>
        <Panel
          title="Recognition"
          icon={Award}
          iconClassName="text-success-strong"
          description={FULL_COMPLIANCE_STATUS_DEFINITIONS.CONSISTENT}
        >
          {view.recognition.length === 0 ? (
            <EmptyLine>
              No school has kept compliance for 30 days yet.
            </EmptyLine>
          ) : (
            <ul className="divide-y divide-border/60">
              {view.recognition.map((s) => (
                <SchoolLine
                  key={s.schoolId}
                  school={s}
                  right={dayWord(s.streak ?? 0)}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Directory view={view} />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock aria-hidden className="size-3.5" />
        Updated every 5 minutes ·{" "}
        {view.trackingSince
          ? `Tracking since ${formatDayKey(view.trackingSince)}`
          : "Tracking starts with the first daily check (00:05)"}
      </p>
    </div>
  );
}
