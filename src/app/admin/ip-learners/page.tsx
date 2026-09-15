import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { getAdminIpAndAdvisoryMetrics } from "@/lib/dashboard/aggregates";
import { topSchoolsWithIp } from "@/lib/dashboard/ip-metrics";
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
import { School, GraduationCap } from "lucide-react";

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
    <AppShell
      title="IP learners"
      subtitle="Every school with an enrolled IP learner, and every IP group across schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="space-y-6">
        <Surface as="section">
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
            <div className="overflow-x-auto">
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
          )}
        </Surface>

        <Surface as="section">
          <SurfaceHeader>
            <h2 className="text-base font-semibold">IP learners by group</h2>
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
    </AppShell>
  );
}
