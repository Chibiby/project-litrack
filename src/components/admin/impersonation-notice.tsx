import {
  readBoundImpersonationSession,
  type ImpersonationContext,
} from "@/lib/auth/impersonation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTestLabSession } from "@/lib/auth/test-lab";
import { findTestLabFixtures } from "@/lib/demo/test-fixtures";
import { buildTestLabChecklist } from "@/lib/test-lab/checklist";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

/**
 * Single source of truth for "is the current request an admin impersonating
 * someone else". Every entry point an impersonated session can land on
 * mounts this immediately above `{children}` so the banner — and the way
 * back to the admin's own session — can never be suppressed or forgotten on
 * a new route.
 *
 * `userId` must be the id of the user already loaded for this request (never
 * re-derived from role: a Super Admin browsing `/teacher` directly also has
 * `role === "TEACHER"` semantics on some pages, so only an exact id match
 * against the ticket's `targetUserId` tells impersonation apart from a real
 * session).
 */
export async function ImpersonationNotice({
  userId,
  accountName,
  impersonation,
  schoolId,
  role,
}: {
  userId: string;
  accountName: string;
  /**
   * A bound result already read by the enclosing layout. Supplying it keeps
   * every layout decision and this notice tied to the same live session check.
   */
  impersonation?: ImpersonationContext | null;
  /**
   * The impersonated user's own school id and role. Only passed by the
   * School Head and Teacher app layouts — the pages a Test Lab session
   * actually lands on. Omitting them just skips the Test Lab enhancements;
   * the ordinary banner still renders.
   */
  schoolId?: string | null;
  role?: "SCHOOL_HEAD" | "TEACHER";
}) {
  const context =
    impersonation === undefined
      ? await readBoundImpersonationSession((await createSupabaseServerClient()).auth)
      : impersonation;
  if (context?.ticket.targetUserId !== userId) return null;

  const testLab =
    role && (await readTestLabSession({ id: userId, schoolId: schoolId ?? null }))
      ? await testLabBannerPages(role)
      : null;

  return (
    <ImpersonationBanner accountName={accountName} expired={context.expired} testLab={testLab} />
  );
}

/**
 * The current role's checklist pages for the Test Lab banner's "Pages"
 * popover — `null` when fixtures are not (yet) prepared, in which case the
 * banner still shows Test Lab mode with an empty page list.
 */
async function testLabBannerPages(
  role: "SCHOOL_HEAD" | "TEACHER"
): Promise<{ pages: { label: string; href: string }[] }> {
  const fixtures = await findTestLabFixtures();
  const aralLearnerId = fixtures.aralLearnerIds[0];
  const learnerId = fixtures.learnerIds.find((id) => !fixtures.aralLearnerIds.includes(id));
  if (!fixtures.prepared || !fixtures.g1GradeId || !fixtures.kinderGradeId || !aralLearnerId || !learnerId) {
    return { pages: [] };
  }
  const checklist = buildTestLabChecklist({
    gradeId: fixtures.g1GradeId,
    secondGradeId: fixtures.kinderGradeId,
    learnerId,
    aralLearnerId,
  });
  return { pages: checklist.filter((item) => item.role === role).map((item) => ({ label: item.label, href: item.href })) };
}
