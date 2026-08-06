import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { CalendarRange, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminSchoolYearsPage() {
  const user = await requireUser("SUPER_ADMIN");

  const years = await prisma.schoolYear.findMany({
    include: { school: { select: { id: true, name: true } } },
    orderBy: [{ school: { name: "asc" } }, { startDate: "desc" }],
  });

  return (
    <AppShell
      title="School years"
      subtitle="Read-only oversight of school years across the platform"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All school years</CardTitle>
        </CardHeader>
        <CardContent>
          {years.length === 0 ? (
            <EmptyState
              title="No school years yet"
              description="School Heads create and activate years for their schools."
              icon={CalendarRange}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">School</th>
                    <th className="pb-2 pr-3 font-medium">Label</th>
                    <th className="pb-2 pr-3 font-medium">Range</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{y.school.name}</td>
                      <td className="py-2 pr-3">{y.label}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {y.startDate.toISOString().slice(0, 10)} →{" "}
                        {y.endDate.toISOString().slice(0, 10)}
                      </td>
                      <td className="py-2 pr-3">
                        {y.isActive ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                      </td>
                      <td className="py-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/school-head/school-years?schoolId=${y.school.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
