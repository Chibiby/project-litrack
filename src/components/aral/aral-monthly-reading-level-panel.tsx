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
import { ReadingLevelStatCards } from "@/components/aral/reading-level-stat-cards";
import type { StatTone } from "@/components/dashboard/teacher/stat-cards";
import { ReadingLevelLegend } from "@/components/aral/reading-level-legend";
import { fetchAralReadingLevelForMonth } from "@/lib/actions/aral-grid";
import type { MonthlyAssessmentProgress } from "@/lib/aral/reading-level-progress";
import { computeReadingLevelStats } from "@/lib/aral/reading-level-stats";
import {
  ARAL_READING_LEVEL_SORTS,
  type AralReadingLevelSort,
} from "@/lib/aral/grid-sorts";
import { parseLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  currentMonthKey,
  daysLeftInMonth,
  formatMonthDeadlineLongDate,
  formatMonthEndLongDate,
  formatMonthKey,
  formatMonthLabel,
  MONTH_PICKER_HISTORY,
  monthPickerKeys,
  readingLevelDeadline,
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
 * The month's standing against the program's cadence, and — once a month is
 * past its grace window — whether the lock the banner describes is actually
 * enforced.
 *
 * `bulkRecordMonthlyReadingLevel` (`src/lib/actions/reading-level.ts`) is what
 * refuses a save past `readingLevelDeadline(monthKey)`. That refusal is gated by
 * the program-wide "unlock all" switch (`programUnlockAll`, defaulting ON) and
 * by any per-teacher or per-month unlock grant (`unlockedMonths`), read server
 * side by `readMonthlyReadingLevelLockState`. This function mirrors that same
 * precedence so the banner can never claim a rule the action does not enforce:
 * while locking is off or the program switch is on, nothing here is locked at
 * all, and the wording stays the original "due date" copy below.
 */
function monthStatus(
  monthKey: string,
  lockState: {
    lockingEnabled: boolean;
    programUnlockAll: boolean;
    unlockedMonths: string[];
  }
): {
  label: string;
  /**
   * Colour cue for the Monthly Status stat card, carrying what the old status
   * pill carried: Open is emerald, Past due amber, Upcoming primary, Reopened
   * violet, and Locked the neutral tone — a closed month is the absence of a
   * state, not another colour, which is how the weekly attendance panel marks
   * its locked week too. The label text, not the colour, is what tells a
   * reader it isn't "Open".
   */
  tone: StatTone;
  body: string;
  locked: boolean;
} {
  const enforced = lockState.lockingEnabled && !lockState.programUnlockAll;
  if (enforced && schoolToday() > readingLevelDeadline(monthKey)) {
    if (lockState.unlockedMonths.includes(monthKey)) {
      return {
        label: "Reopened",
        tone: "violet",
        body: "Editing had closed for this month, but your division admin reopened it.",
        locked: false,
      };
    }
    return {
      label: "Locked",
      tone: "neutral",
      body: `Editing closed on ${formatMonthDeadlineLongDate(monthKey)}.`,
      locked: true,
    };
  }

  const monthEnd = formatMonthEndLongDate(monthKey);
  const current = currentMonthKey();

  if (monthKey < current) {
    return {
      label: "Past due",
      tone: "amber",
      body: `Was due ${monthEnd}. Still open for editing.`,
      locked: false,
    };
  }
  if (monthKey > current) {
    return {
      label: "Upcoming",
      tone: "primary",
      body: `Due ${monthEnd}. You can assess ahead.`,
      locked: false,
    };
  }

  const daysLeft = daysLeftInMonth(monthKey);
  return {
    label: "Open",
    tone: "emerald",
    body:
      daysLeft <= 0
        ? `Due today, ${monthEnd}.`
        : `Due ${monthEnd} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`,
    locked: false,
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
  /** Parsed `?sort=`. The ordering is applied server-side (this grid is
   * paginated), so the panel only reflects it in the control and carries it
   * through every link it builds. */
  sort: AralReadingLevelSort;
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
  /**
   * Whether deadlines are being enforced at all (`submissions.locking`).
   * Defaults to true so a caller that has not been taught about the switch
   * keeps the pre-switch behaviour, mirroring the weekly attendance panel.
   */
  lockingEnabled?: boolean;
  /**
   * The program-wide "unlock all" switch for monthly reading levels.
   * Defaults to true — the same direction as the server's
   * `isMonthlyReadingLevelUnlockedForAll`, which reads a missing setting as
   * unlocked. Defaulting it false would let a caller that forgot to pass it
   * render a past month as "Locked" while the save action accepts it.
   */
  programUnlockAll?: boolean;
  /** Month keys (`YYYY-MM-01`) this teacher may still edit past the deadline. */
  unlockedMonths?: string[];
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
  sort,
  schoolId,
  learners,
  initialExisting,
  initialProgress,
  page,
  pageSize,
  totalPages,
  totalCount,
  readOnly,
  lockingEnabled = true,
  programUnlockAll = true,
  unlockedMonths = [],
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

  // Adopt a fresh server render whenever it describes the month already in the
  // grid — that is what moves the progress bar after a save (the grid calls
  // `router.refresh()`) and what keeps the record set current across pagination.
  // Guarded on the month so a render that is still catching up to a client-side
  // month step cannot write another month's numbers into this one's banner.
  // Adjusted during render (not an effect) per the React docs "adjusting state
  // when a prop changes" pattern, comparing against the previous committed props.
  const [prevSync, setPrevSync] = useState({
    monthKey: initialMonthKey,
    existing: initialExisting,
    progress: initialProgress,
  });
  if (
    prevSync.monthKey !== initialMonthKey ||
    prevSync.existing !== initialExisting ||
    prevSync.progress !== initialProgress
  ) {
    setPrevSync({
      monthKey: initialMonthKey,
      existing: initialExisting,
      progress: initialProgress,
    });
    if (initialMonthKey === loadedMonth) {
      setExisting(initialExisting);
      setProgress(initialProgress);
    }
  }

  const lockState = { lockingEnabled, programUnlockAll, unlockedMonths };
  // The banner follows the month the teacher asked for; the grid follows the
  // month whose rows have arrived — same split as the weekly attendance panel's
  // `picked`/`gridLocked`, so the "Loading month…" overlay is what explains any
  // gap between the two while a fetch is in flight.
  const status = monthStatus(pickerMonth, lockState);
  const gridLocked = monthStatus(loadedMonth, lockState).locked;
  const stats = computeReadingLevelStats({
    total: progress.total,
    completed: progress.completed,
    records: existing,
    gradeType,
  });

  const filterParams = {
    schoolId,
    section: section !== "all" ? section : undefined,
    gender: gender !== "all" ? gender : undefined,
    // Omitted at the default so the common URL stays clean; the page parses a
    // missing value back to the same default.
    sort: sort !== ARAL_READING_LEVEL_SORTS.fallback ? sort : undefined,
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

  function pushFilters(next: {
    section?: string;
    gender?: string;
    sort?: AralReadingLevelSort;
  }) {
    const nextSection = next.section ?? section;
    const nextGender = next.gender ?? gender;
    const nextSort = next.sort ?? sort;
    const qs = buildQuery({
      schoolId,
      month: pickerMonth,
      section: nextSection !== "all" ? nextSection : undefined,
      gender: nextGender !== "all" ? nextGender : undefined,
      sort:
        nextSort !== ARAL_READING_LEVEL_SORTS.fallback ? nextSort : undefined,
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
  const canSave = !readOnly && !status.locked && learners.length > 0;

  // Months the picker offers: this month back through the history, newest first,
  // plus whatever month is on screen if prev/next walked outside that span.
  const monthOptions = monthPickerKeys(
    currentMonthKey(),
    MONTH_PICKER_HISTORY,
    pickerMonth
  ).map((key) => ({ value: key, label: formatMonthLabel(key) }));

  return (
    <>
      <div className="mb-4">
        <ReadingLevelStatCards
          stats={stats}
          statusLabel={status.label}
          statusBody={status.body}
          statusTone={status.tone}
          monthLabel={formatMonthLabel(pickerMonth)}
        />
      </div>

      <Card>
        <AralDateNav
          value={pickerMonth}
          onNavigate={navigateTo}
          label="Select Month"
          prevLabel="Previous month"
          nextLabel="Next month"
          options={monthOptions}
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
              <FacetSelect
                id="aral-reading-level-sort"
                name="Sort by"
                ariaLabel="Sort by"
                value={sort}
                disabled={busy}
                onChange={(value) =>
                  pushFilters({ sort: value as AralReadingLevelSort })
                }
                // Section is only offered where this grade has sections —
                // with none, the option would sort nothing.
                options={ARAL_READING_LEVEL_SORTS.options
                  .filter((o) => showSection || o.value !== "section")
                  .map((o) => ({ value: o.value, label: o.label }))}
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
                className="h-11 bg-violet-600 text-white hover:bg-violet-700 sm:h-9 dark:bg-violet-500 dark:hover:bg-violet-400"
              >
                <Save className="h-4 w-4" aria-hidden />
                Save
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
              // Remount on month, page, page size, and sort: all four change
              // which learners and which saved values the rows are seeded
              // from. Sort belongs here because re-ordering a paginated grid
              // changes WHICH learners this page holds, and the row state is
              // seeded once at mount.
              key={`${loadedMonth}:${page}:${pageSize}:${sort}`}
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
              readOnly={readOnly || loading || gridLocked}
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

          <div className="px-4">
            <ReadingLevelLegend gradeType={gradeType} />
          </div>

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
          body="Set English, Filipino, word recognition, reading comprehension, and writing level for each learner, then save. A row saves whatever values you've filled in — you don't have to complete every field at once — and clearing a row that had saved data removes it when you save."
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
  id,
  ariaLabel,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
  id?: string;
  /** Overrides the default "Filter by …" label — the sort control is not a
   * filter, and reading it as one misdescribes what it does. */
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        className="h-11 w-auto min-w-[8rem] gap-1.5 sm:h-9"
        aria-label={ariaLabel ?? `Filter by ${name.toLowerCase()}`}
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
