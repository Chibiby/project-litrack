import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdminScope, loadSchoolInScope } from "@/lib/auth/district-scope";
import { isAppError } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";
import { DISTRICT_ROUTES, DISTRICT_SUMMARY_FACETS } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolActiveToggle } from "@/components/admin/school-active-toggle";
import { DistrictSchoolForm } from "@/components/district/district-school-form";
import { SchoolHeadReset } from "@/components/district/school-head-reset";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ schoolId: string }>;
}

const SCHOOL_SELECT = {
  id: true,
  name: true,
  schoolIdCode: true,
  address: true,
  region: true,
  division: true,
  district: true,
  isActive: true,
} as const;

export default async function DistrictSchoolPage({ params }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const { schoolId } = await params;

  let school;
  try {
    school = await loadSchoolInScope(scope, schoolId, SCHOOL_SELECT);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") {
      // Out-of-scope ids look exactly like missing ones to the person; only
      // the admin error log (severity `security`) tells the two apart.
      if (err.severity === "security") {
        reportError(err, { route: "/district/schools/[schoolId]", routeType: "render" });
      }
      notFound();
    }
    throw err;
  }

  return (
    <AppShell
      title={school.name}
      subtitle={`School ID ${school.schoolIdCode}${school.district ? ` · ${school.district}` : ""}`}
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="sm:h-10 lg:h-9">
          <Link href={DISTRICT_ROUTES.schools}>
            <ChevronLeft aria-hidden />
            All schools
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">School details</CardTitle>
          </CardHeader>
          <CardContent>
            <DistrictSchoolForm
              school={school}
              canEditPlacement={scope.kind === "division"}
            />
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
              <CardDescription>
                While a school is inactive, nobody from it can sign in.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              {school.isActive ? (
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
              <SchoolActiveToggle
                schoolId={school.id}
                isActive={school.isActive}
                schoolName={school.name}
                className="sm:h-10 lg:h-9"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">School Head sign-in</CardTitle>
            </CardHeader>
            <CardContent>
              <SchoolHeadReset schoolId={school.id} schoolName={school.name} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" aria-hidden />
                This school&apos;s figures
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-0 sm:p-3 sm:pt-0">
              <ul>
                {DISTRICT_SUMMARY_FACETS.map((facet) => (
                  <li key={facet.id}>
                    <Link
                      href={`${DISTRICT_ROUTES.summary(facet.id)}?schoolId=${school.id}`}
                      className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10"
                    >
                      <span className="min-w-0 truncate">{facet.label}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
