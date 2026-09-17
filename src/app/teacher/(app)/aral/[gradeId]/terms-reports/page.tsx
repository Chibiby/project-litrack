import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/dashboard";
import { TermsReportHero } from "@/components/terms/terms-report-hero";
import { TermsReportBody } from "@/components/terms/terms-report-body";
import { TermsReportBodySkeleton } from "@/components/terms/terms-report-skeleton";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getGradeSections } from "@/lib/cache/grade-sections";
import { getActiveSchoolYear } from "@/lib/cache/school-year";
import { getAdvisoryPlacements } from "@/lib/teachers/advisory";
import { legacyTermSheetRedirect } from "@/lib/terms/advisory-href";
import {
  parseLearnerListParams,
  parseLearnerPageSize,
  sectionIdWhere,
} from "@/lib/learners/pagination";
import { resolveSheetTerms, shortGradeLabel } from "@/lib/terms/sheet-data";
import type { SheetUrlState } from "@/lib/terms/sheet-view";
import { CalendarX } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * The grade-scoped End of Terms URL.
 *
 * v2 moved the teacher's sheet to `/teacher/terms-reports`, which holds every
 * advisory on one page, so a teacher arriving here — a bookmark, an old link —
 * is redirected there with `?section=` carried over as `?advisory=`. The target
 * page runs every gate, so nothing is decided here that it would not re-decide.
 *
 * A Super Admin advises nothing and reads a whole grade, so they stay: this is
 * their read-only view of one grade's sheet, in the same v2 layout, with the
 * grade's real section facet. Viewing and export only.
 */
interface PageProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<{
    schoolId?: string;
    section?: string;
    term?: string;
    q?: string;
    page?: string;
    perPage?: string;
  }>;
}

export default async function AralGradeTermsReportsPage({ params, searchParams }: PageProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!isSuperAdmin) {
    // An empty list only means the target opens on All Advisories, where the
    // gates explain any refusal.
    const placements = user.schoolId
      ? await getAdvisoryPlacements({ id: user.id, schoolId: user.schoolId })
      : [];
    redirect(legacyTermSheetRedirect(placements, gradeId, sp));
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: { id: gradeId, deletedAt: null },
    select: { id: true, type: true, schoolId: true },
  });
  if (!grade) notFound();

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;
  const gradeLabel = GRADE_LEVEL_LABELS[grade.type];
  const isAdminView = !!sp.schoolId;

  const schoolYear = await getActiveSchoolYear(grade.schoolId);
  if (!schoolYear) {
    return (
      <AppShell
        title={`End of Terms Reports — ${gradeLabel}`}
        role={user.role}
        userName={userName}
        isSuperAdminView={isAdminView}
      >
        <EmptyState
          icon={CalendarX}
          title="No active school year"
          description="Term windows are derived from the active school year, so grades cannot be recorded without one. Ask your School Head to activate a school year, then come back."
        />
      </AppShell>
    );
  }

  const [{ activeTerm, activeWindow, terms, readOnly }, sections] = await Promise.all([
    resolveSheetTerms({
      schoolYear,
      requestedTerm: sp.term,
      viewer: { id: user.id, schoolId: user.schoolId, isSuperAdmin },
    }),
    getGradeSections({ schoolId: grade.schoolId, gradeLevelIds: [grade.id] }),
  ]);

  const pageSize = parseLearnerPageSize(sp.perPage);
  const list = parseLearnerListParams(sp, pageSize);
  const basePath = `/teacher/aral/${grade.id}/terms-reports`;
  const state: SheetUrlState = {
    schoolId: sp.schoolId,
    advisory: null,
    section: list.section,
    term: activeTerm,
    q: list.q,
    pageSize,
  };

  return (
    <AppShell
      title={`End of Terms Reports — ${gradeLabel}`}
      role={user.role}
      userName={userName}
      isSuperAdminView={isAdminView}
      hideTitle
    >
      <TermsReportHero
        title={`End of Terms Reports — ${gradeLabel}`}
        subtitle={`${activeWindow.label} (${activeWindow.rangeLabel}) · SY ${schoolYear.label}${
          isAdminView ? " (Admin View)" : ""
        }`}
        basePath={basePath}
        state={state}
        page={list.page}
        terms={terms}
        advisories={[]}
      />

      <Suspense key={`${activeTerm}:${list.section}`} fallback={<TermsReportBodySkeleton />}>
        <TermsReportBody
          schoolId={grade.schoolId}
          schoolYearId={schoolYear.id}
          scopes={[
            {
              key: grade.id,
              gradeLevelId: grade.id,
              gradeType: grade.type,
              sectionId: null,
              label: gradeLabel,
              gradeShort: shortGradeLabel(gradeLabel),
              rosterWhere: {
                schoolId: grade.schoolId,
                gradeLevelId: grade.id,
                deletedAt: null,
                archivedAt: null,
                ...sectionIdWhere(list.section),
              },
            },
          ]}
          state={state}
          page={list.page}
          basePath={basePath}
          sections={sections.map((s) => ({ id: s.id, name: s.name }))}
          termLabel={activeWindow.label}
          readOnly={readOnly}
          canSave={false}
          exportScope={{
            gradeLevelId: grade.id,
            section: list.section !== "all" ? list.section : undefined,
          }}
        />
      </Suspense>
    </AppShell>
  );
}
