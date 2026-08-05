import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { InviteTeacherForm } from "@/components/forms/invite-teacher-form";

export const dynamic = "force-dynamic";

interface TeachersPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function TeachersPage({ searchParams }: TeachersPageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  
  // Super Admin can view any school via query param
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const targetSchoolId = isSuperAdmin && params.schoolId ? params.schoolId : user.schoolId;
  
  if (!user.profileCompleted && !isSuperAdmin) redirect("/school-head/profiling");
  if (!targetSchoolId) redirect("/login");

  const [grades, teachers, school] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId: targetSchoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { schoolId: targetSchoolId, role: "TEACHER", deletedAt: null },
      include: { taughtGrades: { select: { type: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.school.findUnique({
      where: { id: targetSchoolId },
      select: { name: true },
    }),
  ]);

  return (
    <AppShell 
      title={isSuperAdmin ? `Teachers - ${school?.name || "Unknown"}` : "Teachers"}
      subtitle={isSuperAdmin ? "Super Admin View" : "Invite teachers to your school"}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={school?.name}
    >
      {grades.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Create at least one grade level first.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold mb-4">Invite a teacher</h2>
              <InviteTeacherForm grades={grades.map((g) => ({ id: g.id, label: GRADE_LEVEL_LABELS[g.type] }))} />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b text-sm font-medium">Teachers ({teachers.length})</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Grades</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachers.length === 0 ? (
                      <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">No teachers yet. Create one above.</TableCell></TableRow>
                    ) : teachers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.fullName}</TableCell>
                        <TableCell>
                          {t.taughtGrades.length === 0 ? (
                            <Badge variant="outline">Unassigned</Badge>
                          ) : t.taughtGrades.map((g) => (
                            <Badge key={g.type} variant="secondary" className="mr-1">{GRADE_LEVEL_LABELS[g.type]}</Badge>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}
