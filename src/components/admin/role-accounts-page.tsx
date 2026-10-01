import { Suspense, type ReactNode } from "react";
import { GraduationCap, MapPinned, ShieldCheck, UserCog } from "lucide-react";
import type { User } from "@prisma/client";
import { requireDeveloperAdminPage, requireUser } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { AccountsTable, type ManagedAccountRole } from "@/components/admin/accounts-table";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";
import {
  districtField,
  gradeField,
  schoolField,
  scopeLabel,
  sectionField,
} from "@/components/admin/management/filter-fields";
import {
  DistrictAdminsSummaryCards,
  SchoolHeadsSummaryCards,
  SummaryUnavailable,
  TeachersSummaryCards,
} from "@/components/admin/management/summary-cards";
import { listKey } from "@/lib/nav/list-params";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import {
  ACCOUNT_LIST_SORTS,
  accountsTotalPages,
  getAccountsPage,
  parseAccountsParams,
  type AccountRow,
  type AccountsParams,
} from "@/lib/admin/accounts";
import {
  getDistrictAdminsPage,
  getDistrictAdminsSummary,
  getSchoolHeadsPage,
  getSchoolHeadsSummary,
  getTeachersPage,
  getTeachersSummary,
  listDistrictOptions,
  listGradeOptions,
  listSchoolOptions,
  listSectionOptions,
  parseDistrictAdminsParams,
  parseSchoolHeadsParams,
  parseTeachersParams,
  type DistrictAdminsSummary,
  type PeopleSearchParams,
  type SchoolHeadsSummary,
  type TeachersSummary,
} from "@/lib/admin/management";

/**
 * Params that change which rows the accounts list shows — see `listKey`.
 * `q` is left out: search runs as you type, and a remount on each search would
 * drop the search box's focus.
 */
export const ACCOUNTS_LIST_KEYS = [
  "page",
  "sort",
  "role",
  "schoolId",
  "grade",
  "district",
  "section",
] as const;

/** Params the summary cards honour; paging and sorting never re-suspend them. */
const SUMMARY_KEYS = ["district", "schoolId", "grade", "section"] as const;

export type AccountsSearchParams = PeopleSearchParams & { role?: string };

type PageCopy = {
  title: string;
  eyebrow: string;
  subtitle: string;
  icon: typeof GraduationCap;
  basePath: string;
};

const PAGE_COPY: Record<ManagedAccountRole, PageCopy> = {
  TEACHER: {
    title: "Teachers",
    eyebrow: "Management",
    subtitle: "Every teacher in every school. Find a teacher, check their sign-in, or reset their password.",
    icon: GraduationCap,
    basePath: ADMIN_ROUTES.teachers,
  },
  SCHOOL_HEAD: {
    title: "School Heads",
    eyebrow: "Management",
    subtitle: "The head of every school. Find a School Head, check their sign-in, or reset their password.",
    icon: ShieldCheck,
    basePath: ADMIN_ROUTES.schoolHeads,
  },
  DISTRICT_ADMIN: {
    title: "District Admins",
    eyebrow: "Management",
    subtitle: "Every district admin and the districts they oversee. Check their sign-in or reset their password.",
    icon: MapPinned,
    basePath: ADMIN_ROUTES.districtAdmins,
  },
  SUPER_ADMIN: {
    title: "Admin Accounts",
    eyebrow: "Developer Controls",
    subtitle: "Division and Developer Admin accounts. Check who can sign in to the admin console.",
    icon: UserCog,
    basePath: ADMIN_ROUTES.adminAccounts,
  },
};

/** "Role" sorts nothing on a one-role page; "School" sorts nothing where rows have no school. */
function sortOptionsFor(role: ManagedAccountRole) {
  const hideSchool = role === "DISTRICT_ADMIN" || role === "SUPER_ADMIN";
  return ACCOUNT_LIST_SORTS.options.filter(
    (o) => o.value !== "role" && !(hideSchool && o.value === "school")
  );
}

