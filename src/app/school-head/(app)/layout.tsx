import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { RoleShell } from "@/components/role-shell";
import { PostLoginSplash } from "@/components/post-login-splash";

export const dynamic = "force-dynamic";

export default async function SchoolHeadAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("SCHOOL_HEAD");

  // Only gate real school heads — SUPER_ADMIN may view without profiling.
  if (user.role === "SCHOOL_HEAD" && !user.profileCompleted) {
    redirect("/school-head/profiling");
  }

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
    <>
      <PostLoginSplash role="school-head" />
      <RoleShell
        role={user.role}
        userName={userName}
        schoolName={schoolName}
      >
        {children}
      </RoleShell>
    </>
  );
}
