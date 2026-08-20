import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { resolveSchoolContext } from "@/lib/school-context";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * What a School Head page knows about whose school it is rendering.
 *
 * `schoolName` is populated only for a Super Admin drill-down, because that is
 * the only view that displays it — see `resolveSchoolHeadView` below.
 */
export interface SchoolHeadView {
  schoolId: string;
  schoolName: string | null;
  isSuperAdminView: boolean;
}

/**
 * The preamble every `/school-head` page ran by hand: authenticate, bounce an
 * unprofiled head to the wizard, resolve which school is in view, then look up
 * its name for the header. Sixteen copies of five lines, each free to drift —
 * and two of them already had, passing a different `path` to the audit row than
 * the route they actually served.
 *
 * `schoolName` is fetched only under `isSuperAdminView`. The frame renders it
 * exclusively in the drill-down indicator, so a School Head looking at their own
 * school no longer pays for a lookup nothing displays. (Pages that need the name
 * for their own content, like School information, already query it themselves.)
 */
export async function resolveSchoolHeadView(
  schoolIdParam: string | undefined,
  path: string
): Promise<{ user: User; view: SchoolHeadView }> {
  const user = await requireUser("SCHOOL_HEAD");

  // Super Admin profiles through the admin area, so the wizard never applies.
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") {
    redirect(SCHOOL_HEAD_ROUTES.profiling);
  }

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    schoolIdParam,
    path
  );

  const schoolName = isSuperAdminView ? await getSchoolName(schoolId) : null;

  return { user, view: { schoolId, schoolName, isSuperAdminView } };
}
