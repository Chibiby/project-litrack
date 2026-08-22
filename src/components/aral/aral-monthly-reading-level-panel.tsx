"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, BookOpen, ClipboardList, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AralDateNav } from "@/components/aral/date-nav";
import {
  AralFilterPopover,
  type AralGradeOption,
} from "@/components/aral/aral-filter-popover";
import {
  AralMonthlyReadingLevelGridForm,
  type AralMonthlyReadingLevelGridFormHandle,
  type MonthlyReadingLevelGridExisting,
  type MonthlyReadingLevelGridLearner,
} from "@/components/forms/aral-monthly-reading-level-grid-form";
import { LearnerListFooter } from "@/components/learners/learner-list-footer";
import { fetchAralReadingLevelForMonth } from "@/lib/actions/aral-grid";
import type { MonthlyAssessmentProgress } from "@/lib/aral/reading-level-progress";
import { parseLocalDateKey } from "@/lib/date-keys";
import {
  currentMonthKey,
  daysLeftInMonth,
  formatMonthEndLongDate,
  formatMonthKey,
  formatMonthLabel,
} from "@/lib/month-range";
import {
  LEARNER_LIST_DEFAULT_PAGE_SIZE,
  type LearnerGenderFilter,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import type { SectionOption } from "@/components/learners/learner-list-toolbar";
import { cn } from "@/lib/utils";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/** Any date in a month addresses that month by its 1st. */
function normalizeMonthKey(value: string): string {
  return formatMonthKey(parseLocalDateKey(value));
}

/**
 * The month's standing against the program's cadence.
 *
 * Read the wording carefully before changing it: nothing in the schema stores a
 * submitted or locked state for reading levels, and no server rule refuses a save
 * into a past month. So this describes a *due date*, matching the "Complete
 * Monthly Reading Level" task on the teacher dashboard — it never claims the
 * month is closed, because saying so would tell a teacher a rule the system does
 * not actually enforce.
 */
function monthStatus(monthKey: string): {
  label: string;
  pill: string;
  body: string;
} {
  const monthEnd = formatMonthEndLongDate(monthKey);
  const current = currentMonthKey();

  if (monthKey < current) {
    return {
      label: "Past due",
      pill: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950 dark:text-amber-200",
      body: `Was due ${monthEnd}. Still open for editing.`,
    };
  }
  if (monthKey > current) {
    return {
      label: "Upcoming",
      pill: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950 dark:text-sky-200",
      body: `Due ${monthEnd}. You can assess ahead.`,
    };
  }

  const daysLeft = daysLeftInMonth(monthKey);
  return {
    label: "Open",
    pill: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950 dark:text-emerald-200",
    body:
      daysLeft <= 0
        ? `Due today, ${monthEnd}.`
        : `Due ${monthEnd} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`,
  };
}

type Props = {
  gradeId: string;
  gradeType: string;
  grades: AralGradeOption[];
  basePath: string;
  initialMonthKey: string;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  showSection: boolean;
  gender: LearnerGenderFilter;
  schoolId?: string;
  /** The current page of learners. Row numbering continues from `indexOffset`. */
  learners: MonthlyReadingLevelGridLearner[];
  /** Records for every learner the filter matches, not just this page. */
  initialExisting: MonthlyReadingLevelGridExisting[];
  /** Grade-wide, filter-wide saved progress for `initialMonthKey`. */
  initialProgress: MonthlyAssessmentProgress;
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  readOnly?: boolean;
};

export function AralMonthlyReadingLevelPanel({
  gradeId,
  gradeType,
  grades,
  basePath,
  initialMonthKey,
  section,
  sections,
  showSection,
  gender,
  schoolId,
  learners,
  initialExisting,
  initialProgress,
  page,
  pageSize,
  totalPages,
  totalCount,
  readOnly,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  /** Month shown in the nav and the banner — updates immediately on click. */
  const [pickerMonth, setPickerMonth] = useState(initialMonthKey);
  /** Month whose records are currently in the grid. */
  const [loadedMonth, setLoadedMonth] = useState(initialMonthKey);
  const [existing, setExisting] = useState(initialExisting);
  const [progress, setProgress] = useState(initialProgress);
  const [loading, setLoading] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const formRef = useRef<AralMonthlyReadingLevelGridFormHandle>(null);
  const desiredMonthRef = useRef(initialMonthKey);
  const requestIdRef = useRef(0);

  const status = monthStatus(pickerMonth);
  const pending = progress.total - progress.completed;
  const percent =
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  const filterParams = {
    schoolId,
    section: section !== "all" ? section : undefined,
    gender: gender !== "all" ? gender : undefined,
    perPage:
      pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE ? String(pageSize) : undefined,
  };

  function loadMonth(nextMonth: string, syncUrl: boolean) {
    const normalized = normalizeMonthKey(nextMonth);

    if (syncUrl) {
      // Month is a whole-grade concern, so the page index survives it — but the
      // URL has to move or a shared link and the footer's page links would still
      // point at the month the teacher stepped away from.
      const qs = buildQuery({
        ...filterParams,
        month: normalized,
        page: page > 1 ? String(page) : undefined,
      });
      startTransition(() => {
        router.replace(`${basePath}${qs}`, { scroll: false });
      });
    }
    if (normalized === desiredMonthRef.current) return;

    desiredMonthRef.current = normalized;
    setPickerMonth(normalized);
    setLoading(true);

    const requestId = ++requestIdRef.current;
    void (async () => {
      const res = await fetchAralReadingLevelForMonth({
        gradeId,
        monthKey: normalized,
        section: section !== "all" ? section : undefined,
        gender: gender !== "all" ? gender : undefined,
        schoolId,
      });
      // A slower earlier request must not overwrite a faster later one.
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) {
        toast.error(res.error);
        setLoading(false);
        return;
      }
      setExisting(res.data.records);
      setProgress(res.data.progress);
      setLoadedMonth(normalized);
      setLoading(false);
    })();
  }

  function navigateTo(nextMonth: string) {
    const normalized = normalizeMonthKey(nextMonth);
    if (normalized === desiredMonthRef.current) return;
    loadMonth(normalized, true);
  }

  // Browser back/forward: adopt the URL month and fetch that month's records.
  const urlMonthParam = searchParams.get("month");
  useEffect(() => {
    const urlMonth =
      urlMonthParam && DATE_KEY_RE.test(urlMonthParam)
        ? normalizeMonthKey(urlMonthParam)
        : initialMonthKey;
    if (urlMonth === desiredMonthRef.current) return;
    loadMonth(urlMonth, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL/month identity only
  }, [urlMonthParam, initialMonthKey]);

  // Adopt a fresh server render whenever it describes the month already in the
  // grid — that is what moves the progress bar after a save (the grid calls
  // `router.refresh()`) and what keeps the record set current across pagination.
  // Guarded on the month so a render that is still catching up to a client-side
  // month step cannot write another month's numbers into this one's banner.
  useEffect(() => {
    if (initialMonthKey !== loadedMonth) return;
    setExisting(initialExisting);
    setProgress(initialProgress);
  }, [initialMonthKey, loadedMonth, initialExisting, initialProgress]);

  function pushFilters(next: { section?: string; gender?: string }) {
    const nextSection = next.section ?? section;
    const nextGender = next.gender ?? gender;
    const qs = buildQuery({
      schoolId,
      month: pickerMonth,
      section: nextSection !== "all" ? nextSection : undefined,
      gender: nextGender !== "all" ? nextGender : undefined,
      perPage:
        pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE ? String(pageSize) : undefined,
      // `page` is dropped on purpose: narrowing the roster invalidates the index,
      // and page 4 of 4 becoming empty reads as a bug.
    });
    startTransition(() => {
      router.push(`${basePath}${qs}`, { scroll: false });
    });
  }

  const busy = loading || savePending;
  const canSave = !readOnly && learners.length > 0;

  return (
    <>
      <section
        className="mb-4 rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/30"
        aria-label="Monthly assessment status"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Monthly status</Eyebrow>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                  status.pill
                )}
              >
                {status.label}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-violet-900/75 dark:text-violet-100/75">
              {status.body}
            </p>
          </div>

          <div className="min-w-0">
            <Eyebrow>Progress</Eyebrow>
            <p className="mt-1.5 text-sm font-semibold text-violet-900 dark:text-violet-100">
              <span className="tabular-nums">{progress.completed}</span> /{" "}
              <span className="tabular-nums">{progress.total}</span> learners
              assessed
              <span className="ml-2 font-normal text-violet-900/70 tabular-nums dark:text-violet-100/70">
                {percent}%
              </span>
            </p>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${progress.completed} of ${progress.total} learners assessed in ${formatMonthLabel(pickerMonth)}`}
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-violet-200/80 dark:bg-violet-900/70"
            >
              <div
                className="h-full rounded-full bg-violet-600 transition-[width] duration-500 dark:bg-violet-400"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-1">
            <StatTile
              value={progress.completed}
              label="Completed"
              tone="text-emerald-700 dark:text-emerald-300"
            />
            <StatTile
              value={pending}
              label="Pending"
              tone="text-amber-700 dark:text-amber-300"
            />
            <StatTile
              value={progress.total}
              label="Learners"
              tone="text-violet-800 dark:text-violet-200"
            />
          </div>
        </div>
      </section>

      <Card>
        <AralDateNav
          value={pickerMonth}
          onNavigate={navigateTo}
          label="Jump to month"
          prevLabel="Previous month"
          nextLabel="Next month"
          rangeLabel={formatMonthLabel(pickerMonth)}
          snapToMonth
          pending={loading}
          filter={
            <>
              <AralFilterPopover
                gradeId={gradeId}
                grades={grades}
                section={section}
                sections={sections}
                // Section has its own control in this bar, per the comp — leaving
                // it in the popover too would give it two sources of truth.
                showSection={false}
                schoolId={schoolId}
                pathForGrade={(id) => `/teacher/aral/${id}/reading-level`}
                // Section is grade-scoped so the popover drops it on a grade
                // change; gender is not, so it has to be carried across.
                preserveParams={{
                  month: pickerMonth,
                  gender: gender !== "all" ? gender : undefined,
                }}
              />
              {showSection && (
                <FacetSelect
                  name="Section"
                  value={section}
                  disabled={busy}
                  onChange={(value) => pushFilters({ section: value })}
                  options={[
                    { value: "all", label: "All" },
                    { value: "none", label: "No section" },
                    ...sections.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              )}
              <FacetSelect
                name="Gender"
                value={gender}
                disabled={busy}
                onChange={(value) => pushFilters({ gender: value })}
                options={[
                  { value: "all", label: "All" },
                  { value: "MALE", label: "Male" },
                  { value: "FEMALE", label: "Female" },
                ]}
              />
            </>
          }
          actions={
            canSave ? (
              <Button
                type="button"
                size="sm"
                onClick={() => formRef.current?.save()}
                disabled={busy}
                loading={savePending}
                loadingText="Saving…"
                className="bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
              >
                <Save className="h-4 w-4" aria-hidden />
                Save reading levels
              </Button>
            ) : null
          }
        />

        <CardContent className="relative p-0">
          <div
            className={cn(
              "transition-opacity duration-150",
              loading && "pointer-events-none opacity-60"
            )}
            aria-busy={loading}
          >
            <AralMonthlyReadingLevelGridForm
              // Remount on month, page, and page size: all three change which
              // learners and which saved values the rows are seeded from.
              key={`${loadedMonth}:${page}:${pageSize}`}
              ref={formRef}
              monthStartKey={loadedMonth}
              gradeType={gradeType}
              learners={learners}
              existing={existing}
              indexOffset={(page - 1) * pageSize}
              learnerHrefFor={(learnerId) =>
                `/teacher/aral/${gradeId}/learners/${learnerId}/reading-level${buildQuery(
                  { schoolId }
                )}`
              }
              readOnly={readOnly || loading}
              onSavePendingChange={setSavePending}
            />
          </div>
          {loading && (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-10">
              <span className="rounded-md bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border">
                Loading month…
              </span>
            </div>
          )}

          <LearnerListFooter
            basePath={basePath}
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            searchParams={{ ...filterParams, month: pickerMonth }}
          />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <InfoCard
          icon={<BookOpen className="size-4" aria-hidden />}
          title="About monthly reading levels"
          body="Set English, Filipino, word recognition and reading comprehension for each learner, then save. Writing level and remarks are optional, and a row saves only once all four required levels are set."
        />
        <InfoCard
          icon={<ClipboardList className="size-4" aria-hidden />}
          title="Where this goes"
          body={`${formatMonthLabel(pickerMonth)}'s levels feed each learner's reading history and the school's ARAL reports.`}
          footer={
            <Link
              href="/teacher/reports"
              className="inline-flex items-center gap-1 font-medium text-violet-800 underline-offset-4 hover:underline dark:text-violet-200"
            >
              View summary report
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          }
        />
      </div>
    </>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-700/80 dark:text-violet-300/80">
      {children}
    </span>
  );
}

function StatTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <div className="min-w-[5.25rem] flex-1 rounded-lg border border-violet-200/80 bg-background/70 px-3 py-2 dark:border-violet-900/60 dark:bg-violet-950/40">
      <p className={cn("text-xl font-semibold tabular-nums leading-tight", tone)}>
        {value}
      </p>
      <p className="text-xs text-violet-900/70 dark:text-violet-100/70">{label}</p>
    </div>
  );
}

/**
 * One roster facet as a labelled trigger — "Section  All" — because the comp puts
 * section and gender in the toolbar where a teacher can see the current value
 * without opening anything, which a popover cannot do.
 */
function FacetSelect({
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className="h-9 w-auto min-w-[8rem] gap-1.5"
        aria-label={`Filter by ${name.toLowerCase()}`}
      >
        <span className="text-muted-foreground">{name}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InfoCard({
  icon,
  title,
  body,
  footer,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  footer?: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/30">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200"
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-violet-900 dark:text-violet-100">
          {title}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-violet-900/75 dark:text-violet-100/75">
          {body}
        </p>
        {footer != null && <p className="mt-2 text-sm">{footer}</p>}
      </div>
    </div>
  );
}
