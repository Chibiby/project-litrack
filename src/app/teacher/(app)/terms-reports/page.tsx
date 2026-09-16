import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/dashboard";
import { TermsReportHero } from "@/components/terms/terms-report-hero";
import { TermsReportBody } from "@/components/terms/terms-report-body";
import { TermsReportBodySkeleton } from "@/components/terms/terms-report-skeleton";
import { getTeacherShellContext } from "@/lib/dashboard/aggregates";
import { getActiveSchoolYear } from "@/lib/cache/school-year";
import { getAdvisoryPlacements } from "@/lib/teachers/advisory";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import { DECLARED_FLOATING_CARD } from "@/lib/teachers/floating-copy";
import {
  TERM_SHEET_NO_ADVISORY_CARD,
  TERM_SHEET_VOLUNTEER_CARD,
} from "@/lib/terms/gate-copy";
import { parseLearnerListParams, parseLearnerPageSize } from "@/lib/learners/pagination";
import { resolveSheetTerms, shortGradeLabel, type SheetScope } from "@/lib/terms/sheet-data";
import type { SheetUrlState } from "@/lib/terms/sheet-view";
import { splitByKinderGradeType } from "@/lib/terms/kinder-checklist-view";
import { isKinderGradeType } from "@/lib/terms/kinder-competencies";
import { KINDER_TERMS_REPORTS_PATH, kinderChecklistHref } from "@/components/terms/kinder-route";
import { CalendarX } from "lucide-react";

export const dynamic = "force-dynamic";

const BASE_PATH = "/teacher/terms-reports";

/**
 * The v2 End of Terms sheet — every advisory a teacher holds, on one page.
 *
 * Opens on All Advisories. `?advisory=` narrows to one of their sections and
 * `?section=` to a section inside the current scope; the two only ever narrow,
 * and only to sections the teacher advises, so no URL can reach another
 * adviser's class. Advisories in different grades render as separate groups,
 * each with its own grade's subjects.
 *
 * The refusal cards are the shared objects the old grade-scoped sheet used, so a
 * teacher who cannot encode reads the same explanation wherever they arrive.
 * A Super Admin advises nothing, so they go to the ARAL grade picker and open a
 * grade's sheet from there.
 */
interface PageProps {
  searchParams: Promise<{
    schoolId?: string;
    advisory?: string;
    section?: string;
    term?: string;
    q?: string;
    page?: string;
    perPage?: string;
  }>;
}

