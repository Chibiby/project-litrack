import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AralActionsMenu } from "@/components/aral-actions-menu";
import { StatusBadge } from "@/components/status-badge";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { ArrowLeft, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

interface AralDashboardProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function AralDashboard({ params, searchParams }: AralDashboardProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const gradeFilter = isSuperAdmin
    ? { id: gradeId, deletedAt: null }
    : { id: gradeId, deletedAt: null, teachers: { some: { id: user.id } } };

  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
    include: {
      learners: {
        where: { isAralLearner: true, deletedAt: null },
        include: { aralProfile: { select: { id: true, updatedAt: true } } },
        orderBy: { fullName: "asc" },
      },
    },
  });
  if (!grade) notFound();

  return (
    <AppShell
      title={`ARAL Dashboard — ${GRADE_LEVEL_LABELS[grade.type]}`}
      subtitle={`${grade.learners.length} ARAL learner${grade.learners.length === 1 ? "" : "s"}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/grade/${grade.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to grade
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Learner</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Profile complete?</TableHead>
                <TableHead>Last update</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grade.learners.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No ARAL learners.
                  </TableCell>
                </TableRow>
              ) : (
                grade.learners.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />
                        {l.fullName}
                      </span>
                    </TableCell>
                    <TableCell>{l.age}</TableCell>
                    <TableCell>
                      {l.aralProfile ? (
                        <StatusBadge tone="success" label="Complete" />
                      ) : (
                        <StatusBadge tone="warning" label="Pending" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.aralProfile?.updatedAt.toLocaleDateString() ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <AralActionsMenu
                        gradeId={grade.id}
                        learnerId={l.id}
                        learnerName={l.fullName}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
