"use client";

import { createRef, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { FacetSelect } from "@/components/ui/facet-select";
import { LearnerListFooter } from "@/components/learners/learner-list-footer";
import {
  AralTermGradesGridForm,
  SCORE_MAX,
  SCORE_MIN,
  type AralTermGradesGridFormHandle,
} from "@/components/forms/aral-term-grades-grid-form";
import { exportTermGrades, saveTermGrades } from "@/lib/actions/term-grades";
import { LEARNER_LIST_DEFAULT_PAGE_SIZE } from "@/lib/learners/pagination";
import type { TermGradesExportInput } from "@/lib/validators/term-grade.schema";
import type { SheetGroup } from "@/lib/terms/sheet-data";
import { sheetHref, type SheetUrlState } from "@/lib/terms/sheet-view";
import { ExportPurposeToggle, useExportPurpose } from "@/components/reports/export-purpose-toggle";

/** Debounce pause before a typed search reaches the URL (ms). */
const SEARCH_DEBOUNCE_MS = 500;

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

type Props = {
  basePath: string;
  state: SheetUrlState;
  /** Section facet options: the sections in the current advisory scope. */
  sections: { id: string; name: string }[];
  groups: SheetGroup[];
  completionPct: number;
  termLabel: string;
  /** Locked term or admin view: viewing and export survive, encoding stops. */
  readOnly: boolean;
  /** A Super Admin reads; only a teacher saves. */
  canSave: boolean;
  /** What Export covers: every section in scope, not just this page. */
  exportScope: Pick<TermGradesExportInput, "gradeLevelId" | "section" | "sectionIds">;
  page: number;
  totalPages: number;
  totalCount: number;
};

/**
 * The v2 End of Terms table panel: toolbar, grouped grid, footer.
 *
 * Every filter but Subject writes the URL and the page re-reads it. Subject is
 * view-only state — it hides columns, it does not change what is saved — so it
 * stays in the client and survives a save.
 */
export function TermsReportPanel({
  basePath,
  state,
  sections,
  groups,
  completionPct,
  termLabel,
  readOnly,
  canSave,
  exportScope,
  page,
  totalPages,
  totalCount,
}: Props) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [exportPending, startExport] = useTransition();
  const [savePending, setSavePending] = useState(false);
  const [purpose, setPurpose] = useExportPurpose();
  const [searchValue, setSearchValue] = useState(state.q);
  const [subjectName, setSubjectName] = useState("all");
  const [subjectStep, setSubjectStep] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gridRefs = useMemo(
    () => new Map(groups.map((g) => [g.key, createRef<AralTermGradesGridFormHandle>()])),
    [groups]
  );

  // Adjusted during render (React docs "adjusting state when a prop changes"
  // pattern) rather than an effect.
  const [prevQ, setPrevQ] = useState(state.q);
  if (state.q !== prevQ) {
    setPrevQ(state.q);
    setSearchValue(state.q);
  }
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const go = (next: SheetUrlState) =>
    startNav(() => router.push(sheetHref(basePath, next), { scroll: false }));

  function pushSearch(raw: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    // The page index is dropped: narrowing the roster invalidates it.
    go({ ...state, q: raw });
  }

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushSearch(value), SEARCH_DEBOUNCE_MS);
  }

  // Subjects are named per grade, so the filter matches by name across groups.
  const subjectNames = [...new Set(groups.flatMap((g) => g.subjects.map((s) => s.name)))];

  function handleExport() {
    startExport(async () => {
      const toastId = toast.loading("Preparing Excel…");
      const res = await exportTermGrades({
        ...exportScope,
        term: state.term,
        q: state.q.trim() || undefined,
        purpose,
      } satisfies TermGradesExportInput);
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

  /**
   * One save per section with changes, each naming its section, so the server's
   * advisory gate resolves exactly one placement per call. Stops at the first
   * refusal: the groups already saved stay saved and say so.
   */
  async function handleSave() {
    if (readOnly || savePending) return;
    const batches = groups.map((group) => ({
      group,
      ref: gridRefs.get(group.key)?.current ?? null,
      ...(gridRefs.get(group.key)?.current?.collect() ?? { entries: [], invalid: [] }),
    }));

    const invalid = batches.flatMap((b) => b.invalid);
    if (invalid.length > 0) {
      const names = invalid.slice(0, 3).join(", ");
      const rest = invalid.length > 3 ? ` and ${invalid.length - 3} more` : "";
      toast.error(
        `Grades must be whole numbers from ${SCORE_MIN} to ${SCORE_MAX}. Check ${names}${rest}.`
      );
      return;
    }

    const pending = batches.filter((b) => b.entries.length > 0);
    if (pending.length === 0) {
      toast("No changes to save");
      return;
    }

    setSavePending(true);
    const toastId = toast.loading("Saving term grades…");
    let saved = 0;
    let cleared = 0;
    try {
      for (const batch of pending) {
        const res = await saveTermGrades({
          gradeLevelId: batch.group.gradeLevelId,
          ...(batch.group.sectionId ? { sectionId: batch.group.sectionId } : {}),
          term: state.term,
          entries: batch.entries,
        });
        if (!res.ok) {
          toast.error(
            pending.length > 1 ? `${batch.group.label}: ${res.error}` : res.error,
            { id: toastId }
          );
          if (saved + cleared > 0) router.refresh();
          return;
        }
        batch.ref?.commit();
        saved += res.data?.saved ?? 0;
        cleared += res.data?.cleared ?? 0;
      }
      toast.success(
        cleared > 0
          ? `Saved ${saved} grade${saved === 1 ? "" : "s"} and cleared ${cleared}`
          : `Saved ${saved} grade${saved === 1 ? "" : "s"}`,
        { id: toastId }
      );
      router.refresh();
    } finally {
      setSavePending(false);
    }
  }

  const showSave = canSave && !readOnly && groups.some((g) => g.learners.length > 0);
  const termCaption = `${termLabel} - ${completionPct}%`;

  const searchBox = (
    <div className="relative min-w-0 flex-1 xl:w-72 xl:flex-none">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
        placeholder="Search learner by name..."
        className="h-11 rounded-xl pl-9 text-sm lg:h-10 xl:h-11"
        aria-label="Search learners by name"
      />
    </div>
  );

  // Rendered twice (the phone panel and the desktop toolbar, one hidden by
  // CSS), so each copy gets its own ids.
  const facets = (where: "phone" | "desktop") => (
    <>
      <FacetSelect
        id={`terms-section-${where}`}
        label="Section"
        value={state.section}
        onValueChange={(v) => go({ ...state, section: v })}
        className="xl:w-40"
      >
        <SelectItem value="all">All Sections</SelectItem>
        {sections.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </FacetSelect>
      <FacetSelect
        id={`terms-subject-${where}`}
        label="Subject"
        value={subjectName}
        onValueChange={(v) => {
          setSubjectName(v);
          setSubjectStep(0);
        }}
        className="xl:w-40"
      >
        <SelectItem value="all">All Subjects</SelectItem>
        {subjectNames.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </FacetSelect>
    </>
  );

  const exportPurposeToggle = (
    <ExportPurposeToggle value={purpose} onChange={setPurpose} hideLabel className="shrink-0" />
  );

  const exportButton = (
    <Button
      type="button"
      variant="outline"
      onClick={handleExport}
      loading={exportPending}
      loadingText="Preparing Excel…"
      className="h-11 shrink-0 rounded-xl px-3 lg:h-10 xl:h-11 xl:px-5"
      aria-label="Export to Excel"
    >
      <Download className="size-5" aria-hidden />
      <span className="hidden xl:inline">Export</span>
    </Button>
  );

  const saveButton = showSave ? (
    <Button
      type="button"
      onClick={handleSave}
      loading={savePending}
      loadingText="Saving…"
      className="h-11 shrink-0 rounded-xl bg-violet-600 px-4 text-white hover:bg-violet-700 lg:h-10 xl:h-11 xl:px-5 dark:bg-violet-500 dark:hover:bg-violet-400"
    >
      <Save className="size-5" aria-hidden />
      <span className="xl:hidden">Save</span>
      <span className="hidden xl:inline">Save Grades</span>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-3 xl:gap-4">
      {/* Phones and tablets, to the mockup: search and actions. The advisory
          dropdown lives in the page hero's top-right corner instead. */}
      <Surface className="flex flex-col gap-2 rounded-2xl p-2.5 xl:hidden">
        {/* Phones: search gets its own row, or the placeholder clips beside
            the export/save buttons; sm and up keep the single row. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {searchBox}
          <div className="flex items-center gap-2 sm:contents">
            {exportButton}
            {saveButton}
          </div>
        </div>
        <div className="hidden grid-cols-2 gap-2 md:grid">{facets("phone")}</div>
        {exportPurposeToggle}
      </Surface>

      <Surface className="overflow-hidden rounded-2xl">
        {/* Desktop: one toolbar row across the top of the table. */}
        <div className="hidden flex-wrap items-center gap-3 border-b border-border/60 p-3 xl:flex">
          {searchBox}
          {facets("desktop")}
          <div className="ml-auto flex items-center gap-3">
            {exportPurposeToggle}
            {exportButton}
            {saveButton}
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {state.q.trim() ? "No learners match this search." : "No learners in this advisory yet."}
          </p>
        ) : (
          groups.map((group) => (
            <AralTermGradesGridForm
              // Remount when the rows it was seeded with change: the term picks
              // the scores and the URL filters pick the learners. Subject ids
              // ride along so an archived column never keeps stale cells.
              key={`${state.term}:${group.key}:${group.indexOffset}:${group.learners
                .map((l) => l.id)
                .join(",")}:${group.subjects.map((s) => s.id).join(",")}`}
              ref={gridRefs.get(group.key)}
              subjects={group.subjects}
              learners={group.learners}
              initialGrades={group.initialGrades}
              gradeType={group.gradeType}
              indexOffset={group.indexOffset}
              disabled={readOnly || savePending}
              groupLabel={groups.length > 1 ? group.label : undefined}
              termCaption={termCaption}
              visibleSubjectIds={
                subjectName === "all"
                  ? null
                  : new Set(group.subjects.filter((s) => s.name === subjectName).map((s) => s.id))
              }
              subjectStep={subjectStep}
              onNextSubjects={() => setSubjectStep((n) => n + 1)}
            />
          ))
        )}

        <LearnerListFooter
          basePath={basePath}
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={state.pageSize}
          searchParams={{
            schoolId: state.schoolId,
            advisory: state.advisory ?? undefined,
            section: state.section !== "all" ? state.section : undefined,
            term: state.term,
            q: state.q.trim() || undefined,
            perPage:
              state.pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE
                ? String(state.pageSize)
                : undefined,
          }}
        />
      </Surface>
    </div>
  );
}
