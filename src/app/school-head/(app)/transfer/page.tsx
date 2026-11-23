import { Suspense } from "react";
import { ArrowRightLeft } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { markSchoolTransferNoticesRead } from "@/lib/transfers/notify";
import { parseTransferKind } from "@/lib/transfers/queries";
import { SchoolHeadPage, schoolHeadHref } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { TableSectionSkeleton } from "@/components/loading";
import { TransferPanel } from "@/components/transfers/transfer-panel";

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
  const { user, view } = await resolveSchoolHeadView(raw.schoolId, SCHOOL_HEAD_ROUTES.transfer);
  const { param } = parseTransferKind(raw.kind);

  // Opening the page answers the bell. A Super Admin's look leaves it alone.
  if (!view.isSuperAdminView) {
    await markSchoolTransferNoticesRead({ recipientId: user.id, schoolId: view.schoolId }).catch((err) =>
      console.error("[SchoolHeadTransferPage] mark notices read failed:", err)
    );
  }

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