/**
 * Role-forced params: a hand-edited `?role=` can never widen a page, and a
 * sort the page's dropdown does not offer (a bookmarked `sort=role`) falls back
 * to the default rather than ordering by something the user cannot see.
 */
function parseFor(role: ManagedAccountRole, sp: AccountsSearchParams): AccountsParams {
  const params = parseRoleParams(role, sp);
  if (!sortOptionsFor(role).some((o) => o.value === params.sort)) {
    return { ...params, sort: ACCOUNT_LIST_SORTS.parse(undefined) };
  }
  return params;
}

function parseRoleParams(role: ManagedAccountRole, sp: AccountsSearchParams): AccountsParams {
  switch (role) {
    case "TEACHER":
      return parseTeachersParams(sp);
    case "SCHOOL_HEAD":
      return parseSchoolHeadsParams(sp);
    case "DISTRICT_ADMIN":
      return parseDistrictAdminsParams(sp);
    case "SUPER_ADMIN":
      return parseAccountsParams({
        q: sp.q,
        page: sp.page,
        sort: sp.sort,
        role: "SUPER_ADMIN",
      });
  }
}

function pageFor(role: ManagedAccountRole, params: AccountsParams) {
  switch (role) {
    case "TEACHER":
      return getTeachersPage(params);
    case "SCHOOL_HEAD":
      return getSchoolHeadsPage(params);
    case "DISTRICT_ADMIN":
      return getDistrictAdminsPage(params);
    case "SUPER_ADMIN":
      return getAccountsPage({ ...params, role: "SUPER_ADMIN" });
  }
}

async function filtersFor(role: ManagedAccountRole, params: AccountsParams): Promise<ListFilterField[]> {
  if (role === "SUPER_ADMIN") return [];
  const districts = await listDistrictOptions();
  if (role === "DISTRICT_ADMIN") return [districtField(districts, params.district)];

  const schools = await listSchoolOptions({ district: params.district });
  if (role === "SCHOOL_HEAD") {
    return [
      districtField(districts, params.district, ["schoolId"]),
      schoolField(schools, params.schoolId),
    ];
  }
  const sections = await listSectionOptions({ schoolId: params.schoolId, grade: params.grade });
  return [
    districtField(districts, params.district, ["schoolId", "section"]),
    schoolField(schools, params.schoolId, ["section"]),
    gradeField(listGradeOptions(), params.grade, ["section"]),
    sectionField(sections, params.section, { schoolId: params.schoolId, grade: params.grade }),
  ];
}

async function AccountsListBody({
  role,
  searchParams,
}: {
  role: ManagedAccountRole;
  searchParams: AccountsSearchParams;
}) {
  const params = parseFor(role, searchParams);
  let rows: AccountRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let dbAvailable = true;

  try {
    const [page, loadedFilters] = await Promise.all([pageFor(role, params), filtersFor(role, params)]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = loadedFilters;
  } catch (err) {
    // DATABASE_URL missing or Prisma unavailable — degrade to an empty table
    // instead of a 500. The page guard already verified the session.
    console.error(`[RoleAccountsPage:${role}] failed to load accounts:`, err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load accounts right now. The database may be unavailable.
        </p>
      ) : null}
      <AccountsTable
        role={role}
        basePath={PAGE_COPY[role].basePath}
        rows={rows}
        filters={filters}
        list={{
          page: params.page,
          pageSize: params.pageSize,
          totalPages: accountsTotalPages(totalCount, params.pageSize),
          totalCount,
          q: params.q,
          sort: params.sort,
          sortOptions: sortOptionsFor(role),
        }}
      />
    </>
  );
}

