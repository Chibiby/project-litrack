import { requireUser } from "@/lib/auth/session";
import { Archive as ArchiveIcon } from "lucide-react";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { ArchiveView } from "@/components/admin/archive-view";
import { getArchive, type Archive } from "@/lib/admin/archive";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    school?: string;
    q?: string;
    teachers?: string;
    learners?: string;
    teachersSort?: string;
    learnersSort?: string;
  }>;
}

function toPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Distinct schools among the rows just fetched, for the School filter
 * dropdown — no separate query. Deliberately built from *these* rows rather
 * than a global schools list: it costs nothing extra, and it is the only way
 * the dropdown can offer a soft-deleted school, since `getSchoolsListPage`
 * filters those out even though the archive page exists specifically to show
 * their rows (struck through).
 */
function schoolsFromArchive(data: Archive): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const t of data.teachers.rows) {
    if (t.schoolId) byId.set(t.schoolId, t.schoolName ?? t.schoolId);
  }
  for (const l of data.learners.rows) {
    byId.set(l.schoolId, l.schoolName);
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

/**
 * Every soft-deleted Teacher and Learner, across every school, one place a
 * Super Admin can restore or permanently delete a mistake — deliberately
 * uncached, for the same reason `/admin/schools/[schoolId]` is: this is the
 * page read immediately before an irreversible action.
 *
 * Both buckets are fetched together in one `getArchive` call, unchanged from
 * before. `ArchiveView` renders them through two independently-keyed
 * `<Suspense>` boundaries, each wrapping its own `ListNavigationProvider`/
 * `ListBusyRegion` pair (see `archive-view.tsx`), so a teachers-only page/sort
 * change shows a skeleton over just the teachers table, and a learners-only
 * change never touches the teachers table at all. `params` (the raw,
 * already-`await`ed `searchParams`) is threaded straight through so
 * `ArchiveView` can compute each panel's Suspense key itself.
 */
export default async function AdminArchivePage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;
  const { school, q, teachers, learners, teachersSort, learnersSort } = params;

  const data = await getArchive({
    school: school || undefined,
    q: q || undefined,
    teacherPage: toPage(teachers),
    learnerPage: toPage(learners),
    teachersSort,
    learnersSort,
  });

  return (
    <AdminPage
      title="Archived records"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Records"
          eyebrowIcon={ArchiveIcon}
          title="Archived records"
          subtitle="Removed teachers and learners from every school. Restore a mistake, or delete it for good."
        />
      }
    >
      <ArchiveView
        data={data}
        schools={schoolsFromArchive(data)}
        filters={{ school: school ?? "", q: q ?? "" }}
        params={params}
      />
    </AdminPage>
  );
}
