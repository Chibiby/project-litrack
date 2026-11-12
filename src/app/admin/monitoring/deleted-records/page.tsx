import { Archive as ArchiveIcon } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { isDeveloperAdmin } from "@/lib/auth/admin-tier";
import { getArchivedTeachers } from "@/lib/admin/archive";
import { getDeletedLearners } from "@/lib/learners/deleted-learners";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { DeletedRecordsView } from "@/components/admin/deleted-records-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    school?: string;
    q?: string;
    page?: string;
    sort?: string;
    teachers?: string;
    teachersSort?: string;
  }>;
}

function toPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Monitoring → Deleted Records. Deleted learners for every Super Admin (inside
 * their scope); deleted teachers, and permanent delete, for a Developer Admin
 * only — the teacher and purge actions refuse anyone else.
 *
 * Deliberately uncached: this is the page read immediately before a restore
 * or an irreversible delete.
 */
export default async function DeletedRecordsPage({ searchParams }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const developer = isDeveloperAdmin(user);
  const params = await searchParams;
  const school = params.school || undefined;
  const q = params.q?.trim() || undefined;

  const [teachers, learners] = await Promise.all([
    developer
      ? getArchivedTeachers({
          school,
          q,
          teacherPage: toPage(params.teachers),
          teachersSort: params.teachersSort,
        })
      : null,
    getDeletedLearners({
      scope,
      schoolId: school,
      q,
      page: toPage(params.page),
      sort: params.sort,
      withPurgeCounts: developer,
    }),
  ]);

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
        teachers={teachers}
        learners={learners}
        filters={{ school: params.school ?? "", q: params.q ?? "" }}
        params={params}
        canPurge={developer}
      />
    </AdminPage>
  );
}
