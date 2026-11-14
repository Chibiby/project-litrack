"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  Download,
  FileText,
  History,
  Loader2,
  Lock,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatSchoolDateTime } from "@/lib/format-datetime";
import { generateReport, deleteReport } from "@/lib/actions/reports";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { triggerDownload } from "@/components/reports/trigger-download";
import {
  REPORT_CARDS,
  REPORT_FORMAT_LABELS,
  REPORT_KIND_LABELS,
  REPORT_PERIOD_LABELS,
  type ReportCard,
  type ReportFilters,
  type ReportFormat,
  type ReportKind,
  type ReportPeriodId,
} from "@/lib/reports/kinds";
import type { ReportLocks } from "@/lib/reports/availability";

export type ReportsHubOption = { id: string; label: string };
export type ReportsHubSection = ReportsHubOption & { gradeLevelId: string };

export type RecentReportRow = {
  id: string;
  name: string;
  kind: ReportKind;
  format: ReportFormat;
  scopeLabel: string | null;
  createdAt: string;
  createdByName: string;
  filters: ReportFilters;
};

type Props = {
  schoolYears: ReportsHubOption[];
  grades: ReportsHubOption[];
  sections: ReportsHubSection[];
  recent: RecentReportRow[];
  /** Whether the viewer may remove a history row (their own reports only). */
  canDelete: boolean;
  /** Kinds this account cannot run, keyed to the sentence shown on the card. */
  locks?: ReportLocks;
};

const CARD_ICON: Record<ReportKind, typeof CalendarDays> = {
  ATTENDANCE: CalendarDays,
  READING_LEVEL: BookOpen,
  TERM_GRADES: ClipboardList,
  TEACHER_SUMMARY: UserRound,
  CLASS_ROSTER: Users,
  MOSY: BookOpenCheck,
  CUSTOM: FileText,
};

// Violet is the ARAL accent (tailwind.config.ts): attendance and reading level
// are ARAL records, so only those two cards carry it.
const CARD_TONE: Record<ReportKind, string> = {
  ATTENDANCE: "bg-aral-100 text-aral-700 dark:bg-aral-950 dark:text-aral-300",
  READING_LEVEL: "bg-aral-100 text-aral-700 dark:bg-aral-950 dark:text-aral-300",
  TERM_GRADES: "bg-info-100 text-info-700 dark:bg-info-950 dark:text-info-300",
  TEACHER_SUMMARY:
    "bg-warning-100 text-warning-700 dark:bg-warning-950 dark:text-warning-300",
  CLASS_ROSTER: "bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-300",
  MOSY: "bg-aral-100 text-aral-700 dark:bg-aral-950 dark:text-aral-300",
  CUSTOM: "bg-muted text-muted-foreground",
};

/** `""` is the Select's "All" sentinel; Radix cannot hold an empty item value. */
const ALL = "__all__";

/** The format the viewer chose last, so the second export needs one click less. */
const FORMAT_KEY = "litrack.reports.format";

function storedFormat(): ReportFormat {
  try {
    return window.localStorage.getItem(FORMAT_KEY) === "PDF" ? "PDF" : "EXCEL";
  } catch {
    return "EXCEL";
  }
}

function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Monday of the given date's week, matching the attendance grid's anchor. */
function mondayOf(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + delta);
  return copy;
}

