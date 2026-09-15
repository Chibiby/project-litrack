import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { ARAL_PROFILING_HREF } from "@/lib/nav/nav-config";
import { aralLearnerScope } from "@/lib/teachers/scope";
import { LEARNER_PAGE_SIZE, totalPages } from "@/lib/learners/pagination";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * ARAL Profiling — Sections C, D and E for every ARAL learner this teacher is the
 * designated tutor for, across all their grades.
 *
 * Tutor scope (`aralLearnerScope`), not the wider care scope: `saveAralProfile`
 * only accepts the designated tutor, so listing anyone else would offer a button
 * that can only fail. The dashboard's "Pending Profiles" count uses the same
 * scope, so the card and the Pending tab here always agree.
 */

const STATUSES = ["all", "pending", "completed"] as const;
type ProfilingStatus = (typeof STATUSES)[number];

const STATUS_LABELS: Record<ProfilingStatus, string> = {
  all: "All",
  pending: "Pending",
  completed: "Completed",
};

function parseStatus(raw: string | undefined): ProfilingStatus {
  return STATUSES.includes(raw as ProfilingStatus) ? (raw as ProfilingStatus) : "all";
}

function statusWhere(status: ProfilingStatus): Prisma.LearnerWhereInput {
  if (status === "pending") return { aralProfile: null };
  if (status === "completed") return { aralProfile: { isNot: null } };
  return {};
}

function statusHref(status: ProfilingStatus, schoolId?: string): string {
  const qs = new URLSearchParams();
  if (status !== "all") qs.set("status", status);
  if (schoolId) qs.set("schoolId", schoolId);
  const s = qs.toString();
  return s ? `${ARAL_PROFILING_HREF}?${s}` : ARAL_PROFILING_HREF;
}

const dateFormat = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});

interface PageProps {
  searchParams: Promise<{ schoolId?: string; status?: string; page?: string }>;
}

async function ProfilingTable({
  where,
  totalCount,
  page,
  pages,
  status,
  canEdit,
  schoolIdParam,
}: {
  where: Prisma.LearnerWhereInput;
  totalCount: number;
  page: number;
  pages: number;
  status: ProfilingStatus;
  canEdit: boolean;
  schoolIdParam?: string;
}) {
  const learners = await prisma.learner.findMany({
    relationLoadStrategy: "join",
    where,
    select: {
      id: true,
      fullName: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
      section: { select: { name: true } },
      aralProfile: { select: { updatedAt: true } },
    },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    skip: (page - 1) * LEARNER_PAGE_SIZE,
    take: LEARNER_PAGE_SIZE,
  });

  return (
    <Card>
      <CardContent className="p-0">
        {totalCount === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                status === "pending"
                  ? "Every ARAL learner has a profile"
                  : status === "completed"
                    ? "No completed profiles yet"
                    : "No ARAL learners"
              }
              description={
                status === "all"
                  ? "Learners you tutor in the ARAL program appear here."
                  : "Switch tabs to see the other learners."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Learner</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Last updated</TableHead>
                  {canEdit && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {learners.map((l) => {
                  const done = l.aralProfile !== null;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.fullName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {l.section?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={done ? "violet" : "outline"}>
                          {done ? "Completed" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {l.aralProfile ? dateFormat.format(l.aralProfile.updatedAt) : "—"}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant={done ? "outline" : "default"}>
                            <Link href={`/teacher/aral/${l.gradeLevelId}/learners/${l.id}/update`}>
                              {done ? "Update profile" : "Complete profile"}
                            </Link>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <LearnerPagination
          basePath={ARAL_PROFILING_HREF}
          page={page}
          totalPages={pages}
          searchParams={{
            status: status !== "all" ? status : undefined,
            schoolId: schoolIdParam,
          }}
        />
      </CardContent>
    </Card>
  );
}

export default async function AralProfilingPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const schoolId = (isSuperAdmin ? sp.schoolId : user.schoolId) ?? user.schoolId;
  if (!schoolId) redirect("/login");

  const status = parseStatus(sp.status);
  const baseWhere: Prisma.LearnerWhereInput = {
    schoolId,
    isAralLearner: true,
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : aralLearnerScope(user.id)),
  };

  const [allCount, pendingCount] = await Promise.all([
    prisma.learner.count({ where: baseWhere }),
    prisma.learner.count({ where: { ...baseWhere, aralProfile: null } }),
  ]);
  const counts: Record<ProfilingStatus, number> = {
    all: allCount,
    pending: pendingCount,
    completed: allCount - pendingCount,
  };

  const totalCount = counts[status];
  const pages = totalPages(totalCount, LEARNER_PAGE_SIZE);
  const rawPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Math.min(Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1, pages);

  return (
    <AppShell
      title="ARAL Profiling"
      subtitle={`${pendingCount} of ${allCount} ARAL learner${allCount === 1 ? "" : "s"} still need a profile${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Sections C to E: reading behavior, outside factors and suggested
        interventions. Absences are not asked here, because Weekly Attendance
        already records them.
      </p>

      <nav aria-label="Profile status" className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={statusHref(s, sp.schoolId)}
            aria-current={s === status ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              s === status
                ? "border-violet bg-violet-soft text-violet"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {STATUS_LABELS[s]}
            <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums text-foreground">
              {counts[s]}
            </span>
          </Link>
        ))}
      </nav>

      <Suspense key={`${status}:${page}`} fallback={<TableSectionSkeleton rows={8} columns={6} />}>
        <ProfilingTable
          where={{ ...baseWhere, ...statusWhere(status) }}
          totalCount={totalCount}
          page={page}
          pages={pages}
          status={status}
          canEdit={!isSuperAdmin}
          schoolIdParam={sp.schoolId}
        />
      </Suspense>
    </AppShell>
  );
}
