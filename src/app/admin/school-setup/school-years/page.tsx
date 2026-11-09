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
  CellText,
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
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

function OpenYearsButton({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  return (
    <Button asChild variant="ghost" size="icon" className="size-9 shrink-0">
      <Link
        href={`${SCHOOL_HEAD_ROUTES.schoolYears}?schoolId=${schoolId}`}
        aria-label={`Open ${schoolName}'s school years`}
      >
        <ExternalLink aria-hidden />
      </Link>
    </Button>
  );
}

export default async function AdminSchoolYearsPage() {
  const user = await requireUser("SUPER_ADMIN");

  const years = await prisma.schoolYear.findMany({
    include: { school: { select: { id: true, name: true } } },
    orderBy: [{ school: { name: "asc" } }, { startDate: "desc" }],
  });

  const range = (y: (typeof years)[number]) =>
    `${y.startDate.toISOString().slice(0, 10)} → ${y.endDate.toISOString().slice(0, 10)}`;

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
      <Surface as="section" className="min-w-0 rounded-lg">
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
          <ResponsiveTable
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {years.map((y) => (
                    <TableRow key={y.id}>
                      <TableCell className="max-w-[18rem] font-medium">
                        <CellText>{y.school.name}</CellText>
                      </TableCell>
                      <TableCell>{y.label}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {range(y)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={y.isActive} />
                      </TableCell>
                      <TableCell>
                        <RowActions>
                          <OpenYearsButton schoolId={y.school.id} schoolName={y.school.name} />
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            stacked={
              <StackedList aria-label="School years">
                {years.map((y) => (
                  <StackedRow
                    key={y.id}
                    title={y.school.name}
                    value={<span className="font-medium">{y.label}</span>}
                    state={<StatusBadge active={y.isActive} />}
                    meta={<span className="tabular-nums">{range(y)}</span>}
                    actions={<OpenYearsButton schoolId={y.school.id} schoolName={y.school.name} />}
                  />
                ))}
              </StackedList>
            }
          />
        )}
      </Surface>
    </AdminPage>
  );
}
