import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  SchoolHeadMetricsSection,
  SchoolHeadChartsSection,
  SchoolHeadRecentActivitySection,
} from "@/components/dashboard/school-head-dashboard-sections";
import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  DualListCardSkeleton,
} from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  CheckCircle2,
  ListChecks,
  Megaphone,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface SchoolHeadDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolHeadDashboard({
  searchParams,
}: SchoolHeadDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");

  if (!user.profileCompleted && user.role !== "SUPER_ADMIN")
    redirect("/school-head/profiling");

  // Redirects for missing school stay outside try/catch (NEXT_REDIRECT).
  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head"
  );

  // Fail-soft: name lookup must not 500 the whole dashboard when the pooler
  // is briefly exhausted (same class of issue as teacher soft-nav P2024).
  let schoolName: string | null = null;
  try {
    schoolName = await getSchoolName(schoolId);
  } catch (err) {
    console.error("[SchoolHeadDashboard] school name failed:", err);
  }

  const sh = (path: string) =>
    isSuperAdminView ? `${path}?schoolId=${schoolId}` : path;

  return (
    <AppShell
      title={
        isSuperAdminView
          ? `School: ${schoolName || "Unknown"}`
          : `Welcome, ${user.firstName}`
      }
      subtitle={
        isSuperAdminView
          ? "Super Admin View - School Head Dashboard"
          : "School Head dashboard"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <Suspense fallback={<MetricsGridSkeleton variant="school-head" />}>
        <SchoolHeadMetricsSection
          schoolId={schoolId}
          isSuperAdminView={isSuperAdminView}
        />
      </Suspense>

      {!isSuperAdminView ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/school-head/profiling">
              <CheckCircle2 className="mr-1 h-4 w-4" /> Profile
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/school-head/announcements">
              <Megaphone className="mr-1 h-4 w-4" /> Announcements
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/school-head/transfer">Transfer learner</Link>
          </Button>
        </div>
      ) : null}

      <Suspense
        fallback={
          <>
            <ChartSectionSkeleton columns={2} />
            <ChartSectionSkeleton columns={2} />
          </>
        }
      >
        <SchoolHeadChartsSection schoolId={schoolId} />
      </Suspense>

      <Suspense fallback={<DualListCardSkeleton />}>
        <SchoolHeadRecentActivitySection
          schoolId={schoolId}
          isSuperAdminView={isSuperAdminView}
        />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="h-5 w-5" /> Grade levels
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link href={sh("/school-head/grade-levels")}>
              Manage grade levels
            </Link>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Labels use DOCX grade set including Floating (
            {GRADE_LEVEL_LABELS.FLOATING}).
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
