import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatLocalDateKey } from "@/lib/date-keys";
import { isMonthlyReadingLevelUnlockedForAll, isSubmissionLockingEnabled } from "@/lib/settings/system-settings";
import { listActiveUnlocks, listUnlockTargets } from "@/lib/unlock/admin-queries";
import { AppShell } from "@/components/app-shell";
import { SubmissionsConsole } from "@/components/admin/submissions-console";

export const dynamic = "force-dynamic";

type SearchParams = { schoolId?: string; schoolYearId?: string };

export default async function AdminSubmissionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser("SUPER_ADMIN");
  if (user.role !== "SUPER_ADMIN") redirect("/forbidden");
  const params = await searchParams;
  const [schools, years, active, lockingEnabled, readingLevelUnlockedForAll] = await Promise.all([
    listUnlockTargets(),
    prisma.schoolYear.findMany({ where: { school: { deletedAt: null } }, include: { school: { select: { id: true, name: true } }, termWindowOverrides: { select: { term: true, startKey: true, endKey: true, deadlineKey: true } } }, orderBy: [{ school: { name: "asc" } }, { startDate: "desc" }] }),
    listActiveUnlocks(),
    isSubmissionLockingEnabled(),
    isMonthlyReadingLevelUnlockedForAll(),
  ]);
  const selectedRow = years.find((year) => year.id === params.schoolYearId) ?? years.find((year) => year.school.id === params.schoolId) ?? years[0] ?? null;
  const selected = selectedRow ? { id: selectedRow.id, schoolId: selectedRow.school.id, schoolName: selectedRow.school.name, label: selectedRow.label, startKey: formatLocalDateKey(selectedRow.startDate), endKey: formatLocalDateKey(selectedRow.endDate), overrides: selectedRow.termWindowOverrides } : null;
  const yearOptions = years.map((year) => ({ id: year.id, schoolId: year.school.id, schoolName: year.school.name, label: year.label, startKey: formatLocalDateKey(year.startDate), endKey: formatLocalDateKey(year.endDate), overrides: year.termWindowOverrides }));
  return <AppShell title="Submissions" subtitle="Control term windows and revision access across schools" role={user.role} userName={user.fullName || user.email}><SubmissionsConsole schools={schools} years={yearOptions} selected={selected} active={active} lockingEnabled={lockingEnabled} readingLevelUnlockedForAll={readingLevelUnlockedForAll} /></AppShell>;
}
