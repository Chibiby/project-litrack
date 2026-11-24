import { Suspense } from "react";
import { ArrowRightLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { isDemoVisible } from "@/lib/demo/session";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { TableSectionSkeleton } from "@/components/loading";
import { SchoolTransfersSection } from "@/components/transfers/school-transfers-section";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ school?: string; kind?: string }>;
}

/** Every active school in the division, then the shared pick-a-school workspace. */
async function DivisionSchoolTransfers({
  schoolParam,
  kindParam,
}: {
  schoolParam: string;
  kindParam: string | undefined;
}) {
  const schools = (await resolveScopeSchools({ kind: "division" }, await isDemoVisible())).filter(
    (school) => school.isActive
  );
  return (
    <SchoolTransfersSection
      schools={schools.map((school) => ({ id: school.id, name: school.name }))}
      schoolParam={schoolParam}
      kindParam={kindParam}
      basePath={ADMIN_ROUTES.transfers}
    />
  );
}

/**
 * Management → Transfers for the Division Admin: the same request-and-accept
 * workspace a School Head has, for any school in the division. The admin picks
 * the school a learner, teacher or ARAL volunteer is moving from.
 */
export default async function AdminTransfersPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;

  return (
    <AdminPage
      title="Transfers"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={ArrowRightLeft}
          title="Transfers"
          subtitle="Pick the school they are moving from, then send learners, teachers and ARAL volunteers to another school in the division. Nobody moves until that school accepts."
        />
      }
    >
      <Suspense
        key={`${params.school ?? ""}:${params.kind ?? ""}`}
        fallback={<TableSectionSkeleton rows={8} columns={4} />}
      >
        <DivisionSchoolTransfers schoolParam={params.school?.trim() ?? ""} kindParam={params.kind} />
      </Suspense>
    </AdminPage>
  );
}
