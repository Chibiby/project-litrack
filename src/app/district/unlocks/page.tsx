import { Suspense } from "react";
import { Unlock } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { listActiveUnlocks, listUnlockTargets } from "@/lib/unlock/admin-queries";
import { UNLOCK_SCOPES } from "@/lib/validators/support.schema";
import { AppShell } from "@/components/app-shell";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListCardSkeleton } from "@/components/loading";
import { UnlockConsole } from "@/components/admin/unlock-console";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { describeScope, hasNoDistricts } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

/**
 * The unlock half of the admin submissions console, scoped to the caller's
 * schools. The division-wide switches and term windows stay with the Super
 * Admin, so they are not here at all.
 */
export default async function DistrictUnlocksPage() {
  const { user, scope } = await requireAdminScope();

  return (
    <AppShell
      title="Revision access"
      subtitle={describeScope(scope)}
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <div className="mb-6">
        <SchoolHeadHero
          eyebrow="Submissions"
          eyebrowIcon={Unlock}
          title="Revision access"
          subtitle="Reopen a locked record so a school or a teacher can correct it."
          meta={describeScope(scope)}
        />
      </div>
      {hasNoDistricts(scope) ? (
        <NoDistrictsState />
      ) : (
        <Suspense fallback={<ListCardSkeleton items={5} className="max-w-5xl rounded-2xl" />}>
          <DistrictUnlockBody scope={scope} />
        </Suspense>
      )}
    </AppShell>
  );
}

async function DistrictUnlockBody({ scope }: { scope: AdminScope }) {
  const [schools, active] = await Promise.all([
    listUnlockTargets(scope, { isDemo: false }),
    listActiveUnlocks(scope, { isDemo: false }),
  ]);

  if (schools.length === 0) {
    return (
      <EmptyState
        title="No schools in your districts yet"
        description="Schools appear here once the division office registers them under your districts."
        icon={Unlock}
      />
    );
  }

  return (
    <div className="min-w-0 max-w-5xl">
      <UnlockConsole
        schools={schools}
        active={active}
        scopes={UNLOCK_SCOPES.filter((unlockScope) => unlockScope !== "TERM_GRADES")}
        allowSchoolAudience
        initialMode="school"
      />
    </div>
  );
}
