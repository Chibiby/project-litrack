import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { getSchoolHeadIpMetrics } from "@/lib/dashboard/aggregates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  NoValue,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Users, GraduationCap, Percent } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolHeadIpLearnersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.ipLearners
  );

  let ip: Awaited<ReturnType<typeof getSchoolHeadIpMetrics>> | null = null;
  try {
    ip = await getSchoolHeadIpMetrics(view.schoolId);
  } catch (err) {
    console.error("[SchoolHeadIpLearnersPage] failed to load:", err);
  }

  const rows = ip?.rows ?? [];
  const kinds = [...(ip?.ipKinds ?? [])].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const totalIp = kinds.reduce((sum, k) => sum + k.value, 0);

  return (
    <SchoolHeadPage
      title="IP learners"
      view={view}
      hero={
        <SchoolHeadHero
          eyebrow="IP Learners"
          eyebrowIcon={Users}
          title="IP learners"
          subtitle="Every grade/section with an enrolled learner, and every IP group in your school."
          stats={
            <>
              <StatCard
                title="IP learners"
                value={ip?.ipLearners ?? 0}
                hint="Enrolled this school year"
                icon={Users}
                tone="amber"
                inlineOnPhone
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
              <StatCard
                title="Share of enrolled"
                value={ip?.ipPercent ?? "—"}
                hint="Of all enrolled learners"
                icon={Percent}
                tone="primary"
                inlineOnPhone
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
              <StatCard
                title="Learners per teacher"
                value={ip?.learnersPerTeacher ?? "—"}
                hint="Across active teachers"
                icon={GraduationCap}
                tone="emerald"
                inlineOnPhone
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
            </>
          }
        />
      }
    >
      <div className="space-y-6">
        <Surface as="section">
          <SurfaceHeader>
            <h2 className="text-base font-semibold">IP learners by grade and section</h2>
          </SurfaceHeader>
          {rows.length === 0 ? (
            <SurfaceBody>
              <EmptyState
                title="No data yet"
                description="Appears once learners are enrolled in the active school year."
                icon={Users}
              />
            </SurfaceBody>
          ) : (
            <ResponsiveTable
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grade</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead numeric>IP</TableHead>
                      <TableHead numeric>Total</TableHead>
                      <TableHead numeric>IP %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="whitespace-nowrap font-medium">{r.grade}</TableCell>
                        <TableCell>{r.section || <NoValue />}</TableCell>
                        <TableCell numeric>{r.ipLearners}</TableCell>
                        <TableCell numeric>{r.totalLearners}</TableCell>
                        <TableCell numeric>{r.ipPercent}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="IP learners by grade and section">
                  {rows.map((r) => (
                    <StackedRow
                      key={r.key}
                      title={`${r.grade}${r.section ? ` · ${r.section}` : ""}`}
                      value={
                        <>
                          {r.ipLearners}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">IP</span>
                        </>
                      }
                      meta={
                        <span className="tabular-nums">
                          {r.ipPercent} of {r.totalLearners} learners
                        </span>
                      }
                    />
                  ))}
                </StackedList>
              }
            />
          )}
        </Surface>

        <Surface as="section">
          <SurfaceHeader>
            <h2 className="text-base font-semibold">IP learners by group</h2>
          </SurfaceHeader>
          {kinds.length === 0 ? (
            <SurfaceBody>
              <EmptyState
                title="No data yet"
                description="Appears once enrolled learners have an IP ethnicity recorded."
                icon={GraduationCap}
              />
            </SurfaceBody>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead numeric>Count</TableHead>
                    <TableHead numeric>%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kinds.map((k) => (
                    <TableRow key={k.name}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell numeric>{k.value}</TableCell>
                      <TableCell numeric>
                        {totalIp > 0 ? `${((k.value / totalIp) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Surface>
      </div>
    </SchoolHeadPage>
  );
}
