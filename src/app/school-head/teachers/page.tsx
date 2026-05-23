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

export default async function TeachersPage() {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted) redirect("/school-head/profiling");
  if (!user.schoolId) redirect("/login");

  const [grades, teachers, invites] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId: user.schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { schoolId: user.schoolId, role: "TEACHER", deletedAt: null },
      include: { taughtGrades: { select: { type: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teacherInvite.findMany({
      where: { schoolId: user.schoolId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <AppShell title="Teachers" subtitle="Invite teachers to your school">
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
                <div className="px-4 py-3 border-b text-sm font-medium">Active teachers ({teachers.length})</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Grades</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachers.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No teachers yet</TableCell></TableRow>
                    ) : teachers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.fullName}</TableCell>
                        <TableCell className="text-muted-foreground">{t.email}</TableCell>
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

            {invites.length > 0 && (
              <Card>
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b text-sm font-medium">Pending invites ({invites.length})</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invites.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>{[inv.firstName, inv.lastName].join(" ")}</TableCell>
                          <TableCell className="text-muted-foreground">{inv.email}</TableCell>
                          <TableCell>{inv.expiresAt.toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
