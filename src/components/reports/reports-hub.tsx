"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  Download,
  FileText,
  Filter,
  HelpCircle,
  LayoutGrid,
  Lightbulb,
  Loader2,
  PencilRuler,
  Search,
  Settings,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { generateReport, deleteReport } from "@/lib/actions/reports";
import {
  QUICK_ACTIONS,
  REPORT_CARDS,
  REPORT_FORMAT_LABELS,
  REPORT_KIND_LABELS,
  type ReportFilters,
  type ReportFormat,
  type ReportKind,
} from "@/lib/reports/kinds";

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
};

/** Card icon and tint, in the order the design lays the cards out. */
const CARD_ICON: Record<ReportKind, typeof CalendarDays> = {
  ATTENDANCE: CalendarDays,
  READING_LEVEL: BookOpen,
  TERM_GRADES: ClipboardList,
  TEACHER_SUMMARY: UserRound,
  CLASS_ROSTER: Users,
  CUSTOM: FileText,
};

const CARD_TONE: Record<ReportKind, string> = {
  ATTENDANCE: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  READING_LEVEL:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  TERM_GRADES: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  TEACHER_SUMMARY:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  CLASS_ROSTER: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  CUSTOM: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

const TABS: { id: "ALL" | ReportKind; label: string; icon: typeof LayoutGrid }[] = [
  { id: "ALL", label: "All Reports", icon: LayoutGrid },
  { id: "ATTENDANCE", label: "Attendance", icon: CalendarDays },
  { id: "READING_LEVEL", label: "Reading Level", icon: BookOpen },
  { id: "TERM_GRADES", label: "End of Term (Grades)", icon: ClipboardList },
  { id: "TEACHER_SUMMARY", label: "Teacher Summary", icon: UserRound },
  { id: "CUSTOM", label: "Custom Report", icon: PencilRuler },
];

/** `""` is the Select's "All" sentinel; Radix cannot hold an empty item value. */
const ALL = "__all__";

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

function triggerDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not immediately: Safari cancels an in-flight
  // download if the object URL disappears in the same frame as the click.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsHub({
  schoolYears,
  grades,
  sections,
  recent,
  canDelete,
}: Props) {
  const [tab, setTab] = useState<"ALL" | ReportKind>("ALL");
  const [schoolYearId, setSchoolYearId] = useState(ALL);
  const [gradeLevelId, setGradeLevelId] = useState(ALL);
  const [sectionId, setSectionId] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState<ReportFormat>("EXCEL");
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState(recent);
  const [, startTransition] = useTransition();

  // A section belongs to one grade, so choosing a grade narrows the section
  // list rather than leaving an impossible pair selectable.
  const visibleSections = useMemo(
    () =>
      gradeLevelId === ALL
        ? sections
        : sections.filter((s) => s.gradeLevelId === gradeLevelId),
    [sections, gradeLevelId]
  );

  const filters: ReportFilters = {
    schoolYearId: schoolYearId === ALL ? null : schoolYearId,
    gradeLevelId: gradeLevelId === ALL ? null : gradeLevelId,
    sectionId: sectionId === ALL ? null : sectionId,
    from: from || null,
    to: to || null,
  };

  function reset() {
    setSchoolYearId(ALL);
    setGradeLevelId(ALL);
    setSectionId(ALL);
    setFrom("");
    setTo("");
    setFormat("EXCEL");
    toast("Filters reset");
  }

  // `key` identifies which control is spinning — a card, a quick chip, or one
  // history row — so only that button shows a spinner while the rest disable.
  function run(
    kind: ReportKind,
    override?: Partial<ReportFilters>,
    key: string = kind
  ) {
    if (busy) return;
    setBusy(key);
    startTransition(async () => {
      const res = await generateReport({
        kind,
        format,
        ...filters,
        ...override,
      });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (!res.data) return;
      triggerDownload(res.data.base64, res.data.filename);
      toast.success("Report generated");
      // The server revalidates the page, but this list is client state for the
      // life of the visit — prepend so the new row is visible immediately.
      setRows((prev) => [
        {
          id: res.data!.reportId,
          name: res.data!.filename,
          kind,
          format,
          scopeLabel: null,
          createdAt: new Date().toISOString(),
          createdByName: "You",
          filters: { ...filters, ...override },
        },
        ...prev,
      ]);
    });
  }

  function quick(action: (typeof QUICK_ACTIONS)[number]) {
    const today = new Date();
    let override: Partial<ReportFilters> = {};
    if (action.range === "this-week") {
      const monday = mondayOf(today);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      override = { from: localDateKey(monday), to: localDateKey(sunday) };
    } else if (action.range === "this-month") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      override = { from: localDateKey(first), to: localDateKey(last) };
    }
    run(action.kind, override, action.id);
  }

  function regenerate(row: RecentReportRow) {
    run(row.kind, row.filters, `row-${row.id}`);
  }

  function remove(row: RecentReportRow) {
    if (busy) return;
    setBusy(`del-${row.id}`);
    startTransition(async () => {
      const res = await deleteReport({ id: row.id });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Report removed");
    });
  }

  const visibleCards =
    tab === "ALL" ? REPORT_CARDS : REPORT_CARDS.filter((c) => c.kind === tab);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Reports Hub</h2>
          <p className="text-sm text-muted-foreground">
            Generate, view and download reports for your classes and subjects.
          </p>
        </div>
        <Button type="button" variant="outline" disabled title="Coming soon">
          <Settings className="h-4 w-4" aria-hidden />
          Report Settings
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto_auto] xl:items-end">
          <Field label="School Year">
            <Select value={schoolYearId} onValueChange={setSchoolYearId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All years</SelectItem>
                {schoolYears.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Grade Level">
            <Select
              value={gradeLevelId}
              onValueChange={(v) => {
                setGradeLevelId(v);
                // The chosen section may not belong to the new grade.
                setSectionId(ALL);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Grades</SelectItem>
                {grades.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Section / Advisory">
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Sections</SelectItem>
                {visibleSections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Date Range">
            <div className="flex h-10 items-center gap-1 rounded-lg border border-input bg-background px-2">
              <CalendarDays
                aria-hidden
                className="h-4 w-4 shrink-0 text-muted-foreground"
              />
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Date range start"
                className="w-full bg-transparent text-sm outline-none"
              />
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Date range end"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          </Field>

          <Field label="Report Format">
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as ReportFormat)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXCEL">Excel (.xlsx)</SelectItem>
                <SelectItem value="PDF">PDF (.pdf)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Button
            type="button"
            onClick={() => toast.success("Filters applied to the cards below")}
          >
            <Filter className="h-4 w-4" aria-hidden />
            Apply Filters
          </Button>
          <Button type="button" variant="outline" onClick={reset}>
            Reset
          </Button>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {visibleCards.map((card) => {
          const Icon = CARD_ICON[card.kind];
          const running = busy === card.kind;
          return (
            <div
              key={card.kind}
              className="flex flex-col rounded-xl border border-border bg-card p-4"
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
                  <p className="font-semibold leading-tight">{card.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {card.blurb}
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-1.5 text-xs">
                {card.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-1.5">
                    <span aria-hidden className="text-emerald-600">
                      ✓
                    </span>
                    <span className="text-muted-foreground">{b}</span>
                  </li>
                ))}
              </ul>

              <div className="flex-1" />

              {card.soon ? (
                <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  <PencilRuler className="h-3.5 w-3.5" aria-hidden />
                  Create Custom
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                    Soon
                  </span>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 w-full"
                  disabled={busy !== null}
                  onClick={() => run(card.kind)}
                >
                  {running ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4" aria-hidden />
                  )}
                  {running ? "Generating…" : "Generate Report"}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {/* Quick Generate */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-semibold">Quick Generate</p>
            <p className="text-xs text-muted-foreground">
              One-click reports for your most used data.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => quick(action)}
                >
                  {busy === action.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <CalendarDays className="h-4 w-4" aria-hidden />
                  )}
                  {action.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Recent Reports */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-semibold">Recent Reports</p>
            <p className="text-xs text-muted-foreground">
              Your recently generated reports
            </p>

            <div className="mt-3 overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Report Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Grade / Section</TableHead>
                    <TableHead>Date Generated</TableHead>
                    <TableHead>Generated By</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No reports generated yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {REPORT_KIND_LABELS[row.kind]}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.scopeLabel ?? "All Classes"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.createdByName}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              row.format === "PDF"
                                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            )}
                          >
                            {REPORT_FORMAT_LABELS[row.format]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {/* The file itself was never stored, so this
                                re-runs the report from its saved filters. */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={busy !== null}
                              onClick={() => regenerate(row)}
                              aria-label={`Re-generate ${row.name}`}
                              title="Re-generate and download"
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
                                aria-label={`Remove ${row.name}`}
                                title="Remove from history"
                              >
                                <Trash2
                                  className="h-4 w-4 text-red-600"
                                  aria-hidden
                                />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-violet-50/60 p-4 dark:bg-violet-950/20">
            <p className="flex items-center gap-2 font-semibold text-violet-700 dark:text-violet-300">
              <Lightbulb className="h-4 w-4" aria-hidden />
              Report Tips
            </p>
            <ul className="mt-3 space-y-3 text-xs text-muted-foreground">
              <li className="flex gap-2">
                <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Use filters to get accurate results for your report.
              </li>
              <li className="flex gap-2">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                You can export reports in Excel or PDF format.
              </li>
              <li className="flex gap-2">
                <ClipboardList
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
                Reports are saved to your recent reports list and can be
                re-generated at any time.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 font-semibold">
              <HelpCircle className="h-4 w-4" aria-hidden />
              Need Help?
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Learn how to generate and manage reports.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              disabled
              title="Coming soon"
            >
              View Guide
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
