import { Suspense } from "react";
import { Megaphone } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { listMyBroadcasts } from "@/lib/actions/district-announcements";
import { schoolToday } from "@/lib/date-keys";
import { formatLongDate } from "@/lib/week-range";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    >
      {hasNoDistricts(scope) ? (
        <NoDistrictsState />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Suspense fallback={<ListCardSkeleton items={4} />}>
            <ComposeCard scope={scope} />
          </Suspense>
          <Suspense fallback={<ListCardSkeleton items={4} />}>
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
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">Send an announcement</CardTitle>
        <CardDescription>
          It appears on each chosen school&apos;s Announcements page, marked as coming from your
          office.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

async function SentCard() {
  const broadcasts = await listMyBroadcasts();

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">Sent</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
