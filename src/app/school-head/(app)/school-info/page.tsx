import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolInfoForm } from "@/components/school-head/school-info-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolInfoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/school-info"
  );

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      name: true,
      schoolIdCode: true,
      address: true,
      region: true,
      division: true,
      district: true,
    },
  });
  if (!school) redirect("/school-head");

  return (
    <AppShell
      title={isSuperAdminView ? `School info — ${school.name}` : "School information"}
      subtitle="Update school display details. School ID is fixed."
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={school.name}
    >
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">School details</CardTitle>
        </CardHeader>
        <CardContent>
          {isSuperAdminView ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{school.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">School ID</dt>
                <dd className="font-mono text-xs">{school.schoolIdCode}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{school.address || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Region</dt>
                <dd>{school.region || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Division</dt>
                <dd>{school.division || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">District</dt>
                <dd>{school.district || "—"}</dd>
              </div>
            </dl>
          ) : (
            <SchoolInfoForm school={school} />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
