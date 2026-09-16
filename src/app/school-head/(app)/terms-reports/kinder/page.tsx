import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import {
  resolveSchoolHeadView,
  type SchoolHeadView,
} from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/dashboard/empty-state";
import { KinderChecklistHero } from "@/components/terms/kinder-checklist-hero";
import { KinderChecklistPanel } from "@/components/terms/kinder-checklist-panel";
import { KinderChecklistSchoolHeadPicker } from "@/components/school-head/kinder-checklist-picker";
import { SchoolHeadKinderChecklistExport } from "@/components/school-head/kinder-checklist-export";
import { isKinderGradeType } from "@/lib/terms/kinder-competencies";
import {
  countTouchedCompetencies,
  mergeKinderChecklist,
} from "@/lib/terms/kinder-checklist-view";
import { loadKinderChecklist } from "@/lib/terms/kinder-sheet-data";
import { TermsReportBodySkeleton } from "@/components/terms/terms-report-skeleton";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string; section?: string; learner?: string }>;
}

/**
 * School Head read-only view of the Kindergarten End-of-Term competency
 * checklist — see docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md
 * section 10. A School Head is not an adviser, so scope is the whole school's
 * Kindergarten sections (via `resolveSchoolHeadView`'s `schoolId`), not an
 * advisory placement. Renders the exact same `KinderChecklistPanel` the
 * teacher page uses, `readOnly`, with Save omitted — export/print reuse the
 * teacher page's own pieces (`KinderChecklistExportControls`,
 * `PrintableKinderChecklist`) via `SchoolHeadKinderChecklistExport`.
 */