export default async function TeacherTermsReportsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  // `?schoolId=` rides along so the admin stays in the school they were viewing.
  if (isSuperAdmin) {
    redirect(
      sp.schoolId ? `/teacher/aral?schoolId=${encodeURIComponent(sp.schoolId)}` : "/teacher/aral"
    );
  }

  const schoolId = user.schoolId;
  if (!schoolId) redirect("/login");

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;
  const refuse = (card: React.ComponentProps<typeof EmptyState>) => (
    <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
      <EmptyState {...card} />
    </AppShell>
  );

  // React-`cache()`d on (schoolId, teacherId, isSuperAdmin) and already awaited by
  // the teacher layout for this request, so the designation costs no extra query.
  const [{ designation, advisoryMode }, placements, schoolYear] = await Promise.all([
    getTeacherShellContext({ schoolId, teacherId: user.id, isSuperAdmin }),
    getAdvisoryPlacements({ id: user.id, schoolId }),
    getActiveSchoolYear(schoolId),
  ]);

  const denial = advisoryRosterDenial({ isSuperAdmin, designation, advisoryMode });
  if (denial === "floating") return refuse(DECLARED_FLOATING_CARD);
  if (denial === "volunteer") return refuse(TERM_SHEET_VOLUNTEER_CARD);
  if (placements.length === 0) return refuse(TERM_SHEET_NO_ADVISORY_CARD);

  // Terms are windows over the active school year, so without one there is
  // nothing to key a row to. Explain it rather than render a grid that would
  // silently discard everything typed into it.
  if (!schoolYear) {
    return refuse({
      icon: CalendarX,
      title: "No active school year",
      description:
        "Term windows are derived from the active school year, so grades cannot be recorded without one. Ask your School Head to activate a school year, then come back.",
    });
  }

  const { activeTerm, activeWindow, terms, readOnly } = await resolveSheetTerms({
    schoolYear,
    requestedTerm: sp.term,
    viewer: { id: user.id, schoolId, isSuperAdmin },
  });

  const { kinder: kinderPlacements, numeric: numericPlacements } =
    splitByKinderGradeType(placements);

  // A Kinder-only teacher has no numeric sheet to render at all — send them
  // straight to the checklist (owner decision, overriding the spec's "render
  // the numeric page with a link" behavior for the mixed case).
  if (numericPlacements.length === 0 && kinderPlacements.length > 0) {
    redirect(kinderChecklistHref({ schoolId: sp.schoolId ?? null, advisory: sp.advisory ?? null }));
  }

  // Only the teacher's own sections count. An unknown id falls back to the
  // non-Kinder default — a mixed-advisory teacher never lands on a scope that
  // silently spans both report shapes; there is no "All advisories" default
  // that includes Kindergarten anymore. Picking a Kinder advisory from the
  // dropdown instead navigates away entirely (`TermsAdvisoryHeroControl`'s
  // `kinderBasePath`).
  const requestedAdvisory = placements.find((p) => p.sectionId === sp.advisory) ?? null;
  if (requestedAdvisory && isKinderGradeType(requestedAdvisory.gradeType)) {
    redirect(
      kinderChecklistHref({ schoolId: sp.schoolId ?? null, advisory: requestedAdvisory.sectionId })
    );
  }
  const advisory = requestedAdvisory;
  const inAdvisory = advisory ? [advisory] : numericPlacements;
  const sectionPick = inAdvisory.find((p) => p.sectionId === sp.section) ?? null;
  const inScope = sectionPick ? [sectionPick] : inAdvisory;

  const labelOf = (p: (typeof placements)[number]) => `${p.gradeLabel} - ${p.sectionName}`;
  const scopes: SheetScope[] = inScope.map((p) => ({
    key: p.sectionId,
    gradeLevelId: p.gradeLevelId,
    sectionId: p.sectionId,
    label: labelOf(p),
    gradeShort: shortGradeLabel(p.gradeLabel),
    rosterWhere: {
      schoolId,
      gradeLevelId: p.gradeLevelId,
      sectionId: p.sectionId,
      deletedAt: null,
      archivedAt: null,
    },
  }));

  const pageSize = parseLearnerPageSize(sp.perPage);
  const list = parseLearnerListParams(sp, pageSize);
  const state: SheetUrlState = {
    advisory: advisory?.sectionId ?? null,
    section: sectionPick?.sectionId ?? "all",
    term: activeTerm,
    q: list.q,
    pageSize,
  };

  // One grade in scope names the title; several read "All Advisories".
  const scopeGrades = [...new Set(inScope.map((p) => p.gradeLabel))];
  const title = `End of Terms Reports — ${
    scopeGrades.length === 1 ? scopeGrades[0] : "All Advisories"
  }`;
  const advisories = placements.map((p) => ({ id: p.sectionId, label: labelOf(p) }));

  return (
    <AppShell title="End of Terms Reports" role={user.role} userName={userName} hideTitle>
      <TermsReportHero
        title={title}
        subtitle={`${activeWindow.label} (${activeWindow.rangeLabel}) · SY ${schoolYear.label}`}
        basePath={BASE_PATH}
        state={state}
        page={list.page}
        terms={terms}
        advisories={advisories}
        kinderSectionIds={kinderPlacements.map((p) => p.sectionId)}
        kinderBasePath={KINDER_TERMS_REPORTS_PATH}
      />

      <Suspense key={`${activeTerm}:${state.advisory}:${state.section}`} fallback={<TermsReportBodySkeleton />}>
        <TermsReportBody
          schoolId={schoolId}
          schoolYearId={schoolYear.id}
          scopes={scopes}
          state={state}
          page={list.page}
          basePath={BASE_PATH}
          sections={inAdvisory.map((p) => ({ id: p.sectionId, name: p.sectionName }))}
          termLabel={activeWindow.label}
          readOnly={readOnly}
          canSave
          exportScope={{ sectionIds: inScope.map((p) => p.sectionId) }}
        />
      </Suspense>
    </AppShell>
  );
}