/** The date filters a period stands for, resolved against the local today. */
function periodRange(
  period: ReportPeriodId,
  custom: { from: string; to: string }
): Pick<ReportFilters, "from" | "to"> {
  const today = new Date();
  if (period === "this-week") {
    const monday = mondayOf(today);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { from: localDateKey(monday), to: localDateKey(sunday) };
  }
  if (period === "this-month") {
    return {
      from: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (period === "custom") return { from: custom.from || null, to: custom.to || null };
  // "school-year": no dates, so the report covers the school year to date.
  return { from: null, to: null };
}

/** `2026-09-02` -> `Sep 2, 2026`, parsed locally so it never shifts a day. */
function prettyDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The period a history row covered, in words. Blank when it had no dates. */
function periodText(filters: ReportFilters): string | null {
  if (filters.from && filters.to) return `${prettyDate(filters.from)} to ${prettyDate(filters.to)}`;
  if (filters.from) return `From ${prettyDate(filters.from)}`;
  if (filters.to) return `Until ${prettyDate(filters.to)}`;
  return null;
}

/** The classes a history row covered. The server stores "All Classes" for no filter. */
function classesText(row: { scopeLabel: string | null }): string {
  return !row.scopeLabel || row.scopeLabel === "All Classes" ? "All classes" : row.scopeLabel;
}

/** What a screen reader calls a history row: the report and when, not a file name. */
function rowName(row: RecentReportRow): string {
  return `${REPORT_KIND_LABELS[row.kind]}, ${formatSchoolDateTime(row.createdAt)}`;
}

function ReportFormatChip({ format }: { format: keyof typeof REPORT_FORMAT_LABELS }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        format === "PDF"
          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
          : "bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-300"
      )}
    >
      {REPORT_FORMAT_LABELS[format]}
    </span>
  );
}

