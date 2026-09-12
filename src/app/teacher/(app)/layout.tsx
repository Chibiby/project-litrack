import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { getTeacherShellContext } from "@/lib/dashboard/aggregates";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { isAralVolunteerDesignation } from "@/lib/teachers/scope";
import { RoleShell } from "@/components/role-shell";
import { PostLoginSplash } from "@/components/post-login-splash";
import { AralAssignmentAlerts } from "@/components/notifications/aral-assignment-alerts";
import { UnlockGrantAlerts } from "@/components/notifications/unlock-grant-alerts";
import { geminiConfigured } from "@/lib/assistant/gemini";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";
import { readBoundImpersonationSession } from "@/lib/auth/impersonation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TeacherAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("TEACHER");

  const supabase = await createSupabaseServerClient();
  const impersonation = await readBoundImpersonationSession(supabase.auth);
  const impersonating = impersonation?.ticket.targetUserId === user.id;

  // Unlike the School Head layout, this gate is NOT bypassed while
  // impersonating. A stuck profiling wizard is one of the two things this
  // console exists to diagnose, so an admin who lands here should see the
  // actual failure the teacher sees, not a bypass around it. This is safe
  // because — unlike School Head profiling, which blocks the entire
  // /school-head tree — the teacher onboarding route is a real page that
  // renders and itself carries the banner, so there is always a way back to
  // the admin's own session.
  if (user.role === "TEACHER" && !user.profileCompleted) {
    redirect("/teacher/profiling");
  }

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  let schoolName: string | undefined;
  let grades: { id: string; label: string; hasAral?: boolean }[] | undefined;
  let roleLabel: string | undefined;
  let isAralVolunteer = false;
  let isFloating = false;
  let advisoryGradeLevelId: string | null = null;

  // Layouts cannot read searchParams; super-admin school impersonation still
  // gets admin nav via role === SUPER_ADMIN. Real teachers get grade links.
  // Shell chrome must not throw on transient pool errors — that tears down
  // RoleShell for the whole /teacher tree. Degrade to a minimal sidebar.
  //
  // Keep this to the two reads the chrome itself needs. Everything awaited here
  // blocks the sidebar and header for *every* /teacher route, and the loading
  // boundary above this layout is chrome-less, so a third query bought a longer
  // blank-shell flash on every navigation in exchange for a bell badge.
  // Page-level data belongs in the page's own Suspense boundary, where it
  // streams in behind an already-painted shell.
  if (user.role === "TEACHER" && user.schoolId) {
    try {
      const [name, shell] = await Promise.all([
        getSchoolName(user.schoolId),
        getTeacherShellContext({
          schoolId: user.schoolId,
          teacherId: user.id,
          isSuperAdmin: false,
        }),
      ]);

      schoolName = name ?? undefined;
      grades = shell.grades.map((g) => ({
        id: g.id,
        label: GRADE_LEVEL_LABELS[g.type],
        hasAral: g.hasAral,
      }));
      // The "End of Terms Reports" sheet is grade-scoped but its grade comes from
      // the advised section, so the nav needs this to point the row at the URL the
      // teacher actually lands on. Defaults to null, so a failed read leaves that
      // row live on the `/teacher/terms-reports` resolver rather than breaking it.
      advisoryGradeLevelId = shell.advisoryGradeLevelId;
      // A Non-DepEd ARAL Volunteer holds the TEACHER role but is not a teacher,
      // and the account menu is where they see themselves named. Left undefined
      // for everyone else — and if the read above failed, the default label
      // stands rather than a wrong one.
      if (isAralVolunteerDesignation(shell.designation)) {
        roleLabel = "ARAL Volunteer";
        // Same read also decides the nav: no advisory section means no advisory
        // roster, so the `Learners` row renders inert with its reason and
        // `/teacher/learners` turns them away. Defaults to false, so a failed
        // read leaves that row live rather than disabling a page for a teacher
        // who is entitled to it.
        isAralVolunteer = true;
      } else if (shell.advisoryMode === "FLOATING") {
        // A declared choice, not an unassigned state — `roleLabel` stays the
        // default "Teacher" because floating is still a real classroom role, just
        // one with no advisory section right now.
        isFloating = true;
      }
    } catch (err) {
      console.error("[teacher/layout] shell grades/school name failed:", err);
    }
  }

  return (
    <>
      <ImpersonationNotice
        userId={user.id}
        accountName={`${userName} · ${schoolName ?? "school"}`}
        impersonation={impersonation}
      />
      {/* Sibling of RoleShell (also portaled to body) so chrome cannot contain it. */}
      {!impersonating && <PostLoginSplash role="teacher" />}
      <RoleShell
        role={user.role}
        userName={userName}
        schoolName={schoolName}
        grades={grades}
        roleLabel={roleLabel}
        isAralVolunteer={isAralVolunteer}
        isFloating={isFloating}
        advisoryGradeLevelId={advisoryGradeLevelId}
        aiEnabled={geminiConfigured()}
        // Not while an admin impersonates this teacher: `user` IS the teacher's
        // own account then, and acknowledging would stamp their row — the real
        // teacher would never be shown the release they have not read.
        lastSeenReleaseVersion={impersonating ? undefined : user.lastSeenReleaseVersion}
      >
        {children}
      </RoleShell>
      {/*
        Also a sibling, and also portaled — but it adds nothing to what this
        layout awaits: it fetches from the client once the shell has painted and
        the splash above has cleared the screen. Renders nothing when the
        teacher has no waiting designation, which is the usual case.
      */}
      <AralAssignmentAlerts />
      <UnlockGrantAlerts />
    </>
  );
}
