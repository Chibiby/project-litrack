import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { TestLabClient, type TestLabPageData } from "@/components/admin/test-lab";
import { demoStatus } from "@/lib/demo/provision";
import { readDemoSession } from "@/lib/demo/session";
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

  const [demoSession, status, fixtures, districtAdmins] = await Promise.all([
    readDemoSession(),
    demoStatus(),
    findTestLabFixtures(),
    // The demo school is outside every district scope, so the district portal
    // is opened as a REAL district admin, through the same `impersonateUser`
    // path as User Accounts "Sign in as". Only accounts that action would
    // accept: live and active (it refuses anything else as inactive).
    prisma.user.findMany({
      where: { role: "DISTRICT_ADMIN", deletedAt: null, isActive: true },
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        fullName: true,
        districtAssignments: { select: { district: true }, orderBy: { district: "asc" } },
      },
    }),
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
      demoSessionExpiresAt: demoSession?.expiresAt ?? null,
    },
    checklist,
    districtAdmins: districtAdmins.map((da) => ({
      id: da.id,
      label: da.username ?? da.fullName,
      districts: da.districtAssignments.map((a) => a.district),
    })),
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
