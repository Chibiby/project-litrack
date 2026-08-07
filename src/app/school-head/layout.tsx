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
  // Shell chrome must not throw on transient pool errors — that tears down
  // RoleShell for the whole /school-head tree. Degrade to a nameless sidebar.
  if (user.schoolId) {
    try {
      schoolName = (await getSchoolName(user.schoolId)) ?? undefined;
    } catch (err) {
      console.error("[school-head/layout] school name failed:", err);
    }
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
