import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { CalendarRange, ExternalLink } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

export const dynamic = "force-dynamic";

function StatusBadge({ active }: { active: boolean }) {
  return active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>;
}

export default async function AdminSchoolYearsPage() {
  const user = await requireUser("SUPER_ADMIN");

  const years = await prisma.schoolYear.findMany({
    include: { school: { select: { id: true, name: true } } },
    orderBy: [{ school: { name: "asc" } }, { startDate: "desc" }],
  });

  const range = (y: (typeof years)[number]) =>
    `${y.startDate.toISOString().slice(0, 10)} → ${y.endDate.toISOString().slice(0, 10)}`;
  const openHref = (schoolId: string) => `${SCHOOL_HEAD_ROUTES.schoolYears}?schoolId=${schoolId}`;

  return (
    <AdminPage
      title="School years"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Calendar"
          eyebrowIcon={CalendarRange}
          title="School years"
          subtitle="Read-only oversight of every school's years. School Heads create and activate their own."
          meta={`${years.length} school year${years.length === 1 ? "" : "s"} · ${years.filter((y) => y.isActive).length} active`}
        />
      }
    >
      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">All school years</h2>
        </SurfaceHeader>
        {years.length === 0 ? (
          <SurfaceBody>
            <EmptyState
              title="No school years yet"
              description="School Heads create and activate years for their schools."
              icon={CalendarRange}
            />
          </SurfaceBody>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {years.map((y) => (
                    <TableRow key={y.id}>
                      <TableCell className="font-medium">{y.school.name}</TableCell>
                      <TableCell>{y.label}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {range(y)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={y.isActive} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="icon" className="lg:size-9">
                          <Link
                            href={openHref(y.school.id)}
                            aria-label={`Open ${y.school.name}'s school years`}
                          >
                            <ExternalLink aria-hidden />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border/60 lg:hidden" aria-label="School years">
              {years.map((y) => (
                <li key={y.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{y.school.name}</span>
                      <StatusBadge active={y.isActive} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{y.label}</p>
                    <p className="text-xs text-muted-foreground">{range(y)}</p>
                  </div>
                  <Button asChild variant="ghost" size="icon" className="shrink-0">
                    <Link
                      href={openHref(y.school.id)}
                      aria-label={`Open ${y.school.name}'s school years`}
                    >
                      <ExternalLink aria-hidden />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Surface>
    </AdminPage>
  );
}
