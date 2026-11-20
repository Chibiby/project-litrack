import { Suspense } from "react";
import { Users } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { accountsTotalPages, type AccountsParams } from "@/lib/admin/accounts";
import {
  getDistrictTeachersPage,
  getTeachersSummary,
  listGradeOptions,
  listSectionOptions,
  parseTeachersParams,
  type DistrictTeacherRow,
  type PeopleSearchParams,
  type TeachersSummary,
} from "@/lib/admin/management";
import { districtListContext, type DistrictListContext } from "@/lib/district/management";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { listKey } from "@/lib/nav/list-params";
import { AppShell } from "@/components/app-shell";
import { PageSlide } from "@/components/ui/page-slide";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";
import {
  districtField,
  gradeField,
  schoolField,
  scopeLabel,
  sectionField,
  teacherFacetFields,
} from "@/components/admin/management/filter-fields";
import { TEACHER_FACET_KEYS, facetScopeLabels } from "@/lib/teachers/teacher-filters";
import { SummaryUnavailable, TeachersSummaryCards } from "@/components/admin/management/summary-cards";
import { DistrictTeachersList } from "@/components/district/district-teachers-list";
import { describeScope } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

const LIST_KEYS = ["page", "district", "schoolId", "grade", "section", ...TEACHER_FACET_KEYS] as const;
const SUMMARY_KEYS = ["district", "schoolId", "grade", "section", ...TEACHER_FACET_KEYS] as const;

function scopeOf(ctx: DistrictListContext, params: AccountsParams): string {
  const facets = facetScopeLabels(params.facets);
  if (ctx.district || ctx.schoolId) {
    return scopeLabel({
      district: ctx.district,
      schoolId: ctx.schoolId,
      schools: ctx.schoolOptions,
      extra: facets,
    });
  }
  return ["Your schools", ...facets].join(" · ");
}

async function TeacherCards({ ctx, params }: { ctx: DistrictListContext; params: AccountsParams }) {
  let summary: TeachersSummary;
  try {
    summary = await getTeachersSummary({
      districts: ctx.districts,
      district: ctx.district,
      schoolId: ctx.schoolId,
      grade: params.grade,
      section: params.section,
      facets: params.facets,
    });
  } catch (err) {
    console.error("[DistrictTeachersPage] failed to load summary:", err);
    return <SummaryUnavailable what="teacher" />;
  }
  return <TeachersSummaryCards summary={summary} scope={scopeOf(ctx, params)} />;
}

async function TeacherList({ ctx, params }: { ctx: DistrictListContext; params: AccountsParams }) {
  let rows: DistrictTeacherRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let dbAvailable = true;
  try {
    const [page, sections] = await Promise.all([
      getDistrictTeachersPage(ctx.districts, params),
      listSectionOptions({ schoolId: ctx.schoolId, grade: params.grade }),
    ]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = [
      ...(ctx.showDistrictFilter ? [districtField(ctx.districtOptions, ctx.district, ["schoolId", "section"])] : []),
      schoolField(ctx.schoolOptions, ctx.schoolId, ["section"]),
      gradeField(listGradeOptions(), params.grade, ["section"]),
      sectionField(sections, params.section, { schoolId: ctx.schoolId, grade: params.grade }),
      ...teacherFacetFields(params.facets ?? {}, { status: true }),
    ];
  } catch (err) {
    console.error("[DistrictTeachersPage] failed to load list:", err);
    dbAvailable = false;
  }
  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">Could not load teachers right now. The database may be unavailable.</p>
      ) : null}
      <DistrictTeachersList
        rows={rows}
        filters={filters}
        basePath={DISTRICT_ROUTES.teachers}
        list={{
          page: params.page,
          pageSize: params.pageSize,
          totalPages: accountsTotalPages(totalCount, params.pageSize),
          totalCount,
          q: params.q,
        }}
      />
    </>
  );
}

/**
 * Every teacher in the district admin's schools: the division page's figures
 * and a read-only list (no sign-in, password or approval controls; those stay
 * with the School Head and the division). Fenced to the admin's districts.
 */
export default async function DistrictTeachersPage({
  searchParams,
}: {
  searchParams: Promise<PeopleSearchParams>;
}) {
  const { user, scope } = await requireAdminScope();
  const raw = await searchParams;
  const ctx = await districtListContext(scope, { district: raw.district, schoolId: raw.schoolId });
  const parsed = parseTeachersParams({ ...raw, district: ctx.district, schoolId: ctx.schoolId });
  // A section only means something with a school chosen.
  const params: AccountsParams = { ...parsed, section: ctx.schoolId ? parsed.section : undefined };
  const summaryKey = listKey(raw, SUMMARY_KEYS);

  return (
    <AppShell
      title="Teachers"
      subtitle="Every teacher in your schools"
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <PageSlide side="parent">
        <div className="mb-6">
          <SchoolHeadHero
            eyebrow="Management"
            eyebrowIcon={Users}
            title="Teachers"
            subtitle="Every teacher in your schools: who is active, waiting for approval, and which section they advise."
            meta={describeScope(scope)}
          />
        </div>
        <div className="space-y-6">
          <Suspense key={`cards-${summaryKey}`} fallback={<MetricsGridSkeleton className="mb-0" count={6} />}>
            <TeacherCards ctx={ctx} params={params} />
          </Suspense>
          <Suspense key={listKey(raw, LIST_KEYS)} fallback={<TableSectionSkeleton rows={10} columns={4} />}>
            <TeacherList ctx={ctx} params={params} />
          </Suspense>
        </div>
      </PageSlide>
    </AppShell>
  );
}
