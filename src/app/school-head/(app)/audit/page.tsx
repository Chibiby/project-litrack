import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { ScrollText } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function SchoolAuditTable({ schoolId }: { schoolId: string }) {
  const logs = await prisma.auditLog.findMany({
    where: { schoolId },
    orderBy: { timestamp: "desc" },
    take: 100,
  });

  return (
    <Surface as="section">
      <SurfaceHeader>
        <h2 className="text-base font-semibold">Last 100 events</h2>
      </SurfaceHeader>
      {logs.length === 0 ? (
        <SurfaceBody>
          <EmptyState
            title="Nothing audited yet"
            description="Changes made in this school will be recorded here."
            icon={ScrollText}
          />
        </SurfaceBody>
      ) : (
        // The table is wider than a phone. It scrolls in its own container so the
        // page body never scrolls sideways.
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {log.timestamp
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}
                  </TableCell>
                  <TableCell className="font-medium">{log.action}</TableCell>
                  <TableCell>{log.resource}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {log.resourceId ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Surface>
  );
}

export default async function SchoolAuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.audit
  );

  return (
    <SchoolHeadPage
      title="Audit history"
      description="The most recent audited actions in your school. Timestamps are UTC."
      view={view}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={4} />}>
        <SchoolAuditTable schoolId={view.schoolId} />
      </Suspense>
    </SchoolHeadPage>
  );
}
