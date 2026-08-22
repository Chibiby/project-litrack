import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/dashboard";
import { getTeacherShellContext } from "@/lib/dashboard/aggregates";
import { getAdvisoryPlacement } from "@/lib/teachers/advisory";
import { deniesAdvisoryRoster } from "@/lib/teachers/scope";
import {
  TERM_SHEET_NO_ADVISORY_CARD,
  TERM_SHEET_VOLUNTEER_CARD,
} from "@/lib/terms/gate-copy";

export const dynamic = "force-dynamic";

/**
 * Fallback for the sidebar's "End of Terms Reports" row.
 *
 * The sheet itself is grade-scoped (`/teacher/aral/[gradeId]/terms-reports`) and
 * the nav normally links straight to it, using the advisory grade that rides along
 * on the shell context. This page is where the row points in the two cases the nav
 * cannot build that href for:
 *   - A teacher who advises no section: there is no grade to scope the sheet to, so
 *     they land here and get the card that explains why it is shut, rather than a
 *     deep URL that would only refuse them again.
 *   - A Super Admin, who advises nothing anywhere: redirected to the ARAL grade
 *     picker, carrying `?schoolId=` so they stay in the school they were viewing.
 *
 * The refusal cards below are the same objects the deep page renders, so the gate
 * reads identically whichever way a teacher arrives.
 */
interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function TeacherTermsReportsResolverPage({
  searchParams,
}: PageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  // A Super Admin advises nothing, so there is no grade to resolve for them —
  // they need the picker. `?schoolId=` rides along so the admin stays in the
  // school context they were viewing.
  if (isSuperAdmin) {
    redirect(
      sp.schoolId
        ? `/teacher/aral?schoolId=${encodeURIComponent(sp.schoolId)}`
        : "/teacher/aral"
    );
  }

  const schoolId = user.schoolId;
  if (!schoolId) redirect("/login");

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  // React-`cache()`d on (schoolId, teacherId, isSuperAdmin) and already awaited by
  // the teacher layout for this request, so the designation costs no extra query.
  const { designation } = await getTeacherShellContext({
    schoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  if (deniesAdvisoryRoster({ isSuperAdmin, designation })) {
    return (
      <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
        <EmptyState {...TERM_SHEET_VOLUNTEER_CARD} />
      </AppShell>
    );
  }

  const advisory = await getAdvisoryPlacement({
    id: user.id,
    schoolId,
    advisorySectionId: user.advisorySectionId,
  });
  if (!advisory) {
    return (
      <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
        <EmptyState {...TERM_SHEET_NO_ADVISORY_CARD} />
      </AppShell>
    );
  }

  redirect(`/teacher/aral/${advisory.gradeLevelId}/terms-reports`);
}
