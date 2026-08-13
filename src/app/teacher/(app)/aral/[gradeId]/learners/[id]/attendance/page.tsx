import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/constants/enum-labels";
import { EmptyState } from "@/components/dashboard";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { getAralActionWarmHrefs } from "@/lib/nav/warm-hrefs";
import { teacherLearnerScope } from "@/lib/teachers/scope";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface AttendancePageProps {
  params: Promise<{ gradeId: string; id: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function AttendancePage({
  params,
  searchParams,
}: AttendancePageProps) {
  const { gradeId, id } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const learnerFilter: Prisma.LearnerWhereInput = isSuperAdmin
    ? { id, deletedAt: null }
    : {
        id,
        schoolId: user.schoolId ?? undefined,
        deletedAt: null,
        ...teacherLearnerScope(user.id),
      };

  const learner = await prisma.learner.findFirst({
    where: learnerFilter,
  });
  if (!learner) notFound();
  if (learner.gradeLevelId !== gradeId) notFound();

  const attendances = await prisma.attendance.findMany({
    where: { learnerId: learner.id },
    orderBy: { date: "desc" },
    take: 60,
  });

  const nestedWarmHrefs = getAralActionWarmHrefs(gradeId, learner.id);
  const nestedWarmKey = `teacher:aral-action:${learner.id}:nested`;
  const gradeGridHref = sp.schoolId
    ? `/teacher/aral/${gradeId}/attendance?schoolId=${sp.schoolId}`
    : `/teacher/aral/${gradeId}/attendance`;

  return (
    <AppShell
      title={`Attendance — ${learner.fullName}`}
      subtitle={`Recent attendance history${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <NavPrefetcher cacheKey={nestedWarmKey} hrefs={nestedWarmHrefs} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/aral?grade=${gradeId}`} prefetch={true}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={gradeGridHref}>Grade-wide attendance</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {attendances.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No attendance recorded yet"
                description="Mark daily attendance from the grade-wide attendance page."
                actionHref={gradeGridHref}
                actionLabel="Open grade grid"
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendances.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.date.toLocaleDateString()}</TableCell>
                    <TableCell>{ATTENDANCE_STATUS_LABELS[a.status]}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {a.notes ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