async function SummaryBody({
  role,
  searchParams,
}: {
  role: Exclude<ManagedAccountRole, "SUPER_ADMIN">;
  searchParams: AccountsSearchParams;
}) {
  const params = parseFor(role, searchParams);
  let loaded: { scope: string; data: LoadedSummary } | null = null;
  try {
    const [schools, sections, data] = await Promise.all([
      params.schoolId ? listSchoolOptions({ district: params.district }) : Promise.resolve([]),
      params.section ? listSectionOptions({ schoolId: params.schoolId }) : Promise.resolve([]),
      loadSummary(role, params),
    ]);
    const sectionName = sections.find((s) => s.id === params.section)?.name;
    const gradeLabel = listGradeOptions().find((g) => g.value === params.grade)?.label;
    const scope = scopeLabel({
      district: params.district,
      schoolId: params.schoolId,
      schools,
      extra: [gradeLabel, sectionName ? `Section ${sectionName}` : undefined].filter(
        (v): v is string => Boolean(v)
      ),
    });
    loaded = { scope, data };
  } catch (err) {
    console.error(`[RoleAccountsPage:${role}] failed to load summary:`, err);
  }

  if (!loaded) return <SummaryUnavailable what="overview" />;
  const { scope, data } = loaded;
  if (data.kind === "TEACHER") return <TeachersSummaryCards summary={data.summary} scope={scope} />;
  if (data.kind === "SCHOOL_HEAD") return <SchoolHeadsSummaryCards summary={data.summary} scope={scope} />;
  return <DistrictAdminsSummaryCards summary={data.summary} scope={scope} />;
}

type LoadedSummary =
  | { kind: "TEACHER"; summary: TeachersSummary }
  | { kind: "SCHOOL_HEAD"; summary: SchoolHeadsSummary }
  | { kind: "DISTRICT_ADMIN"; summary: DistrictAdminsSummary };

async function loadSummary(
  role: Exclude<ManagedAccountRole, "SUPER_ADMIN">,
  params: AccountsParams
): Promise<LoadedSummary> {
  if (role === "TEACHER") {
    return {
      kind: role,
      summary: await getTeachersSummary({
        district: params.district,
        schoolId: params.schoolId,
        grade: params.grade,
        section: params.section,
      }),
    };
  }
  if (role === "SCHOOL_HEAD") {
    return {
      kind: role,
      summary: await getSchoolHeadsSummary({ district: params.district, schoolId: params.schoolId }),
    };
  }
  return { kind: role, summary: await getDistrictAdminsSummary({ district: params.district }) };
}

/**
 * One accounts page per role: Teachers, School Heads and District Admins under
 * Management, Admin Accounts under Developer Controls. Find a person by name,
 * narrow by district / school / grade / section where the role has one, and
 * diagnose their login (reveal / reset a password, or sign in as them).
 *
 * The cards and the list are separate Suspense boundaries: paging or sorting
 * re-suspends only the list, a filter change re-suspends both.
 */
export async function RoleAccountsPage({
  role,
  searchParams,
}: {
  role: ManagedAccountRole;
  searchParams: Promise<AccountsSearchParams>;
}) {
  // Admin accounts are Developer Controls: a Division Admin gets a 404, like
  // the other pages in that group.
  const user: User =
    role === "SUPER_ADMIN" ? await requireDeveloperAdminPage() : await requireUser("SUPER_ADMIN");
  const params = await searchParams;
  const copy = PAGE_COPY[role];

  let summary: ReactNode = null;
  if (role !== "SUPER_ADMIN") {
    summary = (
      <Suspense key={listKey(params, SUMMARY_KEYS)} fallback={<MetricsGridSkeleton className="mb-0" />}>
        <SummaryBody role={role} searchParams={params} />
      </Suspense>
    );
  }

  return (
    <AdminPage
      title={copy.title}
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow={copy.eyebrow}
          eyebrowIcon={copy.icon}
          title={copy.title}
          subtitle={copy.subtitle}
        />
      }
    >
      {summary}
      <Suspense
        key={listKey(params, ACCOUNTS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={10} columns={6} />}
      >
        <AccountsListBody role={role} searchParams={params} />
      </Suspense>
    </AdminPage>
  );
}
