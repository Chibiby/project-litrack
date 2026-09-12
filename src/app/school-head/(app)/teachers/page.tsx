import { Suspense } from "react";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  parseTeachersListParams,
  teachersTotalPages,
} from "@/lib/teachers/pagination";
import {
  TEACHER_ROSTER_STATE,
  managedTeacherSelect,
  teacherRosterScope,
  teacherRosterFilterWhere,
  multiAdvisoryTeacherIds,
  teacherTabCounts,
  toManagedRow,
} from "@/lib/teachers/roster";
import {
  SchoolHeadPage,
  schoolHeadHref,
} from "@/components/school-head/school-head-page";
import {
  TEACHER_TABS,
  teacherWorkspaceTabs,
} from "@/components/school-head/workspace-tabs";
import { Callout } from "@/components/ui/callout";
import { Badge } from "@/components/ui/badge";
import {
  TeachersActiveTable,
  type ActiveTeacherRow,
  type AdvisoryGradeOption,
} from "@/components/teachers-active-table";
import { TableSectionSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

interface TeachersPageProps {
  searchParams: Promise<{
    schoolId?: string;
    page?: string;
    q?: string;
    filter?: string;
  }>;
}

async function ActiveTeachersBody({
  view,
  list,
  unfilteredCount,
}: {
  view: SchoolHeadView;
  list: ReturnType<typeof parseTeachersListParams>;
  /** The tab badge's number, reused as the row count when nothing is searched. */
  unfilteredCount: number;
}) {
  const { schoolId, isSuperAdminView } = view;

  const filterWhere =
    list.filter === "all"
      ? {}
      : list.filter === "multi-advisory"
        ? { id: { in: await multiAdvisoryTeacherIds(schoolId) } }
        : teacherRosterFilterWhere(list.filter);

  const activeWhere: Prisma.UserWhereInput = {
    ...teacherRosterScope(schoolId),
    ...TEACHER_ROSTER_STATE.active,
    ...filterWhere,
    ...(list.q
      ? {
          OR: [
            { fullName: { contains: list.q, mode: "insensitive" } },
            { email: { contains: list.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [activeTeachers, gradeSections, searchCount] = await Promise.all([
    prisma.user.findMany({
      where: activeWhere,
      select: managedTeacherSelect,
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.take,
    }),
    // Serves two jobs at once, which is why it replaced a pair of counts: it
    // fills the School Head's advisory picker, and its shape answers both
    // capacity questions below (any grade at all? any adviser-free section?).
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        sections: {
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            adviser: { select: { id: true, fullName: true } },
          },
        },
      },
    }),
    // The tab badge is unfiltered. Count again whenever search or a roster
    // filter narrows the rows shown on this page.
    list.q || list.filter !== "all"
      ? prisma.user.count({ where: activeWhere })
      : null,
  ]);

  const activeCount = searchCount ?? unfilteredCount;

  const advisoryOptions: AdvisoryGradeOption[] = gradeSections
    // A grade with no sections would render an empty <optgroup>.
    .filter((g) => g.sections.length > 0)
    .map((g) => ({
      gradeLabel: GRADE_LEVEL_LABELS[g.type] ?? g.type,
      sections: g.sections.map((s) => ({
        id: s.id,
        name: s.name,
        adviserId: s.adviser?.id ?? null,
        adviserName: s.adviser?.fullName ?? null,
      })),
    }));

  const gradeLevelCount = gradeSections.length;
  // Every "Grade · Section" with no adviser — a new section, one a School Head
  // set to Unassigned, or one a removed teacher left behind. Listed by name so
  // the head sees exactly which classes are waiting for someone.
  const unassignedSections = gradeSections.flatMap((g) =>
    g.sections
      .filter((s) => s.adviser === null)
      .map((s) => ({
        id: s.id,
        label: `${GRADE_LEVEL_LABELS[g.type] ?? g.type} · ${s.name}`,
      }))
  );
  const freeSectionCount = unassignedSections.length;

  const activeRows: ActiveTeacherRow[] = activeTeachers.map(toManagedRow);

  const gradeLevelsHref = schoolHeadHref(
    view,
    SCHOOL_HEAD_ROUTES.schoolGradeLevels
  );

  return (
    <>
      {/* Both notices are about advisory capacity, so they sit on this tab
          rather than above the tab bar: this is the only panel that already
          reads the grade levels, and the only one where the shortage stops you
          from finishing something. */}
      {gradeLevelCount === 0 ? (
        <Callout title="No grade levels yet">
          Teachers cannot finish profiling until this school has grade levels and
          sections to choose from. Add them in{" "}
          <Link href={gradeLevelsHref} className="font-medium underline">
            Grade levels
          </Link>
          .
        </Callout>
      ) : freeSectionCount === 0 ? (
        <Callout title="Every section already has an adviser">
          New teachers will have nothing to choose during profiling. Add more
          sections in{" "}
          <Link href={gradeLevelsHref} className="font-medium underline">
            Grade levels
          </Link>
          , or set a sitting adviser to Unassigned to free one up.
        </Callout>
      ) : (
        <Callout
          variant="info"
          title={`${freeSectionCount} ${freeSectionCount === 1 ? "section has" : "sections have"} no adviser — Unassigned`}
        >
          <ul className="flex flex-wrap gap-1.5" aria-label="Sections without an adviser">
            {unassignedSections.map((s) => (
              <li key={s.id}>
                <Badge variant="outline" className="font-normal">
                  {s.label}
                </Badge>
              </li>
            ))}
          </ul>
          {!isSuperAdminView ? (
            <p className="mt-2">
              Assign one to a teacher with the Grade &amp; section picker below.
            </p>
          ) : null}
        </Callout>
      )}

      <TeachersActiveTable
        rows={activeRows}
        readOnly={isSuperAdminView}
        // Withheld in the Super Admin view: the table is already read-only there,
        // and an advisory belongs to the school's own head to decide.
        advisoryOptions={isSuperAdminView ? undefined : advisoryOptions}
        list={{
          page: list.page,
          totalPages: teachersTotalPages(activeCount, list.pageSize),
          totalCount: activeCount,
          q: list.q,
          filter: list.filter,
          basePath: SCHOOL_HEAD_ROUTES.teachers,
          searchParams: {
            schoolId: isSuperAdminView ? schoolId : undefined,
            q: list.q || undefined,
            filter: list.filter === "all" ? undefined : list.filter,
          },
        }}
      />
    </>
  );
}

export default async function TeachersPage({ searchParams }: TeachersPageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.teachers
  );

  const list = parseTeachersListParams(params);
  // Awaited outside the Suspense boundary because the tab bar renders above it:
  // the four badges paint with the frame, and only the roster itself streams.
  const counts = await teacherTabCounts(view.schoolId);

  return (
    <SchoolHeadPage
      title="Teachers"
      description="Everyone who can sign in to this school. Change an advisory section here at any time."
      view={view}
      tabs={teacherWorkspaceTabs(counts)}
      activeTab={TEACHER_TABS.active}
    >
      <Suspense fallback={<TableSectionSkeleton rows={8} columns={7} />}>
        <ActiveTeachersBody
          view={view}
          list={list}
          unfilteredCount={counts.active}
        />
      </Suspense>
    </SchoolHeadPage>
  );
}
