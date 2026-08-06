import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { RoleShell } from "@/components/role-shell";

export const dynamic = "force-dynamic";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("TEACHER");
  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  let schoolName: string | undefined;
  let grades: { id: string; label: string; hasAral?: boolean }[] | undefined;

  // Layouts cannot read searchParams; super-admin school impersonation still
  // gets admin nav via role === SUPER_ADMIN. Real teachers get grade links.
  if (user.role === "TEACHER" && user.schoolId) {
    const [name, shellGrades] = await Promise.all([
      getSchoolName(user.schoolId),
      getTeacherShellGrades({
        schoolId: user.schoolId,
        teacherId: user.id,
        isSuperAdmin: false,
      }),
    ]);

    schoolName = name ?? undefined;
    grades = shellGrades.map((g) => ({
      id: g.id,
      label: GRADE_LEVEL_LABELS[g.type],
      hasAral: g.hasAral,
    }));
  }

  return (
    <RoleShell
      role={user.role}
      userName={userName}
      schoolName={schoolName}
      grades={grades}
    >
      {children}
    </RoleShell>
  );
}