async function SchoolHeadKinderChecklistBody({
  view,
  sectionParam,
  learnerParam,
}: {
  view: SchoolHeadView;
  sectionParam?: string;
  learnerParam?: string;
}) {
  const { schoolId } = view;

  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId, deletedAt: null },
    select: { id: true, type: true },
  });
  const kinderGradeIds = grades.filter((g) => isKinderGradeType(g.type)).map((g) => g.id);

  if (kinderGradeIds.length === 0) {
    return (
      <EmptyState
        title="No Kindergarten grade"
        description="This school has no Kindergarten grade level yet."
      />
    );
  }

  const sections = await prisma.section.findMany({
    where: { schoolId, gradeLevelId: { in: kinderGradeIds }, deletedAt: null },
    select: { id: true, name: true, gradeLevelId: true },
    orderBy: { name: "asc" },
  });

  if (sections.length === 0) {
    return (
      <EmptyState
        title="No Kindergarten sections"
        description="Add a Kindergarten section before a checklist can be viewed."
      />
    );
  }

  const selectedSection = sections.find((s) => s.id === sectionParam) ?? null;

  const learners = selectedSection
    ? await prisma.learner.findMany({
        where: {
          schoolId,
          sectionId: selectedSection.id,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      })
    : [];

  const selectedLearner = learners.find((l) => l.id === learnerParam) ?? null;

  const [schoolYear, school] = await Promise.all([
    prisma.schoolYear.findFirst({
      where: { schoolId, isActive: true },
      select: { id: true, label: true },
    }),
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
  ]);

  const picker = (
    <div className="print:hidden">
      <KinderChecklistSchoolHeadPicker
        basePath={SCHOOL_HEAD_ROUTES.kinderChecklist}
        sections={sections.map((s) => ({ id: s.id, label: s.name }))}
        learners={learners.map((l) => ({ id: l.id, fullName: l.fullName }))}
        sectionId={selectedSection?.id ?? null}
        learnerId={selectedLearner?.id ?? null}
      />
    </div>
  );

  if (!schoolYear) {
    return (
      <>
        {picker}
        <Callout title="No active school year">
          Activate a school year before a Kindergarten checklist can be viewed.
        </Callout>
      </>
    );
  }

  if (!selectedSection) {
    const merged = mergeKinderChecklist(new Map());
    const progress = countTouchedCompetencies(merged);
    return (
      <>
        <KinderChecklistHero
          title="End-of-Term Reports"
          subtitle="Kindergarten"
          meta="Read-only view of a learner's competency checklist."
          advisoryLabel={null}
          learnerName={null}
          touched={progress.touched}
          total={progress.total}
          pct={progress.pct}
        />
        {picker}
        <EmptyState
          title="Select a Kindergarten section"
          description="Choose a section, then a learner, to view their checklist."
        />
      </>
    );
  }

  if (learners.length === 0) {
    const merged = mergeKinderChecklist(new Map());
    const progress = countTouchedCompetencies(merged);
    return (
      <>
        <KinderChecklistHero
          title="End-of-Term Reports"
          subtitle="Kindergarten"
          meta="Read-only view of a learner's competency checklist."
          advisoryLabel={selectedSection.name}
          learnerName={null}
          touched={progress.touched}
          total={progress.total}
          pct={progress.pct}
        />
        {picker}
        <EmptyState
          title="No learners in this section"
          description="This section has no active learners yet."
        />
      </>
    );
  }

  if (!selectedLearner) {
    const merged = mergeKinderChecklist(new Map());
    const progress = countTouchedCompetencies(merged);
    return (
      <>
        <KinderChecklistHero
          title="End-of-Term Reports"
          subtitle="Kindergarten"
          meta="Read-only view of a learner's competency checklist."
          advisoryLabel={selectedSection.name}
          learnerName={null}
          touched={progress.touched}
          total={progress.total}
          pct={progress.pct}
        />
        {picker}
        <EmptyState
          title="Select a learner"
          description="Choose a learner to view their checklist."
        />
      </>
    );
  }

  // Tenancy boundary: the caller-supplied `learnerWhere` scopes to this
  // school and to the chosen Kindergarten section/grade — a School Head is
  // not an adviser, so this is a school-scoped filter, not
  // `kinderAdvisoryLearnerWhere` (the teacher's advisory-scoped one).
  const { learner, records } = await loadKinderChecklist({
    schoolYearId: schoolYear.id,
    learnerId: selectedLearner.id,
    learnerWhere: {
      schoolId,
      sectionId: selectedSection.id,
      gradeLevelId: selectedSection.gradeLevelId,
      deletedAt: null,
      archivedAt: null,
    },
  });

  const merged = mergeKinderChecklist(records);
  const progress = countTouchedCompetencies(merged);

  return (
    <>
      <KinderChecklistHero
        title="End-of-Term Reports"
        subtitle="Kindergarten"
        meta="Read-only view of a learner's competency checklist."
        advisoryLabel={selectedSection.name}
        learnerName={learner.fullName}
        touched={progress.touched}
        total={progress.total}
        pct={progress.pct}
      />
      {picker}
      <SchoolHeadKinderChecklistExport
        learnerId={selectedLearner.id}
        learnerName={learner.fullName}
        schoolName={school?.name ?? "School"}
        advisoryLabel={selectedSection.name}
        schoolYearLabel={schoolYear.label}
        entries={[...merged.entries()]}
      />
      <div className="print:hidden">
        <KinderChecklistPanel
          states={merged}
          locked={{ t1: true, t2: true, t3: true }}
          readOnly
        />
      </div>
    </>
  );
}

export default async function SchoolHeadKinderChecklistPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.kinderChecklist
  );

  return (
    <SchoolHeadPage
      title="Kindergarten Checklist"
      description="View a Kindergarten learner's End-of-Term competency checklist. Read-only — ratings are entered by the learner's teacher."
      view={view}
      hideTitle
    >
      <Suspense fallback={<TermsReportBodySkeleton />}>
        <SchoolHeadKinderChecklistBody
          view={view}
          sectionParam={params.section}
          learnerParam={params.learner}
        />
      </Suspense>
    </SchoolHeadPage>
  );
}
