import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { RoleShell } from "@/components/role-shell";
import { PostLoginSplash } from "@/components/post-login-splash";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { readImpersonationTicket } from "@/lib/auth/impersonation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { geminiConfigured } from "@/lib/assistant/gemini";

export const dynamic = "force-dynamic";

export default async function SchoolHeadAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("SCHOOL_HEAD");

  // Read before the profiling gate below: an impersonating admin must be able
  // to reach "Return to admin" even on a school whose head never profiled —
  // which is exactly the kind of stuck account they came here to look at.
  const impersonation = await readImpersonationTicket();
  const impersonating = impersonation?.targetUserId === user.id;

  // Only gate real school heads — SUPER_ADMIN may view without profiling.
  if (user.role === "SCHOOL_HEAD" && !user.profileCompleted && !impersonating) {
    redirect(SCHOOL_HEAD_ROUTES.profiling);
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
      {impersonating ? (
        <ImpersonationBanner accountName={`${userName} · ${schoolName ?? "school"}`} />
      ) : (
        <PostLoginSplash role="school-head" />
      )}
      <RoleShell
        role={user.role}
        userName={userName}
        schoolName={schoolName}
        aiEnabled={geminiConfigured()}
        // Not while an admin impersonates this head: `user` IS the head's own
        // account then, and acknowledging would stamp their row — the real head
        // would never be shown the release they have not read.
        lastSeenReleaseVersion={impersonating ? undefined : user.lastSeenReleaseVersion}
      >
        {children}
      </RoleShell>
    </>
  );
}
