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
import { Surface } from "@/components/ui/surface";
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Last 150 events</CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            description="Sensitive platform actions will appear here."
            icon={ScrollText}
          />
        ) : (
          <Surface className="overflow-hidden">
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
                      {log.timestamp
                        .toISOString()
                        .replace("T", " ")
                        .slice(0, 19)}
                    </TableCell>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.schoolId
                        ? (schoolName.get(log.schoolId) ??
                          log.schoolId.slice(0, 8))
                        : "—"}
                    </TableCell>
                    <TableCell>{log.resource}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.resourceId ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Surface>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminAuditPage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <AppShell
      title="Platform audit"
      subtitle="Recent audited actions across all schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={5} />}>
        <AdminAuditTable />
      </Suspense>
    </AppShell>
  );
}
