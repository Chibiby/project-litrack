import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { InviteTeacherForm } from "@/components/forms/invite-teacher-form";
import {
  TeachersInviteTable,
  type TeacherListRow,
} from "@/components/teachers-invite-table";
import { inviteTokenStatus } from "@/lib/auth/invites";
import { usernameFromTeacherEmail } from "@/lib/auth/synthetic-email";

export const dynamic = "force-dynamic";

interface TeachersPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

function pickInviteForTeacher(
  teacher: { id: string; firstName: string; lastName: string; middleName: string | null },
  invites: Array<{
    id: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    middleName: string | null;
    consumedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
  }>
) {
  const byUserId = invites.filter((inv) => inv.userId === teacher.id);
  const matching =
    byUserId.length > 0
      ? byUserId
      : invites.filter(
          (inv) =>
            inv.firstName === teacher.firstName &&
            inv.lastName === teacher.lastName &&
            (inv.middleName ?? null) === (teacher.middleName ?? null)
        );
  if (matching.length === 0) return null;
  return (
    matching.find((i) => !i.consumedAt && !i.revokedAt) ??
    matching.find((i) => i.revokedAt && !i.consumedAt) ??
    matching[0] ??
    null
  );
}

export default async function TeachersPage({ searchParams }: TeachersPageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/teachers"
  );

  const [grades, teachers, invites, school] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { schoolId, role: "TEACHER", deletedAt: null },
      include: { taughtGrades: { select: { type: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teacherInvite.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true },
    }),
  ]);

  const rows: TeacherListRow[] = teachers.map((t) => {
    const invite = pickInviteForTeacher(t, invites);
    const tokenStatus = invite ? inviteTokenStatus(invite) : null;

    let status: TeacherListRow["status"] = "active";
    if (!t.isActive) {
      status = "revoked";
    } else if (t.mustChangePassword) {
      status = "pending_activation";
    }

    const canManageInvite =
      invite &&
      !invite.consumedAt &&
      !invite.revokedAt &&
      (tokenStatus === "pending" || tokenStatus === "expired");

    return {
      id: t.id,
      fullName: t.fullName,
      username: usernameFromTeacherEmail(t.email) ?? t.email,
      grades: t.taughtGrades.map((g) => GRADE_LEVEL_LABELS[g.type]),
      status,
      inviteId: canManageInvite ? invite.id : null,
      inviteStatus: tokenStatus,
    };
  });

  return (
    <AppShell
      title={isSuperAdminView ? `Teachers - ${school?.name || "Unknown"}` : "Teachers"}
      subtitle={isSuperAdminView ? "Super Admin View" : "Add and manage teachers"}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={school?.name}
    >
      {grades.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Create at least one grade level first.
          </CardContent>
        </Card>
      ) : (
        <div className={`grid gap-6 ${isSuperAdminView ? "" : "md:grid-cols-2"}`}>
          {!isSuperAdminView ? (
            <Card>
              <CardContent className="pt-6">
                <h2 className="mb-4 font-semibold">Add a teacher</h2>
                <InviteTeacherForm
                  grades={grades.map((g) => ({ id: g.id, label: GRADE_LEVEL_LABELS[g.type] }))}
                />
              </CardContent>
            </Card>
          ) : null}

          <TeachersInviteTable rows={rows} />
        </div>
      )}
    </AppShell>
  );
}
