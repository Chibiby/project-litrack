import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { loadSchoolHeadDashboard } from "@/components/dashboard/school-head/dashboard-body";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface SchoolHeadDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolHeadDashboard({
  searchParams,
}: SchoolHeadDashboardProps) {
  const params = await searchParams;
  const { user, view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.dashboard
  );

  // Hero art follows the head's own profile; Super Admin gets the documented
  // fallback (section 3.8). Artwork must never take the dashboard down: a
  // database the gender migration has not reached yet (CLAUDE.md's
  // deploy-before-migrate window, spec risk R7) falls back to the default
  // banner instead of a 500 — the same defensive shape
  // `src/app/teacher/(app)/(dashboard)/page.tsx` uses for `TeacherProfile.gender`.
  const gender = view.isSuperAdminView
    ? null
    : await prisma.schoolHeadProfile
        .findUnique({ where: { userId: user.id }, select: { gender: true } })
        .then((p) => p?.gender ?? null)
        .catch(() => null);

  const displayName = view.isSuperAdminView
    ? view.schoolName ?? "Unknown school"
    : user.firstName;

  const { hero, body } = await loadSchoolHeadDashboard({
    view,
    displayName,
    bannerSrc: teacherBannerSrc(gender),
  });

  return (
    <SchoolHeadPage
      // The dashboard opens with its own greeting hero, so the frame's
      // generic title block would only repeat it. `hero` goes through the
      // `hero` prop so `SchoolHeadPage` can render the Super Admin badge row
      // between it and `body` — folding both into one slot pushed that badge
      // to the bottom of the page, below every chart.
      hero={hero ?? undefined}
      title={view.isSuperAdminView ? `Dashboard - ${displayName}` : `Welcome, ${user.firstName}`}
      view={view}
    >
      {body}
    </SchoolHeadPage>
  );
}
