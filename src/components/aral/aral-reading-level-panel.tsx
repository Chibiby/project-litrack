"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AralDateNav } from "@/components/aral/date-nav";
import {
  AralFilterPopover,
  type AralGradeOption,
} from "@/components/aral/aral-filter-popover";
import {
  AralReadingLevelGridForm,
  type AralReadingLevelGridFormHandle,
  type ReadingLevelGridExisting,
  type ReadingLevelGridLearner,
} from "@/components/forms/aral-reading-level-grid-form";
import { fetchAralReadingLevelForWeek } from "@/lib/actions/aral-grid";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
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

type Props = {
  gradeId: string;
  gradeType: string;
  grades: AralGradeOption[];
  basePath: string;
  initialWeekKey: string;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  showSection: boolean;
  schoolId?: string;
  learners: ReadingLevelGridLearner[];
  initialExisting: ReadingLevelGridExisting[];
  readOnly?: boolean;
};

export function AralReadingLevelPanel({
  gradeId,
  gradeType,
  grades,
  basePath,
  initialWeekKey,
  section,
  sections,
  showSection,
  schoolId,
  learners,
  initialExisting,
  readOnly,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  /** Week shown in the picker — updates immediately on click. */
  const [pickerWeek, setPickerWeek] = useState(initialWeekKey);
  /** Week whose records are currently shown in the grid. */
  const [loadedWeek, setLoadedWeek] = useState(initialWeekKey);
  const [existing, setExisting] = useState(initialExisting);
  const [loading, setLoading] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const formRef = useRef<AralReadingLevelGridFormHandle>(null);
  const desiredWeekRef = useRef(initialWeekKey);
  const requestIdRef = useRef(0);

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
      const res = await fetchAralReadingLevelForWeek({
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
      setLoadedWeek(normalized);
      setLoading(false);
    })();
  }

  function navigateTo(nextWeek: string) {
    const normalized = normalizeWeekKey(nextWeek);
    if (normalized === desiredWeekRef.current) return;
    loadWeek(normalized, true);
  }

  // Browser back/forward: adopt URL week and fetch that week's records.
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

  return (
    <>
      <AralDateNav
        value={pickerWeek}
        onNavigate={navigateTo}
        label="Week of (Monday)"
        prevLabel="Previous week"
        nextLabel="Next week"
        snapToMonday
        pending={loading}
        filter={
          <AralFilterPopover
            gradeId={gradeId}
            grades={grades}
            section={section}
            sections={sections}
            showSection={showSection}
            schoolId={schoolId}
            pathForGrade={(id) => `/teacher/aral/${id}/reading-level`}
            preserveParams={{ week: pickerWeek }}
          />
        }
        actions={
          !readOnly && learners.length > 0 ? (
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
          <AralReadingLevelGridForm
            key={loadedWeek}
            ref={formRef}
            weekStartKey={loadedWeek}
            gradeType={gradeType}
            learners={learners}
            existing={existing}
            showSection={showSection}
            readOnly={readOnly || loading}
            onSavePendingChange={setSavePending}
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
    </>
  );
}
