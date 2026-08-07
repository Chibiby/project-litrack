import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard";
import { TableSectionSkeleton } from "@/components/loading";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getAralLearnerWarmHrefs } from "@/lib/nav/warm-hrefs";
import { ArrowLeft, Edit3, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

interface AralDashboardProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

async function AralLearnersTable({
  gradeId,
  teacherId,
  isSuperAdmin,
}: {
  gradeId: string;
  teacherId: string;
  isSuperAdmin: boolean;
}) {
  const learners = await prisma.learner.findMany({
    where: {
      gradeLevelId: gradeId,
      isAralLearner: true,
      deletedAt: null,
      archivedAt: null,
      ...(isSuperAdmin ? {} : { teacherId }),
    },
    include: { aralProfile: { select: { id: true, updatedAt: true } } },
    orderBy: { fullName: "asc" },
  });

  const nestedWarmHrefs = getAralLearnerWarmHrefs(
    gradeId,
    learners.map((l) => l.id)
  );
  const nestedWarmKey = `teacher:aral:${gradeId}:nested:${nestedWarmHrefs.join("|")}`;

  return (
    <>
      <NavPrefetcher cacheKey={nestedWarmKey} hrefs={nestedWarmHrefs} />
      <Card>
        <CardContent className="p-0">
          {learners.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No ARAL learners." />
            </div>
          ) : (
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
                {learners.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-3 w-3 text-violet" /> {l.fullName}
                      </span>
                    </TableCell>
                    <TableCell>{l.age}</TableCell>
                    <TableCell>
                      {l.aralProfile ? (
                        <Badge variant="violet">Complete</Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {l.aralProfile?.updatedAt.toLocaleDateString() ?? "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button asChild size="sm">
                        <Link
                          href={`/teacher/aral/${gradeId}/learners/${l.id}/update`}
                        >
                          <Edit3 className="h-4 w-4" /> Update Data
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/teacher/aral/${gradeId}/learners/${l.id}/attendance`}
                        >
                          Attendance
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/teacher/aral/${gradeId}/learners/${l.id}/reading-level`}
                        >
                          Reading Level
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default async function AralDashboard({
  params,
  searchParams,
}: AralDashboardProps) {
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
  });
  if (!grade) notFound();

  const aralCount = await prisma.learner.count({
    where: {
      gradeLevelId: grade.id,
      isAralLearner: true,
      deletedAt: null,
      archivedAt: null,
      ...(isSuperAdmin ? {} : { teacherId: user.id }),
    },
  });

  return (
    <AppShell
      title={`ARAL Dashboard — ${GRADE_LEVEL_LABELS[grade.type]}`}
      subtitle={`${aralCount} ARAL learner${aralCount === 1 ? "" : "s"}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/grade/${grade.id}`}>
            <ArrowLeft className="h-4 w-4" /> Back to grade
          </Link>
        </Button>
      </div>

      <Suspense fallback={<TableSectionSkeleton rows={8} columns={5} />}>
        <AralLearnersTable
          gradeId={grade.id}
          teacherId={user.id}
          isSuperAdmin={isSuperAdmin}
        />
      </Suspense>
    </AppShell>
  );
}
