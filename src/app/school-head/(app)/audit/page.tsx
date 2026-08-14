import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
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
          <Surface className="overflow-hidden">
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
          </Surface>
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

  const schoolName = await getSchoolName(schoolId);

  return (
    <AppShell
      title={
        isSuperAdminView
          ? `Audit — ${schoolName ?? ""}`
          : "School audit history"
      }
      subtitle="Recent audited actions for this school"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={4} />}>
        <SchoolAuditTable schoolId={schoolId} />
      </Suspense>
    </AppShell>
  );
}
