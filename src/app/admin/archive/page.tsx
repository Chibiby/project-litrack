import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { ArchiveView } from "@/components/admin/archive-view";
import { getArchive } from "@/lib/admin/archive";
import { getSchoolsListPage } from "@/lib/cache/schools-list";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    school?: string;
    q?: string;
    teachers?: string;
    learners?: string;
  }>;
}

function toPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Every soft-deleted Teacher and Learner, across every school, one place a
 * Super Admin can restore or permanently delete a mistake — deliberately
 * uncached, for the same reason `/admin/schools/[schoolId]` is: this is the
 * page read immediately before an irreversible action.
 */
export default async function AdminArchivePage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const { school, q, teachers, learners } = await searchParams;

  const [data, schoolsPage] = await Promise.all([
    getArchive({
      school: school || undefined,
      q: q || undefined,
      teacherPage: toPage(teachers),
      learnerPage: toPage(learners),
    }),
    // Populates the School filter only — a light, cached list (id/name), not
    // the archive's own uncached read model. A very large deployment beyond
    // this page size would need its own picker; not the case today.
    getSchoolsListPage({ page: 1, pageSize: 1000, skip: 0, take: 1000, q: "", region: "" }),
  ]);

  return (
    <AppShell
      title="Archive"
      subtitle="Soft-deleted teachers and learners across all schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <ArchiveView
        data={data}
        schools={schoolsPage.rows.map((s) => ({ id: s.id, name: s.name }))}
        filters={{ school: school ?? "", q: q ?? "" }}
      />
    </AppShell>
  );
}
