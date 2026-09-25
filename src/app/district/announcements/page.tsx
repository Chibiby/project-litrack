import { Suspense } from "react";
import { Megaphone } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { listMyBroadcasts } from "@/lib/actions/district-announcements";
import { schoolToday } from "@/lib/date-keys";
import { formatLongDate } from "@/lib/week-range";
import { AppShell } from "@/components/app-shell";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListCardSkeleton } from "@/components/loading";
import { BroadcastComposer } from "@/components/district/broadcast-composer";
import { BroadcastList } from "@/components/district/broadcast-list";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { describeScope, hasNoDistricts } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

export default async function DistrictAnnouncementsPage() {
  const { user, scope } = await requireAdminScope();

  return (
    <AppShell
      title="Announcements"
      subtitle={describeScope(scope)}
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <div className="mb-6">
        <SchoolHeadHero
          eyebrow="Announcements"
          eyebrowIcon={Megaphone}
          title="Announcements"
          subtitle="Send a notice to your schools. It shows on each school's Announcements page."
          meta={describeScope(scope)}
        />
      </div>
      {hasNoDistricts(scope) ? (
        <NoDistrictsState />
      ) : (
        // Stacked until xl: the composer's district and school pickers need
        // more width than half of a laptop's content column gives them.
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <Suspense fallback={<ListCardSkeleton items={4} className="rounded-2xl" />}>
            <ComposeCard scope={scope} />
          </Suspense>
          <Suspense fallback={<ListCardSkeleton items={4} className="rounded-2xl" />}>
            <SentCard />
          </Suspense>
        </div>
      )}
    </AppShell>
  );
}

async function ComposeCard({ scope }: { scope: AdminScope }) {
  const schools = await resolveScopeSchools(scope, false);
  const districts =
    scope.kind === "districts"
      ? [...scope.districts]
      : [...new Set(schools.flatMap((school) => (school.district ? [school.district] : [])))].sort();

  return (
    <Surface as="section" aria-labelledby="district-compose-title" className="min-w-0 rounded-2xl">
      <SurfaceHeader className="block px-4 sm:px-5">
        <h2 id="district-compose-title" className="text-base font-semibold">
          Send an announcement
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          It appears on each chosen school&apos;s Announcements page, marked as coming from your
          office.
        </p>
      </SurfaceHeader>
      <SurfaceBody className="p-4 sm:p-5">
        {schools.length === 0 ? (
          <EmptyState
            title="No schools to send to"
            description="Schools appear here once the division office registers them under your districts."
            icon={Megaphone}
          />
        ) : (
          <BroadcastComposer
            districts={districts}
            schools={schools.map((school) => ({
              id: school.id,
              name: school.name,
              district: school.district,
            }))}
            allLabel={scope.kind === "division" ? "Every school" : "All my districts"}
          />
        )}
      </SurfaceBody>
    </Surface>
  );
}

async function SentCard() {
  const broadcasts = await listMyBroadcasts();

  return (
    <Surface as="section" aria-labelledby="district-sent-title" className="min-w-0 rounded-2xl">
      <SurfaceHeader className="px-4 sm:px-5">
        <h2 id="district-sent-title" className="text-base font-semibold">
          Sent
        </h2>
      </SurfaceHeader>
      <SurfaceBody className="p-4 sm:p-5">
        {broadcasts.length === 0 ? (
          <EmptyState
            title="No announcements sent yet"
            description="Announcements you send to your schools will be listed here, where you can also retract them."
            icon={Megaphone}
          />
        ) : (
          <BroadcastList
            broadcasts={broadcasts.map((item) => ({
              broadcastId: item.broadcastId,
              title: item.title,
              body: item.body,
              publishedLabel: formatLongDate(schoolToday(item.publishedAt)),
              schoolCount: item.schoolCount,
            }))}
          />
        )}
      </SurfaceBody>
    </Surface>
  );
}
