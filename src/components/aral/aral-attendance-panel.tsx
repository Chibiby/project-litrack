"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AralDateNav } from "@/components/aral/date-nav";
import {
  AralFilterPopover,
  type AralGradeOption,
} from "@/components/aral/aral-filter-popover";
import {
  AralAttendanceGridForm,
  type AralAttendanceGridFormHandle,
  type AttendanceGridExisting,
  type AttendanceGridLearner,
} from "@/components/forms/aral-attendance-grid-form";
import { fetchAralAttendanceForDate } from "@/lib/actions/aral-grid";
import { setAttendanceDayHoliday } from "@/lib/actions/attendance";
import type { LearnerListSectionFilter } from "@/lib/learners/pagination";
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

type Props = {
  gradeId: string;
  grades: AralGradeOption[];
  basePath: string;
  initialDateKey: string;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  showSection: boolean;
  schoolId?: string;
  learners: AttendanceGridLearner[];
  initialExisting: AttendanceGridExisting[];
  initialIsHoliday?: boolean;
  readOnly?: boolean;
};

export function AralAttendancePanel({
  gradeId,
  grades,
  basePath,
  initialDateKey,
  section,
  sections,
  showSection,
  schoolId,
  learners,
  initialExisting,
  initialIsHoliday = false,
  readOnly,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  /** Date shown in the picker — updates immediately on click. */
  const [pickerDate, setPickerDate] = useState(initialDateKey);
  /** Date whose records are currently shown in the grid. */
  const [loadedDate, setLoadedDate] = useState(initialDateKey);
  const [existing, setExisting] = useState(initialExisting);
  const [isHoliday, setIsHoliday] = useState(initialIsHoliday);
  const [loading, setLoading] = useState(false);
  const [holidayPending, setHolidayPending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const formRef = useRef<AralAttendanceGridFormHandle>(null);
  const desiredDateRef = useRef(initialDateKey);
  const requestIdRef = useRef(0);

  const sharedParams = {
    schoolId,
    section: section !== "all" ? section : undefined,
  };

  const actionsLocked = Boolean(readOnly || loading || isHoliday || savePending);

  function loadDate(nextDate: string, syncUrl: boolean) {
    if (nextDate === desiredDateRef.current) {
      if (syncUrl) {
        const qs = buildQuery({ ...sharedParams, date: nextDate });
        startTransition(() => {
          router.replace(`${basePath}${qs}`, { scroll: false });
        });
      }
      return;
    }

    desiredDateRef.current = nextDate;
    setPickerDate(nextDate);
    setLoading(true);

    if (syncUrl) {
      const qs = buildQuery({ ...sharedParams, date: nextDate });
      startTransition(() => {
        router.replace(`${basePath}${qs}`, { scroll: false });
      });
    }

    const requestId = ++requestIdRef.current;
    void (async () => {
      const res = await fetchAralAttendanceForDate({
        gradeId,
        dateKey: nextDate,
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
      setIsHoliday(res.data.isHoliday);
      setLoadedDate(nextDate);
      setLoading(false);
    })();
  }

  function navigateTo(nextDate: string) {
    if (nextDate === desiredDateRef.current) return;
    loadDate(nextDate, true);
  }

  function handleHolidayChange(checked: boolean) {
    if (readOnly || holidayPending || loading) return;
    const dateForHoliday = loadedDate;
    const previous = isHoliday;
    setIsHoliday(checked);
    setHolidayPending(true);
    void (async () => {
      const res = await setAttendanceDayHoliday({
        gradeId,
        date: dateForHoliday,
        isHoliday: checked,
      });
      setHolidayPending(false);
      if (!res.ok) {
        if (desiredDateRef.current === dateForHoliday) {
          setIsHoliday(previous);
        }
        toast.error(res.error);
        return;
      }
      if (desiredDateRef.current === dateForHoliday) {
        toast.success(
          checked
            ? "Marked as holiday"
            : "Holiday cleared — attendance editable"
        );
      }
    })();
  }

  // Browser back/forward: adopt URL date and fetch that day's records.
  const urlDateParam = searchParams.get("date");
  useEffect(() => {
    const urlDate =
      urlDateParam && DATE_KEY_RE.test(urlDateParam)
        ? urlDateParam
        : initialDateKey;
    if (urlDate === desiredDateRef.current) return;
    loadDate(urlDate, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL/date identity only
  }, [urlDateParam, initialDateKey]);

  return (
    <>
      <AralDateNav
        value={pickerDate}
        onNavigate={navigateTo}
        label="Date"
        prevLabel="Previous day"
        nextLabel="Next day"
        pending={loading}
        filter={
          <AralFilterPopover
            gradeId={gradeId}
            grades={grades}
            section={section}
            sections={sections}
            showSection={showSection}
            schoolId={schoolId}
            pathForGrade={(id) => `/teacher/aral/${id}/attendance`}
            preserveParams={{ date: pickerDate }}
          />
        }
        holiday={{
          checked: isHoliday,
          onCheckedChange: handleHolidayChange,
          disabled: Boolean(readOnly) || holidayPending || loading,
        }}
        actions={
          !readOnly && learners.length > 0 ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => formRef.current?.clear()}
                disabled={actionsLocked}
              >
                <X className="h-4 w-4" aria-hidden />
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => formRef.current?.save()}
                disabled={actionsLocked}
              >
                {savePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-4 w-4" aria-hidden />
                )}
                {savePending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : undefined
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
          <AralAttendanceGridForm
            key={loadedDate}
            ref={formRef}
            dateKey={loadedDate}
            learners={learners}
            existing={existing}
            showSection={showSection}
            readOnly={readOnly || loading}
            isHoliday={isHoliday}
            onSavePendingChange={setSavePending}
          />
        </div>
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-10">
            <span className="rounded-md bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border">
              Loading day…
            </span>
          </div>
        )}
      </CardContent>
    </>
  );
}
