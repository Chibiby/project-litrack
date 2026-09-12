import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { ArchiveView } from "@/components/admin/archive-view";
import { getArchive, type Archive } from "@/lib/admin/archive";

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
 */
export default async function AdminArchivePage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const { school, q, teachers, learners } = await searchParams;

  const data = await getArchive({
    school: school || undefined,
    q: q || undefined,
    teacherPage: toPage(teachers),
    learnerPage: toPage(learners),
  });

  return (
    <AppShell
      title="Archive"
      subtitle="Soft-deleted teachers and learners across all schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <ArchiveView
        data={data}
        schools={schoolsFromArchive(data)}
        filters={{ school: school ?? "", q: q ?? "" }}
      />
    </AppShell>
  );
}
