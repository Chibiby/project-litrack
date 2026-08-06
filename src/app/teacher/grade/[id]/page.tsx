import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
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
import {
  GRADE_LEVEL_LABELS,
  READING_PROFILE_LABELS,
  GENDER_LABELS,
} from "@/lib/constants/enum-labels";
import { LearnerForm } from "@/components/forms/learner-form";
import { AralToggleButton } from "@/components/aral-toggle-button";
import { LearnerArchiveButton } from "@/components/learners/learner-archive-button";
import { LearnerListToolbar } from "@/components/learners/learner-list-toolbar";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { EmptyState } from "@/components/dashboard";
import {
  parseLearnerListParams,
  totalPages as calcTotalPages,
} from "@/lib/learners/pagination";
import { ArrowLeft, Eye, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

interface TeacherGradePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    schoolId?: string;
    page?: string;
    q?: string;
    filter?: string;
    sort?: string;
  }>;
}

export default async function TeacherGradePage({
  params,
  searchParams,
}: TeacherGradePageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const list = parseLearnerListParams(sp);

  const gradeFilter = isSuperAdmin
    ? { id, deletedAt: null }
    : { id, deletedAt: null, teachers: { some: { id: user.id } } };

  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
  });
  if (!grade) notFound();

  const where: Prisma.LearnerWhereInput = {
    gradeLevelId: grade.id,
    deletedAt: null,
    ...(isSuperAdmin ? {} : { teacherId: user.id }),
  };

  if (list.filter === "archived") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
    if (list.filter === "aral") {
      where.isAralLearner = true;
    }
  }

  if (list.q) {
    where.fullName = { contains: list.q, mode: "insensitive" };
  }

  const orderBy: Prisma.LearnerOrderByWithRelationInput =
    list.sort === "age" ? { age: "asc" } : { fullName: "asc" };

  const [learners, totalCount, aralCount] = await Promise.all([
    prisma.learner.findMany({
      where,
      include: { section: { select: { id: true, name: true } } },
      orderBy,
      skip: list.skip,
      take: list.take,
    }),
    prisma.learner.count({ where }),
    prisma.learner.count({
      where: {
        gradeLevelId: grade.id,
        deletedAt: null,
        archivedAt: null,
        isAralLearner: true,
        ...(isSuperAdmin ? {} : { teacherId: user.id }),
      },
    }),
  ]);

  const pages = calcTotalPages(totalCount, list.pageSize);
  const showSection = learners.some((l) => l.section);

  return (
    <AppShell
      title={GRADE_LEVEL_LABELS[grade.type]}
      subtitle={`${totalCount} learner${totalCount === 1 ? "" : "s"} · ${aralCount} ARAL${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <div className="mb-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        {aralCount > 0 && (
          <Button asChild variant="outline">
            <Link href={`/teacher/aral/${grade.id}`}>Open ARAL Dashboard</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Card>
          <LearnerListToolbar
            gradeId={grade.id}
            q={list.q}
            filter={list.filter}
            sort={list.sort}
            schoolId={sp.schoolId}
          />
          <CardContent className="p-0">
            {learners.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={
                    list.filter === "archived"
                      ? "No archived learners"
                      : list.q
                        ? "No matching learners"
                        : "No learners yet"
                  }
                  description={
                    list.filter === "archived"
                      ? "Archived learners will appear here."
                      : "Add a learner using the form on the right."
                  }
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Gender</TableHead>
                    {showSection && <TableHead>Section</TableHead>}
                    <TableHead>English</TableHead>
                    <TableHead>Filipino</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {learners.map((l) => (
                    <TableRow
                      key={l.id}
                      className={l.archivedAt ? "opacity-70" : undefined}
                    >
                      <TableCell className="font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {l.fullName}
                          {l.isAralLearner && (
                            <Badge variant="violet">ARAL</Badge>
                          )}
                          {l.archivedAt && (
                            <Badge variant="outline">Archived</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>{l.age}</TableCell>
                      <TableCell>{GENDER_LABELS[l.gender]}</TableCell>
                      {showSection && (
                        <TableCell className="text-sm text-muted-foreground">
                          {l.section?.name ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-xs">
                        {READING_PROFILE_LABELS[l.englishReadingProfile]}
                      </TableCell>
                      <TableCell className="text-xs">
                        {READING_PROFILE_LABELS[l.filipinoReadingProfile]}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={`/teacher/grade/${grade.id}/learners/${l.id}`}
                            >
                              <Eye className="h-4 w-4" />
                              View
                            </Link>
                          </Button>
                          {!l.archivedAt && (
                            <>
                              <Button asChild size="sm" variant="ghost">
                                <Link
                                  href={`/teacher/grade/${grade.id}/learners/${l.id}/edit`}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </Link>
                              </Button>
                              {!isSuperAdmin && (
                                <AralToggleButton
                                  learnerId={l.id}
                                  isAral={l.isAralLearner}
                                />
                              )}
                            </>
                          )}
                          {!isSuperAdmin && (
                            <LearnerArchiveButton
                              learnerId={l.id}
                              archived={Boolean(l.archivedAt)}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <LearnerPagination
              basePath={`/teacher/grade/${grade.id}`}
              page={list.page}
              totalPages={pages}
              searchParams={{
                q: list.q || undefined,
                filter: list.filter !== "all" ? list.filter : undefined,
                sort: list.sort !== "name" ? list.sort : undefined,
                schoolId: sp.schoolId,
              }}
            />
          </CardContent>
        </Card>

        {!isSuperAdmin && (
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold mb-3">Add new learner</h2>
              <LearnerForm gradeLevelId={grade.id} />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
