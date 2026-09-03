"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AralDateNav } from "@/components/aral/date-nav";
import {
  AralFilterPopover,
  type AralGradeOption,
} from "@/components/aral/aral-filter-popover";
import {
  AralWeeklyAttendanceGridForm,
  BulkAttendanceActions,
  type AralWeeklyAttendanceGridFormHandle,
  type WeeklyAttendanceGridExisting,
  type WeeklyAttendanceGridLearner,
} from "@/components/forms/aral-weekly-attendance-grid-form";
import { fetchAralAttendanceForWeek } from "@/lib/actions/aral-grid";
import {
  formatLocalDateKey,
  parseLocalDateKey,
  schoolToday,
} from "@/lib/date-keys";
import {
  ATTENDANCE_EDIT_GRACE_DAYS,
  attendanceDeadline,
  formatLongDate,
  formatWeekRange,
} from "@/lib/week-range";
import { getMonday, cn } from "@/lib/utils";
import type { LearnerListSectionFilter } from "@/lib/learners/pagination";
import type { SectionOption } from "@/components/learners/learner-list-toolbar";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function normalizeWeekKey(value: string): string {
  return formatLocalDateKey(getMonday(parseLocalDateKey(value)));
}

/**
 * Whether a week has passed its editing deadline. Date arithmetic, not stored
 * state — nothing has to run to lock a week, and the server action applies the
 * same rule, so a stale tab cannot save into a closed week.
 *
 * One extra input: the unlock grants this teacher holds for weekly attendance.
 * `saveAralWeeklyAttendance` consults `findActiveUnlock` before refusing a
 * closed week, so the panel must see the same set or it would render a granted
 * week as read-only and the teacher could never start typing the save the
 * server would accept.
 */
function lockInfo(weekKey: string, unlockedWeeks: string[]) {
  const deadline = attendanceDeadline(parseLocalDateKey(weekKey));
  const pastDeadline = schoolToday() > deadline;
  const granted = pastDeadline && unlockedWeeks.includes(weekKey);
  return { deadline, granted, locked: pastDeadline && !granted };
}

type Props = {
  gradeId: string;
  grades: AralGradeOption[];
  basePath: string;
  initialWeekKey: string;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  showSection: boolean;
  schoolId?: string;
  learners: WeeklyAttendanceGridLearner[];
  initialExisting: WeeklyAttendanceGridExisting[];
  initialHolidayKeys: string[];
  readOnly?: boolean;
  /** Week keys (Mondays, `YYYY-MM-DD`) this teacher may still edit past the deadline. */
  unlockedWeeks?: string[];
};

