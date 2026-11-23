import { Suspense } from "react";
import { ArrowRightLeft } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { parseTransferKind } from "@/lib/transfers/queries";
import { SchoolHeadPage, schoolHeadHref } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { TableSectionSkeleton } from "@/components/loading";
import { TransferPanel } from "@/components/transfers/transfer-panel";
import { MarkTransferNoticesRead } from "@/components/transfers/mark-transfer-notices-read";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string; kind?: string }>;
}

/**
 * Cross-school transfers: send learners, teachers and ARAL volunteers to
 * another school in the division, and accept or decline what others sent.
 */
export default async function SchoolHeadTransferPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { view } = await resolveSchoolHeadView(raw.schoolId, SCHOOL_HEAD_ROUTES.transfer);
  const { param } = parseTransferKind(raw.kind);

  return (
    <SchoolHeadPage
      title="Transfer"
      view={view}
      superAdminCaption="can transfer — every change is audited"
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={ArrowRightLeft}
          title="Transfer"
          subtitle="Send learners, teachers and ARAL volunteers to another school in your division. Nobody moves until that school accepts."
        />
      }
    >
      {/* Opening the page answers the bell, in the browser only; a Super Admin's look leaves it alone. */}
      {view.isSuperAdminView ? null : <MarkTransferNoticesRead />}
      <Suspense key={param} fallback={<TableSectionSkeleton rows={8} columns={4} />}>
        <TransferPanel
          schoolId={view.schoolId}
          kindParam={param}
          kindHref={(p) => schoolHeadHref(view, `${SCHOOL_HEAD_ROUTES.transfer}?kind=${p}`)}
        />
      </Suspense>
    </SchoolHeadPage>
  );
}
