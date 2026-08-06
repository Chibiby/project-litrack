import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Last 100 events</CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            description="Mutations for this school will appear here."
            icon={ScrollText}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">When</th>
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 pr-4 font-medium">Resource</th>
                  <th className="pb-2 font-medium">ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 whitespace-nowrap text-xs text-muted-foreground">
                      {log.timestamp
                        .toISOString()
                        .replace("T", " ")
                        .slice(0, 19)}
                    </td>
                    <td className="py-2 pr-4 font-medium">{log.action}</td>
                    <td className="py-2 pr-4">{log.resource}</td>
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

export default async function SchoolAuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN")
    redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/audit"
  );

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });

  return (
    <AppShell
      title={
        isSuperAdminView
          ? `Audit — ${school?.name ?? ""}`
          : "School audit history"
      }
      subtitle="Recent audited actions for this school"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={school?.name}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={4} />}>
        <SchoolAuditTable schoolId={schoolId} />
      </Suspense>
    </AppShell>
  );
}