export function AralWeeklyAttendancePanel({
  gradeId,
  grades,
  basePath,
  initialWeekKey,
  section,
  sections,
  showSection,
  schoolId,
  learners,
  initialExisting,
  initialHolidayKeys,
  readOnly,
  unlockedWeeks = [],
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  /** Week shown in the nav — updates immediately on click. */
  const [pickerWeek, setPickerWeek] = useState(initialWeekKey);
  /** Week whose records are currently in the grid. */
  const [loadedWeek, setLoadedWeek] = useState(initialWeekKey);
  const [existing, setExisting] = useState(initialExisting);
  const [holidayKeys, setHolidayKeys] = useState(initialHolidayKeys);
  const [loading, setLoading] = useState(false);
  const [savePending, setSavePending] = useState(false);
  /** Mirrored out of the grid so the toolbar's Bulk Actions can show a count. */
  const [selectedCount, setSelectedCount] = useState(0);
  const formRef = useRef<AralWeeklyAttendanceGridFormHandle>(null);
  const desiredWeekRef = useRef(initialWeekKey);
  const requestIdRef = useRef(0);

  // The banner follows the week the teacher asked for; the grid follows the week
  // whose rows have arrived. While a fetch is in flight those differ, and the
  // "Loading week…" overlay is what says so.
  const picked = lockInfo(pickerWeek, unlockedWeeks);
  const gridLocked = lockInfo(loadedWeek, unlockedWeeks).locked;
  const actionsLocked = Boolean(readOnly || loading || savePending);

  const sharedParams = {
    schoolId,
    section: section !== "all" ? section : undefined,
  };

  function loadWeek(nextWeek: string, syncUrl: boolean) {
    const normalized = normalizeWeekKey(nextWeek);
    if (normalized === desiredWeekRef.current) {
      if (syncUrl) {
        const qs = buildQuery({ ...sharedParams, week: normalized });
        startTransition(() => {
          router.replace(`${basePath}${qs}`, { scroll: false });
        });
      }
      return;
    }

    desiredWeekRef.current = normalized;
    setPickerWeek(normalized);
    setLoading(true);

    if (syncUrl) {
      const qs = buildQuery({ ...sharedParams, week: normalized });
      startTransition(() => {
        router.replace(`${basePath}${qs}`, { scroll: false });
      });
    }

    const requestId = ++requestIdRef.current;
    void (async () => {
      const res = await fetchAralAttendanceForWeek({
        gradeId,
        weekKey: normalized,
        section: section !== "all" ? section : undefined,
        schoolId,
      });
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) {
        toast.error(res.error);
        setLoading(false);
        return;
      }
      setExisting(res.data.records);
      setHolidayKeys(res.data.holidayKeys);
      setLoadedWeek(normalized);
      setLoading(false);
    })();
  }

  function navigateTo(nextWeek: string) {
    const normalized = normalizeWeekKey(nextWeek);
    if (normalized === desiredWeekRef.current) return;
    loadWeek(normalized, true);
  }

  // Browser back/forward: adopt the URL week and fetch that week's records.
  const urlWeekParam = searchParams.get("week");
  useEffect(() => {
    const urlWeek =
      urlWeekParam && DATE_KEY_RE.test(urlWeekParam)
        ? normalizeWeekKey(urlWeekParam)
        : initialWeekKey;
    if (urlWeek === desiredWeekRef.current) return;
    loadWeek(urlWeek, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL/week identity only
  }, [urlWeekParam, initialWeekKey]);

  const deadlineLabel = formatLongDate(picked.deadline);
  const canSave = !readOnly && !picked.locked && learners.length > 0;

  return (
    <>
      <section
        className="mb-4 rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/30"
        aria-label="Week status"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <BannerItem
            icon={
              <span
                className={cn(
                  "mt-1 size-2.5 shrink-0 rounded-full",
                  picked.granted
                    ? "bg-violet-500"
                    : picked.locked
                      ? "bg-muted-foreground"
                      : "bg-emerald-500"
                )}
                aria-hidden
              />
            }
            title={
              picked.granted
                ? "Week reopened"
                : picked.locked
                  ? "Week locked"
                  : "Week open"
            }
            body={
              picked.granted
                ? "Past its deadline, but an unlock grant from your division admin reopened it. Editing is available while the grant is active."
                : picked.locked
                  ? "This week is past its deadline and can no longer be edited."
                  : "Attendance entry and editing are currently available."
            }
          />
          <BannerItem
            icon={<CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />}
            title="Editing deadline"
            body={`${deadlineLabel} (${ATTENDANCE_EDIT_GRACE_DAYS} days after the week ends)`}
          />
          <BannerItem
            icon={<Lock className="mt-0.5 size-4 shrink-0" aria-hidden />}
            title="Auto-lock"
            body="After the deadline, this week locks itself."
          />
        </div>
      </section>

      <Card>
        <AralDateNav
          value={pickerWeek}
          onNavigate={navigateTo}
          label="Jump to week"
          prevLabel="Previous Week"
          nextLabel="Next Week"
          rangeLabel={formatWeekRange(pickerWeek)}
          navLabels
          snapToMonday
          pending={loading}
          actions={
            <>
              <AralFilterPopover
                gradeId={gradeId}
                grades={grades}
                section={section}
                sections={sections}
                showSection={showSection}
                schoolId={schoolId}
                pathForGrade={(id) => `/teacher/aral/${id}/attendance`}
                preserveParams={{ week: pickerWeek }}
              />
              {canSave ? (
                <>
                  <BulkAttendanceActions
                    selectedCount={selectedCount}
                    disabled={actionsLocked}
                    onApply={(action) => formRef.current?.applyBulk(action)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => formRef.current?.save()}
                    disabled={actionsLocked}
                    loading={savePending}
                    loadingText="Saving…"
                  >
                    <Save className="h-4 w-4" aria-hidden />
                    Save Weekly Attendance
                  </Button>
                </>
              ) : null}
            </>
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
            <AralWeeklyAttendanceGridForm
              key={loadedWeek}
              ref={formRef}
              gradeId={gradeId}
              weekStartKey={loadedWeek}
              learners={learners}
              existing={existing}
              holidayKeys={holidayKeys}
              showSection={showSection}
              readOnly={readOnly || loading || gridLocked}
              onSavePendingChange={setSavePending}
              onSelectionChange={setSelectedCount}
            />
          </div>
          {loading && (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-10">
              <span className="rounded-md bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border">
                Loading week…
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <InfoCard
          icon={<CalendarDays className="size-4" aria-hidden />}
          title="About weekly attendance"
          body="Record each learner's attendance for every school day in the selected week, then save. You can keep editing until the deadline."
        />
        <InfoCard
          icon={<Lock className="size-4" aria-hidden />}
          title="Auto-lock after deadline"
          body={`After ${deadlineLabel}, this week's attendance locks and can no longer be edited.`}
        />
      </div>
    </>
  );
}

function BannerItem({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="text-violet-700 dark:text-violet-200">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-violet-900 dark:text-violet-100">
          {title}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-violet-900/75 dark:text-violet-100/75">
          {body}
        </p>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
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
      </div>
    </div>
  );
}
