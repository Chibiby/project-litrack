import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { getSchoolHeadMetricCounts } from "@/lib/dashboard/aggregates";
import { RoleShell } from "@/components/role-shell";
import { PostLoginSplash } from "@/components/post-login-splash";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";
import { getProfilePhotoBellNotifications } from "@/lib/notifications";
import { readBoundImpersonationSession } from "@/lib/auth/impersonation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  const supabase = await createSupabaseServerClient();
  const impersonation = await readBoundImpersonationSession(supabase.auth);
  const impersonating = impersonation?.ticket.targetUserId === user.id;

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

  let pendingTeacherCount: number | undefined;
  // Real School Heads only: a layout has no searchParams, so it cannot learn
  // which school a Super Admin has drilled into via `?schoolId=`, and this
  // account's own `schoolId` (if any) is not that school. Showing no badge
  // beats guessing one, or showing one school's count on another's page.
  if (user.role === "SCHOOL_HEAD" && user.schoolId) {
    try {
      const counts = await getSchoolHeadMetricCounts(user.schoolId);
      pendingTeacherCount = counts.pendingTeacherCount;
    } catch (err) {
      console.error("[school-head/layout] pending teacher count failed:", err);
    }
  }

  return (
    <>
      <ImpersonationNotice
        userId={user.id}
        accountName={`${userName} · ${schoolName ?? "school"}`}
        impersonation={impersonation}
        schoolId={user.schoolId}
        role="SCHOOL_HEAD"
      />
      {!impersonating && <PostLoginSplash role="school-head" />}
      <RoleShell
        role={user.role}
        userId={user.id}
        userName={userName}
        avatarPath={user.avatarPath}
        schoolName={schoolName}
        pendingTeacherCount={pendingTeacherCount}
        aiEnabled={geminiConfigured()}
        // Not while an admin impersonates this head: `user` IS the head's own
        // account then, and acknowledging would stamp their row — the real head
        // would never be shown the release they have not read.
        lastSeenReleaseVersion={impersonating ? undefined : user.lastSeenReleaseVersion}
        // Not awaited: streamed through RoleShell/AppHeader as a promise so the
        // sidebar and header paint before the notification query resolves. Only
        // a real School Head with a school can hold one — an impersonating
        // Super Admin gets the menu's empty state instead of a query with no
        // school.
        notifications={
          user.role === "SCHOOL_HEAD" && user.schoolId
            ? getProfilePhotoBellNotifications({
                id: user.id,
                schoolId: user.schoolId,
                role: user.role,
              })
            : []
        }
      >
        {children}
      </RoleShell>
    </>
  );
}
