import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { AttendanceMarkForm } from "@/components/forms/attendance-mark-form";
import { EmptyState } from "@/components/dashboard";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { getAralActionWarmHrefs } from "@/lib/nav/warm-hrefs";
import { ArrowLeft } from "lucide-react";
import { getMonday } from "@/lib/utils";

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

  const learnerFilter = isSuperAdmin
    ? { id, deletedAt: null }
    : { id, teacherId: user.id, deletedAt: null };

  const learner = await prisma.learner.findFirst({
    where: learnerFilter,
  });
  if (!learner) notFound();
  if (learner.gradeLevelId !== gradeId) notFound();

  const weekStart = getMonday(new Date());

  const attendances = await prisma.attendance.findMany({
    where: { learnerId: learner.id, weekStart },
    orderBy: { date: "asc" },
  });

  const canMark = learner.isAralLearner && !isSuperAdmin;
  const nestedWarmHrefs = getAralActionWarmHrefs(gradeId, learner.id);
  const nestedWarmKey = `teacher:aral-action:${learner.id}:nested`;

  return (
    <AppShell
      title={`Attendance — ${learner.fullName}`}
      subtitle={`Week of ${weekStart.toLocaleDateString()}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <NavPrefetcher cacheKey={nestedWarmKey} hrefs={nestedWarmHrefs} />
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/aral/${gradeId}`} prefetch={true}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="p-0">
            {attendances.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No attendance recorded this week" />
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

        <Card>
          <CardContent className="pt-6">
            <h2 className="font-semibold mb-3">Mark attendance</h2>
            {canMark ? (
              <AttendanceMarkForm learnerId={learner.id} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {isSuperAdmin
                  ? "Admin view is read-only."
                  : "Attendance marking is available for ARAL learners only. History remains readable if ARAL status changes later."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
