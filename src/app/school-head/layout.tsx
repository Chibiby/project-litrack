import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
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
    const school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { name: true },
    });
    schoolName = school?.name;
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
