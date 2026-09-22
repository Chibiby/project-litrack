import { Suspense } from "react";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { Sparkles, UserCheck, UserX } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import {
  resolveSchoolHeadView,
  type SchoolHeadView,
} from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { Callout } from "@/components/ui/callout";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { listAralTutors } from "@/lib/teachers/aral-tutor";
import {
  LEARNER_PAGE_SIZE,
  nameSearchWhere,
  totalPages,
} from "@/lib/learners/pagination";
import {
  AralTeacherTable,
  type AralLearnerRow,
  type AralTeacherOption,
} from "@/components/school-head/aral-teacher-table";
import { TableSectionSkeleton } from "@/components/loading";
import { listKey } from "@/lib/nav/list-params";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string; page?: string; q?: string }>;
}

/**
 * Only the params that change which ARAL-learner rows the table below shows.
 * `sort` is listed even though the table has no "Sort by" control yet, so the
 * boundary is already correct the day one is added — an absent param and an
 * empty-string param normalize to the same key either way (`listKey`), so
 * listing it now costs nothing.
 */
export const ARAL_LEARNERS_LIST_KEYS = ["page", "sort", "q"] as const;

/** Parsed inline — this page only needs page + q, not the roster filter set. */
function parseParams(searchParams: { page?: string; q?: string }) {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return {
    page,
    q: (searchParams.q ?? "").trim(),
    skip: (page - 1) * LEARNER_PAGE_SIZE,
    take: LEARNER_PAGE_SIZE,
  };
}

/**
 * Awaited directly by the page, not inside the streamed boundary: the hero's
 * three figures describe ARAL at this school regardless of the table's
 * paging/search state, and the hero must resolve before `SchoolHeadPage`
 * renders so it can be handed through the `hero` prop (the Super Admin badge
 * row renders between hero and `children`, so the hero cannot be folded into
 * `children` instead).
 */
async function loadAralHero({
  view,
}: {
  view: SchoolHeadView;
}): Promise<ReactNode> {
  const { schoolId } = view;

  const programWhere: Prisma.LearnerWhereInput = {
    schoolId,
    deletedAt: null,
    archivedAt: null,
    isAralLearner: true,
  };

  const [programCount, programUntutored] = await Promise.all([
    prisma.learner.count({ where: programWhere }),
    prisma.learner.count({ where: { ...programWhere, aralTeacherId: null } }),
  ]);

  const programTutored = programCount - programUntutored;

  return (
    <SchoolHeadHero
      eyebrow="ARAL Program"
      eyebrowIcon={Sparkles}
      title="ARAL learners"
      subtitle="Designate the teacher who tracks each ARAL learner's reading and writing every week."
      stats={
        <>
          <StatCard
            title="ARAL learners"
            value={programCount}
            hint="In the ARAL program"
            icon={Sparkles}
            tone="violet"
            inlineOnPhone
            denseOnPhone
          />
          <StatCard
            title="With a tutor"
            value={programTutored}
            hint="Already designated"
            icon={UserCheck}
            tone="emerald"
            inlineOnPhone
            denseOnPhone
          />
          <StatCard
            title="Awaiting a tutor"
            value={programUntutored}
            hint="Needs a designated teacher"
            icon={UserX}
            tone={programUntutored > 0 ? "amber" : "neutral"}
            inlineOnPhone
            denseOnPhone
          />
        </>
      }
    />
  );
}

/** The streamed, paging/search-dependent half of the page — the table itself. */
async function AralLearnersBody({
  view,
  params,
}: {
  view: SchoolHeadView;
  params: ReturnType<typeof parseParams>;
}) {
  const { schoolId, isSuperAdminView } = view;

  const learnerWhere: Prisma.LearnerWhereInput = {
    schoolId,
    deletedAt: null,
    archivedAt: null,
    isAralLearner: true,
    ...nameSearchWhere(params.q),
  };

  const [learners, learnerCount, teachers] = await Promise.all([
    prisma.learner.findMany({
      relationLoadStrategy: "join",
      where: learnerWhere,
      select: {
        id: true,
        fullName: true,
        aralTeacherId: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        teacher: { select: { fullName: true } },
      },
      orderBy: { fullName: "asc" },
      skip: params.skip,
      take: params.take,
    }),
    prisma.learner.count({ where: learnerWhere }),
    // The whole active roster: an ARAL-only teacher (no advisory section) is a
    // valid designee, so this must not be narrowed to advisers. Shared with the
    // teacher's own picker so the two can never disagree about who qualifies.
    listAralTutors(schoolId),
  ]);

  const rows: AralLearnerRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    gradeLabel: GRADE_LEVEL_LABELS[l.gradeLevel.type],
    sectionName: l.section?.name ?? null,
    adviserName: l.teacher?.fullName ?? null,
    aralTeacherId: l.aralTeacherId,
  }));

  const teacherOptions: AralTeacherOption[] = teachers.map((t) => ({
    id: t.id,
    fullName: t.name,
    advisoryLabel: t.advisoryLabel,
    employmentType: t.employmentType,
  }));

  return (
    <>
      {/* Violet is the reserved ARAL accent, so the one place it earns a whole
          banner is here. */}
      <Callout variant="aral">
        An ARAL teacher is independent of who advises the learner&apos;s section —
        designate any active teacher, including one who advises no section at all.
        Reassign here before removing a teacher who still holds ARAL learners.
      </Callout>

      {teacherOptions.length === 0 && !isSuperAdminView ? (
        <Callout title="No active teachers yet">
          Approve a teacher before designating ARAL teachers.
        </Callout>
      ) : null}

      <AralTeacherTable
        rows={rows}
        teachers={teacherOptions}
        readOnly={isSuperAdminView}
        list={{
          page: params.page,
          totalPages: totalPages(learnerCount),
          totalCount: learnerCount,
          q: params.q,
          basePath: SCHOOL_HEAD_ROUTES.aral,
          searchParams: {
            schoolId: isSuperAdminView ? schoolId : undefined,
            q: params.q || undefined,
          },
        }}
      />
    </>
  );
}

export default async function SchoolHeadAralPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { view } = await resolveSchoolHeadView(
    raw.schoolId,
    SCHOOL_HEAD_ROUTES.aral
  );

  const params = parseParams(raw);
  const hero = await loadAralHero({ view });

  return (
    <SchoolHeadPage
      title="ARAL learners"
      description="Designate the teacher who tracks each ARAL learner's reading and writing every week."
      view={view}
      hero={hero}
    >
      <Suspense
        key={listKey(raw, ARAL_LEARNERS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={5} />}
      >
        <AralLearnersBody view={view} params={params} />
      </Suspense>
    </SchoolHeadPage>
  );
}
