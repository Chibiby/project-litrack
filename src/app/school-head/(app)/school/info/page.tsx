import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  SCHOOL_TABS,
  SCHOOL_WORKSPACE_TABS,
} from "@/components/school-head/workspace-tabs";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { SchoolInfoForm } from "@/components/school-head/school-info-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/** One read-only row of the Super Admin view. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

export default async function SchoolInfoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.schoolInfo
  );

  const school = await prisma.school.findUnique({
    where: { id: view.schoolId },
    select: {
      name: true,
      schoolIdCode: true,
      address: true,
      region: true,
      division: true,
      district: true,
    },
  });
  if (!school) redirect(SCHOOL_HEAD_ROUTES.dashboard);

  return (
    <SchoolHeadPage
      title="School information"
      description="Details shown on reports and exports. The DepEd School ID cannot be changed."
      view={view}
      tabs={SCHOOL_WORKSPACE_TABS}
      activeTab={SCHOOL_TABS.info}
    >
      <Surface as="section" className="max-w-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">School details</h2>
        </SurfaceHeader>
        <SurfaceBody>
          {view.isSuperAdminView ? (
            <dl className="grid gap-5 sm:grid-cols-2">
              <DetailRow label="Name" value={school.name} />
              <DetailRow
                label="School ID"
                value={<span className="font-mono text-xs">{school.schoolIdCode}</span>}
              />
              <DetailRow label="Address" value={school.address || "—"} />
              <DetailRow label="Region" value={school.region || "—"} />
              <DetailRow label="Division" value={school.division || "—"} />
              <DetailRow label="District" value={school.district || "—"} />
            </dl>
          ) : (
            <SchoolInfoForm school={school} />
          )}
        </SurfaceBody>
      </Surface>
    </SchoolHeadPage>
  );
}
