import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getTeacherShellContext } from "@/lib/dashboard/aggregates";
import { getAdvisoryPlacements } from "@/lib/teachers/advisory";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import { DECLARED_FLOATING_CARD } from "@/lib/teachers/floating-copy";
import {
  TERM_SHEET_NO_ADVISORY_CARD,
  TERM_SHEET_VOLUNTEER_CARD,
} from "@/lib/terms/gate-copy";
import { termSheetHref } from "@/lib/terms/advisory-href";
import { FileText } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Where the sidebar's "End of Terms Reports" row points whenever one sheet is
 * not the obvious answer.
 *
 * The sheet itself is grade-scoped (`/teacher/aral/[gradeId]/terms-reports`) and
 * the nav links straight to it for a teacher with exactly one advisory section.
 * This page serves the other three cases:
 *   - A teacher who advises no section: there is no grade to scope the sheet to,
 *     so they land here and get the card that explains why it is shut, rather
 *     than a deep URL that would only refuse them again.
 *   - A multi-advisory teacher: several sections, possibly in several grades, and
 *     no way to know which one they meant. They pick. Opening the first would put
 *     a teacher in front of a class they did not ask for, and the mistake is
 *     invisible until somebody notices grades on the wrong roster.
 *   - A Super Admin, who advises nothing anywhere: redirected to the ARAL grade
 *     picker, carrying `?schoolId=` so they stay in the school they were viewing.
 *
 * The refusal cards below are the same objects the deep page renders, so the gate
 * reads identically whichever way a teacher arrives.
 */
interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function TeacherTermsReportsResolverPage({
  searchParams,
}: PageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  // A Super Admin advises nothing, so there is no grade to resolve for them —
  // they need the picker. `?schoolId=` rides along so the admin stays in the
  // school context they were viewing.
  if (isSuperAdmin) {
    redirect(
      sp.schoolId
        ? `/teacher/aral?schoolId=${encodeURIComponent(sp.schoolId)}`
        : "/teacher/aral"
    );
  }

  const schoolId = user.schoolId;
  if (!schoolId) redirect("/login");

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  // React-`cache()`d on (schoolId, teacherId, isSuperAdmin) and already awaited by
  // the teacher layout for this request, so the designation costs no extra query.
  const { designation, advisoryMode } = await getTeacherShellContext({
    schoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  const denial = advisoryRosterDenial({ isSuperAdmin, designation, advisoryMode });
  if (denial === "floating") {
    return (
      <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
        <EmptyState {...DECLARED_FLOATING_CARD} />
      </AppShell>
    );
  }
  if (denial === "volunteer") {
    return (
      <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
        <EmptyState {...TERM_SHEET_VOLUNTEER_CARD} />
      </AppShell>
    );
  }

  const placements = await getAdvisoryPlacements({ id: user.id, schoolId });
  if (placements.length === 0) {
    return (
      <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
        <EmptyState {...TERM_SHEET_NO_ADVISORY_CARD} />
      </AppShell>
    );
  }

  // Exactly one advisory: nothing to choose between, so skip the hop. The sheet
  // still names the section in its own URL, which is what a bookmark keeps.
  if (placements.length === 1) {
    redirect(termSheetHref(placements[0]));
  }

  return (
    <AppShell
      title="End of Terms Reports"
      subtitle={`You advise ${placements.length} sections — pick the one to encode`}
      role={user.role}
      userName={userName}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {placements.map((placement) => (
          <Card key={placement.sectionId}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{placement.label}</p>
                <p className="text-xs text-muted-foreground">
                  {placement.gradeLabel}
                </p>
              </div>
              <Button asChild size="sm">
                <Link href={termSheetHref(placement)}>
                  <FileText className="h-4 w-4" />
                  Open sheet
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
