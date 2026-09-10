import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { SchoolDetailView } from "@/components/admin/school-detail-view";
import { getSchoolDetail } from "@/lib/admin/school-detail";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<{ learners?: string }>;
}

/**
 * One school, in full: its profile, its teachers, its learners.
 *
 * The page an admin opens to find out what is actually inside a school before
 * deciding whether any of it should stay — which is why nothing here is cached
 * and why the removal controls sit next to the rows rather than on a separate
 * screen.
 */
export default async function SchoolDetailPage({ params, searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const { schoolId } = await params;
  const { learners } = await searchParams;

  const page = Number.parseInt(learners ?? "1", 10);
  const detail = await getSchoolDetail(schoolId, Number.isNaN(page) ? 1 : page);
  if (!detail) notFound();

  return (
    <AppShell
      title={detail.school.name}
      subtitle={`School ID ${detail.school.schoolIdCode}`}
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/schools">
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
            All schools
          </Link>
        </Button>
      </div>

      <SchoolDetailView detail={detail} />
    </AppShell>
  );
}
