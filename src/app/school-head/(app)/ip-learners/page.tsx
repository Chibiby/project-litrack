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
} from "@/components/ui/table";
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Grade</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead className="text-right">IP</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">IP %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{r.grade}</TableCell>
                      <TableCell>{r.section}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.ipLearners}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.totalLearners}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.ipPercent}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kinds.map((k) => (
                    <TableRow key={k.name}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{k.value}</TableCell>
                      <TableCell className="text-right tabular-nums">
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
