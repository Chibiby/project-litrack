"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Lock, Save, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AralFilterPopover } from "@/components/aral/aral-filter-popover";
import {
  AralTermGradesGridForm,
  type AralTermGradesGridFormHandle,
  type TermGradesGridExisting,
  type TermGradesGridLearner,
  type TermKey,
} from "@/components/forms/aral-term-grades-grid-form";
import { LearnerListFooter } from "@/components/learners/learner-list-footer";
import { exportTermGrades } from "@/lib/actions/term-grades";
import type { TermGradesExportInput } from "@/lib/validators/term-grade.schema";
import { LEARNER_LIST_DEFAULT_PAGE_SIZE } from "@/lib/learners/pagination";
import { cn } from "@/lib/utils";

/** Debounce pause before a typed search reaches the URL (ms). */
const SEARCH_DEBOUNCE_MS = 500;

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/** Same shape as the learner export: base64 in, synthetic anchor click out. */
function downloadBase64Xlsx(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type TermTabOption = {
  term: TermKey;
  label: string;
  rangeLabel: string;
  locked: boolean;
};

type Props = {
  gradeId: string;
  grades: { id: string; label: string }[];
  basePath: string;
  sections: { id: string; name: string }[];
  showSection: boolean;
  section: string;
  schoolId?: string;
  q: string;
  activeTerm: TermKey;
  terms: TermTabOption[];
  learners: TermGradesGridLearner[];
  initialGrades: TermGradesGridExisting[];
  readOnly: boolean;
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
};

export function AralTermGradesPanel({
  gradeId,
  grades,
  basePath,
  sections,
  showSection,
  section,
  schoolId,
  q,
  activeTerm,
  terms,
  learners,
  initialGrades,
  readOnly,
  page,
  totalPages,
  totalCount,
  pageSize,
}: Props) {
  const router = useRouter();
  const [, startNavTransition] = useTransition();
  const [exportPending, startExportTransition] = useTransition();
  const [savePending, setSavePending] = useState(false);
  const [searchValue, setSearchValue] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<AralTermGradesGridFormHandle>(null);

  useEffect(() => {
    setSearchValue(q);
  }, [q]);

  const clearDebounce = () => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  useEffect(() => () => clearDebounce(), []);

  const filterParams: Record<string, string | undefined> = {
    schoolId,
    section: section !== "all" ? section : undefined,
    q: q.trim() || undefined,
    perPage:
      pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE ? String(pageSize) : undefined,
  };

  function pushSearch(raw: string) {
    clearDebounce();
    const next = raw.trim();
    const qs = buildQuery({
      ...filterParams,
      q: next || undefined,
      term: activeTerm,
      // `page` is dropped on purpose: narrowing the roster invalidates the index,
      // and page 4 of 4 becoming empty reads as a bug.
    });
    startNavTransition(() => {
      router.push(`${basePath}${qs}`, { scroll: false });
    });
  }

  function handleSearchChange(value: string) {
    setSearchValue(value);
    clearDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      pushSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  function hrefForTerm(term: TermKey): string {
    // The term switches which scores are shown, not which learners, so the page
    // index survives it.
    return `${basePath}${buildQuery({
      ...filterParams,
      term,
      page: page > 1 ? String(page) : undefined,
    })}`;
  }

  function handleExport() {
    startExportTransition(async () => {
      const toastId = toast.loading("Preparing Excel…");
      const payload: TermGradesExportInput = {
        gradeLevelId: gradeId,
        term: activeTerm,
        section: section !== "all" ? section : undefined,
        q: q.trim() || undefined,
      };
      const res = await exportTermGrades(payload);
      if (!res.ok) {
        toast.error(res.error, { id: toastId });
        return;
      }
      if (!res.data) {
        toast.error("Export produced no file", { id: toastId });
        return;
      }
      downloadBase64Xlsx(res.data.base64, res.data.filename);
      toast.success("Excel downloaded", { id: toastId });
    });
  }

  const canSave = !readOnly && learners.length > 0;

  return (
    <>
      <section className="mb-4" aria-labelledby="term-grades-term-picker">
        <p
          id="term-grades-term-picker"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Select term
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {terms.map((option) => {
            const active = option.term === activeTerm;
            return (
              <Button
                key={option.term}
                asChild
                size="sm"
                variant={active ? "default" : "outline"}
                className={cn(
                  "h-auto flex-col items-start gap-0.5 px-3 py-2",
                  active &&
                    "bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Link href={hrefForTerm(option.term)}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {option.label}
                    {option.locked && <Lock aria-hidden />}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-normal",
                      active ? "text-white/80" : "text-muted-foreground"
                    )}
                  >
                    {option.rangeLabel}
                    {option.locked ? " · Locked" : ""}
                  </span>
                </Link>
              </Button>
            );
          })}
        </div>
      </section>

      <div className="mb-4">
        <InfoCard
          icon={<Lock className="size-4" aria-hidden />}
          title="Auto-Lock After Term Ends"
          body="This term will be automatically locked once the term duration has passed. Locked terms are read-only."
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 p-4">
          <AralFilterPopover
            gradeId={gradeId}
            grades={grades}
            section={section}
            sections={sections}
            showSection={showSection}
            schoolId={schoolId}
            pathForGrade={(id) => `/teacher/aral/${id}/terms-reports`}
            preserveParams={{
              term: activeTerm,
              q: q.trim() || undefined,
              perPage:
                pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE
                  ? String(pageSize)
                  : undefined,
            }}
          />

          <div className="relative w-full sm:w-auto sm:min-w-[16rem]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pushSearch(searchValue);
                }
              }}
              placeholder="Search learner…"
              className="h-9 pl-9"
              aria-label="Search learners by name"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleExport}
              loading={exportPending}
              loadingText="Preparing Excel…"
            >
              <Download className="h-4 w-4" aria-hidden />
              Export
            </Button>
            {canSave && (
              <Button
                type="button"
                size="sm"
                onClick={() => formRef.current?.save()}
                loading={savePending}
                loadingText="Saving…"
                className="bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
              >
                <Save className="h-4 w-4" aria-hidden />
                Save Grades
              </Button>
            )}
          </div>
        </div>

        <CardContent className="p-0">
          <AralTermGradesGridForm
            // Remount whenever the seeded rows change: the term picks the scores,
            // and section / search / page / page size pick the learners. The grid
            // holds both its snapshot and its edits in state, so a prop change
            // without a remount would leave a new roster reading old cells.
            key={`${activeTerm}:${section}:${q}:${page}:${pageSize}`}
            ref={formRef}
            gradeLevelId={gradeId}
            term={activeTerm}
            learners={learners}
            initialGrades={initialGrades}
            indexOffset={(page - 1) * pageSize}
            readOnly={readOnly}
            onSavePendingChange={setSavePending}
          />

          <LearnerListFooter
            basePath={basePath}
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            searchParams={{ ...filterParams, term: activeTerm }}
          />
        </CardContent>
      </Card>
    </>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
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
