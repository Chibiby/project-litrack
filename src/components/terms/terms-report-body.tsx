import { BarChart3, FileCheck2, Lock, Trophy, Users } from "lucide-react";
import { StatCard, StatCardRow } from "@/components/dashboard/teacher/stat-cards";
import { TermsReportPanel } from "@/components/terms/terms-report-panel";
import { loadTermSheet, type SheetScope } from "@/lib/terms/sheet-data";
import { termGradingScale } from "@/lib/terms/grading-scale";
import type { SheetStats, SheetUrlState } from "@/lib/terms/sheet-view";
import type { TermGradesExportInput } from "@/lib/validators/term-grade.schema";

/**
 * Everything under the banner: the four figures, the auto-lock notice and the
 * table panel. One async component behind one Suspense boundary, because the
 * figures and the grid come out of the same score read and must agree.
 *
 * Every gate has already run in the page; nothing here can turn the sheet into
 * a refusal.
 */
export async function TermsReportBody({
  schoolId,
  schoolYearId,
  scopes,
  state,
  page,
  basePath,
  sections,
  termLabel,
  readOnly,
  canSave,
  exportScope,
}: {
  schoolId: string;
  schoolYearId: string;
  scopes: SheetScope[];
  state: SheetUrlState;
  page: number;
  basePath: string;
  sections: { id: string; name: string }[];
  termLabel: string;
  readOnly: boolean;
  canSave: boolean;
  exportScope: Pick<TermGradesExportInput, "gradeLevelId" | "section" | "sectionIds">;
}) {
  const data = await loadTermSheet({
    schoolId,
    schoolYearId,
    term: state.term,
    scopes,
    q: state.q,
    page,
    pageSize: state.pageSize,
    route: basePath,
  });
  const { stats } = data;
  const allLetterScale =
    scopes.length > 0 && scopes.every((s) => termGradingScale(s.gradeType) === "LETTER");

  return (
    <>
      <TermsReportSummary stats={stats} allLetterScale={allLetterScale} />

      <div className="mt-3 sm:mt-4">
        <TermsReportPanel
          basePath={basePath}
          state={state}
          sections={sections}
          groups={data.groups}
          completionPct={stats.completionPct}
          termLabel={termLabel}
          readOnly={readOnly}
          canSave={canSave}
          exportScope={exportScope}
          page={data.page}
          totalPages={data.pageCount}
          totalCount={data.totalCount}
        />
      </div>
    </>
  );
}

/** The four figures and the auto-lock notice. */
export function TermsReportSummary({
  stats,
  /** Every scope in view is Grade 1 (letter marks) — the class average has nothing to compute. */
  allLetterScale = false,
}: {
  stats: SheetStats;
  allLetterScale?: boolean;
}) {
  return (
    <>
      <div className="mt-3 sm:mt-4">
        <StatCardRow>
          <StatCard
            title="Total Learners"
            value={stats.total}
            hint="All enrolled learners"
            icon={Users}
            tone="violet"
            decor="people"
            inlineOnPhone
            denseOnPhone
          />
          <StatCard
            title="Grades Saved"
            value={`${stats.complete} / ${stats.total}`}
            hint="Learners with complete grades"
            icon={FileCheck2}
            tone="emerald"
            decor="wave"
            inlineOnPhone
            denseOnPhone
            progress={stats.completionPct}
          />
          <StatCard
            title="Completion Rate"
            value={`${stats.completionPct}%`}
            hint={`${stats.complete} of ${stats.total} learners`}
            icon={BarChart3}
            tone="primary"
            decor="wave"
            inlineOnPhone
            denseOnPhone
          />
          <StatCard
            title="Class Average"
            value={stats.classAverage === null ? "—" : stats.classAverage.toFixed(2)}
            hint={allLetterScale ? "Not computed for letter marks" : "Based on saved grades"}
            icon={Trophy}
            tone="amber"
            decor="wave"
            inlineOnPhone
            denseOnPhone
          />
        </StatCardRow>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900/60 dark:bg-violet-950/30 sm:mt-4 sm:p-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200 sm:size-10"
          aria-hidden
        >
          <Lock className="size-4 sm:size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-violet-800 dark:text-violet-100 sm:text-base">
            Auto-Lock After Term Ends
          </p>
          <p className="mt-0.5 text-xs leading-snug text-violet-900/75 dark:text-violet-100/75 sm:text-sm sm:leading-relaxed">
            This term will be automatically locked once the term duration has passed. Locked
            terms are read-only.
          </p>
        </div>
      </div>
    </>
  );
}
