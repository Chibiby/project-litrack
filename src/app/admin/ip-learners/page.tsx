import { requireUser } from "@/lib/auth/session";
import { getAdminIpAndAdvisoryMetrics } from "@/lib/dashboard/aggregates";
import { topSchoolsWithIp } from "@/lib/dashboard/ip-metrics";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
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
import { School, GraduationCap, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminIpLearnersPage() {
  const user = await requireUser("SUPER_ADMIN");

  let data: Awaited<ReturnType<typeof getAdminIpAndAdvisoryMetrics>> | null = null;
  try {
    data = await getAdminIpAndAdvisoryMetrics();
  } catch (err) {
    console.error("[AdminIpLearnersPage] failed to load:", err);
  }

  const schools = topSchoolsWithIp(data?.schools ?? [], Number.POSITIVE_INFINITY);
  const kinds = [...(data?.ipKinds ?? [])].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const totalIp = kinds.reduce((sum, k) => sum + k.value, 0);

  return (
    <AdminPage
      title="IP learners"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Learners"
          eyebrowIcon={GraduationCap}
          title="IP learners"
          subtitle="Every school with an enrolled Indigenous Peoples learner, and every IP group across schools."
          stats={
            <>
              <StatCard
                title="IP learners"
                value={data?.national.ipLearners ?? 0}
                hint={`${data?.national.ipPercent ?? "—"} of enrolled`}
                icon={GraduationCap}
                tone="amber"
                inlineOnPhone
                denseOnPhone
              />
              <StatCard
                title="Schools"
                value={schools.length}
                hint="With an IP learner"
                icon={School}
                tone="primary"
                inlineOnPhone
                denseOnPhone
              />
              <StatCard
                title="Per teacher"
                value={data?.national.learnersPerTeacher ?? "—"}
                hint="Learners per teacher"
                icon={Users}
                tone="emerald"
                inlineOnPhone
                denseOnPhone
              />
            </>
          }
        />
      }
    >
      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Schools with IP learners</h2>
        </SurfaceHeader>
        {schools.length === 0 ? (
          <SurfaceBody>
            <EmptyState
              title="No IP learners yet"
              description="Appears once enrolled learners have an IP ethnicity recorded."
              icon={School}
            />
          </SurfaceBody>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead className="text-right">Per teacher</TableHead>
                    <TableHead className="text-right">IP</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">IP %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schools.map((s) => (
                    <TableRow key={s.schoolId}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.learnersPerTeacher}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.ipLearners}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.totalLearners}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.ipPercent}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border/60 lg:hidden" aria-label="Schools with IP learners">
              {schools.map((s) => (
                <li key={s.schoolId} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{s.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.totalLearners} enrolled · {s.learnersPerTeacher} per teacher
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-foreground">{s.ipLearners}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{s.ipPercent}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Surface>

      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">IP learners by group</h2>
          <span className="text-xs text-muted-foreground">
            A learner with two IP groups counts in both
          </span>
        </SurfaceHeader>
        {kinds.length === 0 ? (
          <SurfaceBody>
            <EmptyState
              title="No IP learners yet"
              description="Appears once enrolled learners have an IP ethnicity recorded."
              icon={GraduationCap}
            />
          </SurfaceBody>
        ) : (
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
        )}
      </Surface>
    </AdminPage>
  );
}
