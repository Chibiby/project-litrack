import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { TestLabClient, type TestLabPageData } from "@/components/admin/test-lab";
import { demoStatus } from "@/lib/demo/provision";
import { isDemoEnabled } from "@/lib/settings/system-settings";
import { findTestLabFixtures } from "@/lib/demo/test-fixtures";
import { buildTestLabChecklist, type TestLabChecklistItem } from "@/lib/test-lab/checklist";

export const dynamic = "force-dynamic";

/**
 * Super Admin Page Test Lab (docs/test-lab-spec.md, T7).
 *
 * Uncached, like the demo settings and database console pages: this page's
 * whole job is telling the admin what is true *right now*, immediately before
 * they prepare, reset or start a session.
 */
export default async function AdminTestLabPage() {
  const user = await requireUser("SUPER_ADMIN");

  const [enabled, status, fixtures] = await Promise.all([
    isDemoEnabled(),
    demoStatus(),
    findTestLabFixtures(),
  ]);

  let checklist: TestLabChecklistItem[] = [];
  if (fixtures.prepared && fixtures.g1GradeId && fixtures.kinderGradeId && fixtures.aralLearnerIds[0]) {
    const learnerId = fixtures.learnerIds.find((id) => !fixtures.aralLearnerIds.includes(id));
    if (learnerId) {
      checklist = buildTestLabChecklist({
        gradeId: fixtures.g1GradeId,
        secondGradeId: fixtures.kinderGradeId,
        learnerId,
        aralLearnerId: fixtures.aralLearnerIds[0],
      });
    }
  }

  const data: TestLabPageData = {
    status: {
      demoSchoolExists: status.any,
      prepared: fixtures.prepared,
      demoModeEnabled: enabled,
    },
    checklist,
  };

  return (
    <AppShell
      title="Page Test Lab"
      subtitle="Try School Head and Teacher pages as demo accounts, with temporary data only"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <TestLabClient data={data} />
    </AppShell>
  );
}
