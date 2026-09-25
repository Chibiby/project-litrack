import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { Button } from "@/components/ui/button";
import { SchoolDetailView } from "@/components/admin/school-detail-view";
import { getSchoolDetail } from "@/lib/admin/school-detail";
import { ChevronLeft, School } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<{ learners?: string; learnersSort?: string }>;
}

/**
 * One school, in full: its profile, its teachers, its learners.
 *
 * The page an admin opens to find out what is actually inside a school before
 * deciding whether any of it should stay — which is why nothing here is cached
 * and why the removal controls sit next to the rows rather than on a separate
 * screen.
 *
 * `SchoolDetailView` owns the Learners panel's keyed `<Suspense>` boundary
 * (built from the raw `searchParams` passed straight through below) and its
 * own `ListNavigationProvider`/`ListBusyRegion` pair, so paging or re-sorting
 * that roster shows a skeleton over just that table. The (unpaginated,
 * client-sorted) Teachers table never re-fetches, so it has no equivalent —
 * see `SchoolDetailView`'s own comment.
 */
export default async function SchoolDetailPage({ params, searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const { schoolId } = await params;
  const sp = await searchParams;
  const { learners, learnersSort } = sp;

  const page = Number.parseInt(learners ?? "1", 10);
  const detail = await getSchoolDetail(
    schoolId,
    Number.isNaN(page) ? 1 : page,
    learnersSort
  );
  if (!detail) notFound();

  return (
    <AdminPage
      title={detail.school.name}
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="School"
          eyebrowIcon={School}
          title={detail.school.name}
          subtitle={`School ID ${detail.school.schoolIdCode}`}
          meta={[detail.school.district, detail.school.division]
            .filter((part): part is string => Boolean(part?.trim()))
            .join(" · ") || undefined}
          topRight={
            <Button asChild variant="ghost" size="sm" className="sm:h-10 lg:h-9">
              <Link href="/admin/schools">
                <ChevronLeft aria-hidden />
                <span className="max-sm:sr-only">All schools</span>
              </Link>
            </Button>
          }
        />
      }
    >
      <SchoolDetailView detail={detail} searchParams={sp} />
    </AdminPage>
  );
}
