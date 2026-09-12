import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { ErrorLogFilters } from "@/components/admin/error-log-filters";
import { buildErrorLogQuery, parseErrorLogParams } from "@/lib/admin/error-log";
import { errorRetentionDays } from "@/lib/errors/retention";
import { TriangleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

type ErrorsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function ErrorLogTable({
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
          select: { id: true, name: true },
        })
      : [];
  const schoolName = new Map(schools.map((s) => [s.id, s.name]));

  if (events.length === 0) {
    return (
      <EmptyState
        title={params.ref ? "No event with that reference" : "No errors recorded"}
        description={
          params.ref
            ? `Nothing matches ${params.ref}. Check the reference, or widen the period — records are kept for ${errorRetentionDays()} days.`
            : "Server-side failures and refused requests will appear here."
        }
        icon={TriangleAlert}
      />
    );
  }

  return (
    <Surface className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>School</TableHead>
            <TableHead>Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                {event.createdAt.toISOString().replace("T", " ").slice(0, 19)}
              </TableCell>
              <TableCell className="align-top font-medium">
                {event.code}
                {/* The detail lives inline rather than behind a dialog: an admin
                    reading this page is already trying to answer one question,
                    and a stack is the answer. */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-normal text-muted-foreground">
                    Details
                  </summary>
                  <div className="mt-2 space-y-2 text-xs font-normal">
                    <p className="whitespace-pre-wrap text-muted-foreground">{event.message}</p>
                    {event.context ? (
                      <pre className="overflow-x-auto rounded-md bg-muted p-2 text-muted-foreground">
                        {JSON.stringify(event.context, null, 2)}
                      </pre>
                    ) : null}
                    {event.stack ? (
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-muted-foreground">
                        {event.stack}
                      </pre>
                    ) : null}
                    {event.userId ? (
                      <p className="font-mono text-muted-foreground">user {event.userId}</p>
                    ) : null}
                  </div>
                </details>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={event.severity === "system" ? "destructive" : "secondary"}>
                  {event.severity}
                </Badge>
              </TableCell>
              <TableCell className="align-top text-xs text-muted-foreground">
                {event.route ?? "—"}
                {event.routeType ? (
                  <span className="block text-[11px] opacity-70">{event.routeType}</span>
                ) : null}
              </TableCell>
              <TableCell className="align-top text-muted-foreground">
                {event.schoolId
                  ? (schoolName.get(event.schoolId) ?? event.schoolId.slice(0, 8))
                  : "—"}
              </TableCell>
              <TableCell className="align-top font-mono text-xs">{event.ref}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Surface>
  );
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
    <AppShell
      title="Errors"
      subtitle="Server-side failures and refused requests across all schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {params.ref ? `Reference ${params.ref}` : `Last 150 events`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ErrorLogFilters
            ref={params.ref}
            code={params.code}
            severity={params.severity}
            window={params.window}
          />
          <Suspense fallback={<TableSectionSkeleton rows={10} columns={6} />}>
            <ErrorLogTable params={params} />
          </Suspense>
        </CardContent>
      </Card>
    </AppShell>
  );
}