export function ReportsHub({
  schoolYears,
  grades,
  sections,
  recent,
  canDelete,
  locks = {},
}: Props) {
  const [schoolYearId, setSchoolYearId] = useState(ALL);
  const [gradeLevelId, setGradeLevelId] = useState(ALL);
  const [sectionId, setSectionId] = useState(ALL);
  const [format, setFormatState] = useState<ReportFormat>(storedFormat);
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState(recent);
  const [, startTransition] = useTransition();

  function setFormat(next: ReportFormat) {
    setFormatState(next);
    try {
      window.localStorage.setItem(FORMAT_KEY, next);
    } catch {
      // Private mode: the choice simply lasts for this visit.
    }
  }

  // A section belongs to one grade, so choosing a grade narrows the section
  // list rather than leaving an impossible pair selectable.
  const visibleSections = useMemo(
    () =>
      gradeLevelId === ALL
        ? sections
        : sections.filter((s) => s.gradeLevelId === gradeLevelId),
    [sections, gradeLevelId]
  );

  // A filter with one possible answer is not a choice. A teacher with one
  // advisory section sees no Grade or Section control at all.
  const showYear = schoolYears.length > 1;
  const showGrade = grades.length > 1;
  const showSection = sections.length > 1;
  const hasClassFilters = showYear || showGrade || showSection;
  const narrowed = schoolYearId !== ALL || gradeLevelId !== ALL || sectionId !== ALL;

  const classFilters: ReportFilters = {
    schoolYearId: schoolYearId === ALL ? null : schoolYearId,
    gradeLevelId: gradeLevelId === ALL ? null : gradeLevelId,
    sectionId: sectionId === ALL ? null : sectionId,
  };

  // Two grades can each have a section "A", so with no grade chosen a section
  // is named with its grade.
  const gradeLabelById = new Map(grades.map((g) => [g.id, g.label]));
  const sectionLabel = (s: ReportsHubSection) => {
    const grade = gradeLabelById.get(s.gradeLevelId);
    return grade ? `${grade} · ${s.label}` : s.label;
  };
  const chosenSection = sections.find((s) => s.id === sectionId);

  // What the next export will cover, in words, next to the filters that set it.
  const coverage = [
    sectionId !== ALL
      ? chosenSection && sectionLabel(chosenSection)
      : gradeLevelId !== ALL
        ? grades.find((g) => g.id === gradeLevelId)?.label
        : "All your classes",
    schoolYearId !== ALL ? schoolYears.find((y) => y.id === schoolYearId)?.label : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function clearFilters() {
    setSchoolYearId(ALL);
    setGradeLevelId(ALL);
    setSectionId(ALL);
  }

  // `key` identifies which control is spinning (a card or one history row) so
  // only that button shows a spinner while the rest disable.
  function run(
    kind: ReportKind,
    filters: ReportFilters,
    runFormat: ReportFormat,
    key: string,
    onDone?: () => void
  ) {
    if (busy || locks[kind]) return;
    setBusy(key);
    startTransition(async () => {
      const res = await callAction(() =>
        generateReport({ kind, format: runFormat, ...filters, purpose: "PRINT" })
      );
      setBusy(null);
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      if (!res.data) return;
      triggerDownload(res.data.base64, res.data.filename);
      toast.success("Report downloaded");
      onDone?.();
      // The server revalidates the page, but this list is client state for the
      // life of the visit: prepend so the new row is visible immediately.
      setRows((prev) => [
        {
          id: res.data!.reportId,
          name: res.data!.filename,
          kind,
          format: runFormat,
          scopeLabel: narrowed ? coverage : null,
          createdAt: new Date().toISOString(),
          createdByName: "You",
          filters: { ...filters, purpose: "PRINT" },
        },
        ...prev,
      ]);
    });
  }

  function remove(row: RecentReportRow) {
    if (busy) return;
    setBusy(`del-${row.id}`);
    startTransition(async () => {
      const res = await callAction(() => deleteReport({ id: row.id }));
      setBusy(null);
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Removed from the list");
    });
  }

  const lastByKind = useMemo(() => {
    const map = new Map<ReportKind, RecentReportRow>();
    for (const row of rows) if (!map.has(row.kind)) map.set(row.kind, row);
    return map;
  }, [rows]);

  const reportActions = (row: RecentReportRow) => (
    <>
      {/* The file itself was never stored, so this re-runs the report from its
          saved choices, in the format it was first downloaded in. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={busy !== null || !!locks[row.kind]}
        aria-disabled={!!locks[row.kind]}
        onClick={() => run(row.kind, row.filters, row.format, `row-${row.id}`)}
        aria-label={`Download ${rowName(row)} again`}
        title={locks[row.kind] ?? "Download again"}
      >
        {busy === `row-${row.id}` ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
      </Button>
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy !== null}
          onClick={() => remove(row)}
          aria-label={`Remove ${rowName(row)} from the list`}
          title="Remove from the list"
        >
          <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      {/* No heading here: the shell's title block is the page's single <h1>. */}

      {/* Which classes. Shown only when there is a real choice to make. */}
      {hasClassFilters && (
        <section
          aria-label="Classes to include"
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            {showYear && (
              <Field label="School year" id="report-year">
                <Select value={schoolYearId} onValueChange={setSchoolYearId}>
                  <SelectTrigger id="report-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All school years</SelectItem>
                    {schoolYears.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {showGrade && (
              <Field label="Grade" id="report-grade">
                <Select
                  value={gradeLevelId}
                  onValueChange={(v) => {
                    setGradeLevelId(v);
                    // The chosen section may not belong to the new grade.
                    setSectionId(ALL);
                  }}
                >
                  <SelectTrigger id="report-grade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All grades</SelectItem>
                    {grades.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {showSection && (
              <Field label="Section" id="report-section">
                <Select value={sectionId} onValueChange={setSectionId}>
                  <SelectTrigger id="report-section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All sections</SelectItem>
                    {visibleSections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {sectionLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {narrowed && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                <X aria-hidden />
                Clear
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
            Every report below covers:{" "}
            <span className="font-medium text-foreground">{coverage}</span>
          </p>
        </section>
      )}

      {/* The reports. One Export control each, the same as Division Summary. */}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Reports">
        {REPORT_CARDS.map((card) => (
          <ReportCardItem
            key={card.kind}
            card={card}
            lockReason={locks[card.kind]}
            last={lastByKind.get(card.kind)}
            format={format}
            onFormat={setFormat}
            busy={busy}
            onExport={(dates, done) =>
              run(card.kind, { ...classFilters, ...dates }, format, card.kind, done)
            }
          />
        ))}
      </ul>

      {/* Recent downloads */}
      <section
        aria-labelledby="recent-downloads-title"
        className="rounded-lg border border-border bg-card p-4"
      >
        <h2 id="recent-downloads-title" className="font-semibold">
          Recent downloads
        </h2>
        <p className="text-xs text-muted-foreground">
          LITRACK keeps the list, not the files. Download again builds the report
          fresh, with the same choices and today&apos;s data.
        </p>

        {rows.length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
            <History className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No downloads yet. Reports you export will be listed here.
            </p>
          </div>
        ) : (
          <ResponsiveTable
            className="mt-3"
            breakpoint={900}
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Classes</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Downloaded</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {REPORT_KIND_LABELS[row.kind]}
                      </TableCell>
                      <TableCell className="max-w-56 text-muted-foreground">
                        <CellText>{classesText(row)}</CellText>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {periodText(row.filters) ?? "School year"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatSchoolDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <ReportFormatChip format={row.format} />
                      </TableCell>
                      <TableCell>
                        <RowActions>{reportActions(row)}</RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            stacked={
              <StackedList aria-label="Recent downloads">
                {rows.map((row) => (
                  <StackedRow
                    key={row.id}
                    className="px-0"
                    title={REPORT_KIND_LABELS[row.kind]}
                    state={<ReportFormatChip format={row.format} />}
                    meta={
                      <>
                        <span>{classesText(row)}</span>
                        <span className="tabular-nums">{formatSchoolDateTime(row.createdAt)}</span>
                      </>
                    }
                    details={[{ label: "Period", value: periodText(row.filters) ?? "School year" }]}
                    actions={reportActions(row)}
                  />
                ))}
              </StackedList>
            }
          />
        )}
      </section>
    </div>
  );
}

/**
 * One report: what it is, when it was last downloaded, and one Export control.
 * The control is Division Summary's (`SummaryExportMenu`): a popover holding
 * the choices this report really has, then Download. A report with no period
 * (grades, roster) shows no period control instead of a filter that does nothing.
 */
function ReportCardItem({
  card,
  lockReason,
  last,
  format,
  onFormat,
  busy,
  onExport,
}: {
  card: ReportCard;
  lockReason?: string;
  last?: RecentReportRow;
  format: ReportFormat;
  onFormat: (format: ReportFormat) => void;
  busy: string | null;
  onExport: (dates: Pick<ReportFilters, "from" | "to">, done: () => void) => void;
}) {
  const Icon = CARD_ICON[card.kind];
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<ReportPeriodId | null>(card.periods[0] ?? null);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const running = busy === card.kind;
  const id = `report-${card.kind.toLowerCase()}`;
  const customIncomplete = period === "custom" && !custom.from && !custom.to;

  return (
    <li
      aria-disabled={!!lockReason}
      className={cn(
        "flex flex-col rounded-lg border border-border bg-card p-4",
        lockReason && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            CARD_TONE[card.kind]
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight">{card.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{card.blurb}</p>
        </div>
      </div>

      <div className="flex-1" />

      {lockReason ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {lockReason}
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {last ? `Last downloaded ${formatSchoolDateTime(last.createdAt)}` : "Not downloaded yet"}
          </p>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                aria-label={`Export ${card.title}`}
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download aria-hidden />
                )}
                Export
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4 p-4">
              {period && (
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Period
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {card.periods.map((p) => (
                      <Button
                        key={p}
                        type="button"
                        size="sm"
                        variant={period === p ? "default" : "outline"}
                        aria-pressed={period === p}
                        onClick={() => setPeriod(p)}
                      >
                        {REPORT_PERIOD_LABELS[p]}
                      </Button>
                    ))}
                  </div>
                  {period === "custom" && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor={`${id}-from`} className="mb-1 block text-xs text-muted-foreground">
                          From
                        </Label>
                        <input
                          id={`${id}-from`}
                          type="date"
                          value={custom.from}
                          max={custom.to || undefined}
                          onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`${id}-to`} className="mb-1 block text-xs text-muted-foreground">
                          To
                        </Label>
                        <input
                          id={`${id}-to`}
                          type="date"
                          value={custom.to}
                          min={custom.from || undefined}
                          onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </fieldset>
              )}
              <div>
                <Label htmlFor={`${id}-format`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Format
                </Label>
                <Select value={format} onValueChange={(v) => onFormat(v as ReportFormat)}>
                  <SelectTrigger id={`${id}-format`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EXCEL">Excel (.xlsx)</SelectItem>
                    <SelectItem value="PDF">PDF (.pdf)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={customIncomplete}
                loading={running}
                loadingText="Preparing file…"
                onClick={() =>
                  onExport(period ? periodRange(period, custom) : {}, () => setOpen(false))
                }
              >
                <Download aria-hidden />
                Download
              </Button>
              {customIncomplete && (
                <p className="text-xs text-muted-foreground">Pick a start or an end date.</p>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}
    </li>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1 lg:max-w-64">
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
