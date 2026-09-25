import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AdminPage } from "@/components/admin/admin-page";
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
    <Surface as="section" className="min-w-0 rounded-2xl">
      <SurfaceHeader className="items-center">
        <h2 className="text-base font-semibold">Last 150 events</h2>
        <span className="text-xs text-muted-foreground">Times in UTC</span>
      </SurfaceHeader>
      {logs.length === 0 ? (
        <SurfaceBody>
          <EmptyState
            title="No audit events yet"
            description="Sensitive platform actions will appear here."
            icon={ScrollText}
          />
        </SurfaceBody>
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
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
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {when(log.timestamp)}
                    </TableCell>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {schoolLabel(log.schoolId)}
                    </TableCell>
                    <TableCell>{log.resource}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.resourceId ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Below lg: one stacked row per event, as on the School Head audit page. */}
          <ul className="divide-y divide-border/60 lg:hidden" aria-label="Audit events">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium text-foreground">{log.action}</span>
                  <span className="text-sm text-muted-foreground">{log.resource}</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {schoolLabel(log.schoolId)}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="whitespace-nowrap">{when(log.timestamp)}</span>
                  <span className="min-w-0 break-all font-mono">{log.resourceId ?? "—"}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Surface>
  );
}

export default async function AdminAuditPage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <AdminPage
      title="Platform audit"
      description="Recent audited actions across all schools."
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={5} />}>
        <AdminAuditTable />
      </Suspense>
    </AdminPage>
  );
}
