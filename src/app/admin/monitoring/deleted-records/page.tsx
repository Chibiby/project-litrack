import { Archive as ArchiveIcon } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { isDeveloperAdmin } from "@/lib/auth/admin-tier";
import { countArchivedTeachers, getArchivedTeachers } from "@/lib/admin/archive";
import {
  countDeletedLearners,
  deletedRecordSchools,
  getDeletedLearners,
} from "@/lib/learners/deleted-learners";
import { parseRecordsPage, parseRecordsPageSize } from "@/lib/admin/records-pagination";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import {
  DeletedRecordsView,
  type DeletedRecordsData,
} from "@/components/admin/deleted-records-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    school?: string;
    q?: string;
    page?: string;
    perPage?: string;
    sort?: string;
  }>;
}

/**
 * Monitoring → Deleted Records. Deleted learners for every Super Admin (inside
 * their scope); deleted teachers, and permanent delete, for a Developer Admin
 * only — the teacher and purge actions refuse anyone else.
 *
 * Only the open tab's rows are read; the other tab gets a count for its badge.
 * Deliberately uncached: this is the page read immediately before a restore
 * or an irreversible delete.
 */
export default async function DeletedRecordsPage({ searchParams }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const developer = isDeveloperAdmin(user);
  const params = await searchParams;
  const tab = developer && params.tab === "teachers" ? "teachers" : "learners";
  const school = params.school || undefined;
  const q = params.q?.trim() || undefined;
  const page = parseRecordsPage(params.page);
  const pageSize = parseRecordsPageSize(params.perPage);

  const [teacherTabSchools, list, otherCount] = await Promise.all([
    // The learners query already returns the school list.
    tab === "teachers" ? deletedRecordSchools(scope) : null,
    tab === "teachers"
      ? getArchivedTeachers({ school, q, teacherPage: page, teachersSort: params.sort, pageSize }).then(
          (p) => ({ kind: "teachers" as const, page: p })
        )
      : getDeletedLearners({
          scope,
          schoolId: school,
          q,
          page,
          sort: params.sort,
          pageSize,
          withPurgeCounts: developer,
        }).then((p) => ({ kind: "learners" as const, page: p })),
    tab === "teachers"
      ? countDeletedLearners({ scope, schoolId: school, q })
      : developer
        ? countArchivedTeachers({ school, q })
        : null,
  ]);

  const data: DeletedRecordsData = {
    tab,
    teacherCount: !developer ? null : list.kind === "teachers" ? list.page.total : (otherCount as number),
    learnerCount: list.kind === "learners" ? list.page.total : (otherCount as number),
    list,
    pageSize,
    sort: params.sort ?? "",
    schools: (list.kind === "learners" ? list.page.schools : (teacherTabSchools ?? [])).map(({ id, name }) => ({ id, name })),
  };

  return (
    <AdminPage
      title="Deleted records"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Monitoring"
          eyebrowIcon={ArchiveIcon}
          title="Deleted records"
          subtitle={
            developer
              ? "Deleted teachers and learners from every school. Restore a mistake, or delete it for good."
              : "Learners a teacher removed more than 30 days ago. Restore one to return them to their school."
          }
        />
      }
    >
      <DeletedRecordsView
        data={data}
        filters={{ school: params.school ?? "", q: params.q ?? "" }}
        canPurge={developer}
      />
    </AdminPage>
  );
}
