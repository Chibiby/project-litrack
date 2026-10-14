import { UserX } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { getDeletedLearners } from "@/lib/learners/deleted-learners";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { DeletedLearnersView } from "@/components/admin/deleted-learners-view";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { describeScope, hasNoDistricts } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ school?: string; q?: string; page?: string; sort?: string }>;
}

function toPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function DistrictDeletedLearnersPage({ searchParams }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const { school, q, page, sort } = await searchParams;

  const data = hasNoDistricts(scope)
    ? null
    : await getDeletedLearners({
        scope,
        schoolId: school || undefined,
        q: q?.trim() || undefined,
        page: toPage(page),
        sort,
      });

  return (
    <AppShell
      title="Deleted learners"
      subtitle={describeScope(scope)}
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <div className="mb-6">
        <SchoolHeadHero
          eyebrow="Your schools"
          eyebrowIcon={UserX}
          title="Deleted learners"
          subtitle="Learners a teacher removed more than 30 days ago. Restore one to return them to their school."
          meta={describeScope(scope)}
          variant="compact"
        />
      </div>
      {data ? (
        <DeletedLearnersView
          data={data}
          filters={{ school: school ?? "", q: q ?? "" }}
          showDistrict={scope.kind !== "districts" || scope.districts.length > 1}
          basePath={DISTRICT_ROUTES.deletedLearners}
        />
      ) : (
        <NoDistrictsState />
      )}
    </AppShell>
  );
}
