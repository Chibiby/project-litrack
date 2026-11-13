import { Suspense } from "react";
import { requireDeveloperAdminPage } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AdminPage } from "@/components/admin/admin-page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
  NoValue,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { ScrollText } from "lucide-react";

export const dynamic = "force-dynamic";

async function AdminAuditTable() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 150,
  });

  const schoolIds = [
    ...new Set(logs.map((l) => l.schoolId).filter(Boolean)),
  ] as string[];
  const schools =
    schoolIds.length > 0
      ? await prisma.school.findMany({
          where: { id: { in: schoolIds } },
          select: { id: true, name: true },
        })
      : [];
  const schoolName = new Map(schools.map((s) => [s.id, s.name]));

  const when = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  const schoolLabel = (id: string | null) =>
    id ? (schoolName.get(id) ?? id.slice(0, 8)) : "—";

  return (
    <Surface as="section" className="min-w-0 rounded-lg">
      <SurfaceHeader className="items-center">
        <h2 className="text-base font-semibold">Last 150 events</h2>
        <span className="text-xs text-muted-foreground">Times in UTC</span>
      </SurfaceHeader>
      {logs.length === 0 ? (
        <SurfaceBody>
          <EmptyState
            title="No audit events yet"
            description="Security events across the platform will appear here."
            icon={ScrollText}
          />
        </SurfaceBody>
      ) : (
        <ResponsiveTable
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {when(log.timestamp)}
                    </TableCell>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell className="max-w-56 text-muted-foreground">
                      <CellText>{schoolLabel(log.schoolId)}</CellText>
                    </TableCell>
                    <TableCell>{log.resource}</TableCell>
                    <TableCell className="max-w-[8rem] font-mono text-xs text-muted-foreground">
                      {log.resourceId ? <CellText>{log.resourceId}</CellText> : <NoValue />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
          stacked={
            <StackedList aria-label="Audit events">
              {logs.map((log) => (
                <StackedRow
                  key={log.id}
                  title={log.action}
                  state={<span>{log.resource}</span>}
                  meta={
                    <>
                      <span className="truncate">{schoolLabel(log.schoolId)}</span>
                      <span className="shrink-0 tabular-nums">{when(log.timestamp)}</span>
                    </>
                  }
                  details={[
                    {
                      label: "Resource ID",
                      value: log.resourceId ? (
                        <span className="break-all font-mono text-xs">{log.resourceId}</span>
                      ) : (
                        <NoValue />
                      ),
                    },
                  ]}
                />
              ))}
            </StackedList>
          }
        />
      )}
    </Surface>
  );
}

export default async function AdminAuditPage() {
  const user = await requireDeveloperAdminPage();

  return (
    <AdminPage
      title="Platform audit"
      description="Recent audited actions across all schools. Only security events are recorded: sign-in failures, credential changes, account access, exports and deletions."
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={5} />}>
        <AdminAuditTable />
      </Suspense>
    </AdminPage>
  );
}
