import { UserX } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { getDeletedLearners } from "@/lib/learners/deleted-learners";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { DeletedLearnersView } from "@/components/admin/deleted-learners-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ school?: string; q?: string; page?: string; sort?: string }>;
}

function toPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminDeletedLearnersPage({ searchParams }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const { school, q, page, sort } = await searchParams;

  const data = await getDeletedLearners({
    scope,
    schoolId: school || undefined,
    q: q?.trim() || undefined,
    page: toPage(page),
    sort,
  });

  return (
    <AdminPage
      title="Deleted learners"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Records"
          eyebrowIcon={UserX}
          title="Deleted learners"
          subtitle="Learners a teacher removed more than 30 days ago. Restore one to return them to their school."
        />
      }
    >
      <DeletedLearnersView
        data={data}
        filters={{ school: school ?? "", q: q ?? "" }}
        showDistrict
        basePath={ADMIN_ROUTES.deletedLearners}
      />
    </AdminPage>
  );
}
