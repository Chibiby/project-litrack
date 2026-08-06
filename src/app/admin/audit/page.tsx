import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">When</th>
                  <th className="pb-2 pr-3 font-medium">Action</th>
                  <th className="pb-2 pr-3 font-medium">School</th>
                  <th className="pb-2 pr-3 font-medium">Resource</th>
                  <th className="pb-2 font-medium">ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                      {log.timestamp
                        .toISOString()
                        .replace("T", " ")
                        .slice(0, 19)}
                    </td>
                    <td className="py-2 pr-3 font-medium">{log.action}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {log.schoolId
                        ? (schoolName.get(log.schoolId) ??
                          log.schoolId.slice(0, 8))
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">{log.resource}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {log.resourceId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
