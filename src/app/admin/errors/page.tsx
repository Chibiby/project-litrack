import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AdminPage } from "@/components/admin/admin-page";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { TableSectionSkeleton } from "@/components/loading";
import { ErrorLogFilters } from "@/components/admin/error-log-filters";
import { ErrorLogTable } from "@/components/admin/error-log-table";
import { buildErrorLogQuery, parseErrorLogParams } from "@/lib/admin/error-log";

export const dynamic = "force-dynamic";

type ErrorsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function ErrorLogSection({
  params,
}: {
  params: ReturnType<typeof parseErrorLogParams>;
}) {
  const events = await prisma.errorEvent.findMany({
    where: buildErrorLogQuery(params),
    orderBy: { createdAt: "desc" },
    take: 150,
  });

  const schoolIds = [...new Set(events.map((e) => e.schoolId).filter(Boolean))] as string[];
  const schools =
    schoolIds.length > 0
      ? await prisma.school.findMany({
          where: { id: { in: schoolIds } },
          select: { id: true, name: true, isDemo: true },
        })
      : [];
  const schoolById = new Map(schools.map((s) => [s.id, s]));

  const rows = events.map((event) => {
    const school = event.schoolId ? schoolById.get(event.schoolId) : undefined;
    return {
      id: event.id,
      createdAt: event.createdAt,
      code: event.code,
      severity: event.severity,
      message: event.message,
      context: event.context,
      stack: event.stack,
      route: event.route,
      routeType: event.routeType,
      schoolId: event.schoolId,
      schoolName: school?.name ?? null,
      isDemoSchool: school?.isDemo ?? false,
      userId: event.userId,
      ref: event.ref,
    };
  });

  return <ErrorLogTable events={rows} hasRefFilter={Boolean(params.ref)} />;
}

/**
 * Where a reference quoted by a user gets resolved.
 *
 * Super Admin only, and deliberately so: the rows can carry a database message
 * naming a column or a value, which is why the table is RLS deny-all and purged
 * on a schedule.
 */
export default async function AdminErrorsPage({ searchParams }: ErrorsPageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = parseErrorLogParams(await searchParams);

  return (
    <AdminPage
      title="Error log"
      description="Server-side failures and refused requests across all schools."
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceHeader className="flex-col items-stretch gap-3">
          <h2 className="text-base font-semibold">
            {params.ref ? `Reference ${params.ref}` : `Last 150 events`}
          </h2>
          <ErrorLogFilters
            refFilter={params.ref}
            code={params.code}
            severity={params.severity}
            window={params.window}
          />
        </SurfaceHeader>
        <SurfaceBody className="p-0 lg:p-2">
          <Suspense fallback={<TableSectionSkeleton rows={10} columns={6} />}>
            <ErrorLogSection params={params} />
          </Suspense>
        </SurfaceBody>
      </Surface>
    </AdminPage>
  );
}
