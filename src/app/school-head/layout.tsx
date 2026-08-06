import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { RoleShell } from "@/components/role-shell";

export const dynamic = "force-dynamic";

export default async function SchoolHeadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("SCHOOL_HEAD");
  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  let schoolName: string | undefined;
  if (user.schoolId) {
    schoolName = (await getSchoolName(user.schoolId)) ?? undefined;
  }

  return (
    <RoleShell
      role={user.role}
      userName={userName}
      schoolName={schoolName}
    >
      {children}
    </RoleShell>
  );
}
