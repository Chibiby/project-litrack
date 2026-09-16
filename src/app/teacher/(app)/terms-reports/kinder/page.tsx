import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/dashboard";
import { KinderChecklistHero } from "@/components/terms/kinder-checklist-hero";
import { KinderChecklistClient } from "@/components/terms/kinder-checklist-client";
import { KinderAdvisoryHeroControl } from "@/components/terms/kinder-advisory-hero-control";
import { getTeacherShellContext } from "@/lib/dashboard/aggregates";
import { getActiveSchoolYear } from "@/lib/cache/school-year";
import { getAdvisoryPlacements, resolveAdvisoryTarget } from "@/lib/teachers/advisory";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import { DECLARED_FLOATING_CARD } from "@/lib/teachers/floating-copy";
import { TERM_SHEET_NO_ADVISORY_CARD, TERM_SHEET_VOLUNTEER_CARD } from "@/lib/terms/gate-copy";
import { splitByKinderGradeType, mergeKinderChecklist, countTouchedCompetencies } from "@/lib/terms/kinder-checklist-view";
import { loadKinderChecklist, kinderAdvisoryLearnerWhere } from "@/lib/terms/kinder-sheet-data";
import { getTermWindows, isTermLocked } from "@/lib/terms/windows";
import { formatLocalDateKey, parseLocalDateKey, schoolToday } from "@/lib/date-keys";
import { readUnlockState } from "@/lib/unlock/grants";
import { CalendarX, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * The Kindergarten End-of-Term competency checklist — see
 * docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md.
 *
 * Reached either directly, or via a redirect from `/teacher/terms-reports`
 * for a teacher whose scope is Kindergarten-only or who picked a Kindergarten
 * advisory from that page's dropdown (owner decision — no combined
 * "All advisories" view spans both report shapes).
 */
interface PageProps {
  searchParams: Promise<{
    schoolId?: string;
    advisory?: string;
    learner?: string;
  }>;
}

export default async function TeacherKinderChecklistPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  if (isSuperAdmin) {
    redirect(
      sp.schoolId ? `/teacher/aral?schoolId=${encodeURIComponent(sp.schoolId)}` : "/teacher/aral"
    );
  }

  const schoolId = user.schoolId;
  if (!schoolId) redirect("/login");

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;
  const refuse = (card: React.ComponentProps<typeof EmptyState>) => (
    <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
      <EmptyState {...card} />
    </AppShell>
  );

  const [{ designation, advisoryMode }, placements, schoolYear, school] = await Promise.all([
    getTeacherShellContext({ schoolId, teacherId: user.id, isSuperAdmin }),
    getAdvisoryPlacements({ id: user.id, schoolId }),
    getActiveSchoolYear(schoolId),
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
  ]);

  const denial = advisoryRosterDenial({ isSuperAdmin, designation, advisoryMode });
  if (denial === "floating") return refuse(DECLARED_FLOATING_CARD);
  if (denial === "volunteer") return refuse(TERM_SHEET_VOLUNTEER_CARD);
  if (placements.length === 0) return refuse(TERM_SHEET_NO_ADVISORY_CARD);

  const { kinder: kinderPlacements } = splitByKinderGradeType(placements);
  if (kinderPlacements.length === 0) {
    return refuse({
      icon: Sparkles,
      title: "No Kindergarten advisory",
      description:
        "This checklist is for the Kindergarten section a teacher advises. You don't currently advise one.",
      actionHref: "/teacher/terms-reports",
      actionLabel: "Go to End of Terms Reports",
    });
  }

  if (!schoolYear) {
    return refuse({
      icon: CalendarX,
      title: "No active school year",
      description:
        "Term windows are derived from the active school year, so the checklist cannot be recorded without one. Ask your School Head to activate a school year, then come back.",
    });
  }

  const target = resolveAdvisoryTarget(kinderPlacements, sp.advisory);
  if (!target.ok) {
    if (target.reason === "unspecified") {
      const advisories = kinderPlacements.map((p) => ({ id: p.sectionId, label: p.label }));
      return (
        <AppShell title="End of Terms Reports" role={user.role} userName={userName} hideTitle>
          <KinderChecklistHero
            title="End-of-Term Reports"
            subtitle="Kindergarten"
            meta="Choose which Kindergarten advisory this checklist belongs to."
            advisoryLabel={null}
            learnerName={null}
            touched={0}
            total={0}
            pct={0}
          />
          <div className="mt-4 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              You advise {advisories.length} Kindergarten sections. Choose one to continue.
            </p>
            <KinderAdvisoryHeroControl
              schoolId={schoolId}
              advisories={advisories}
              value={null}
              className="h-11 w-full sm:w-80"
            />
          </div>
        </AppShell>
      );
    }
    return refuse({
      icon: Sparkles,
      title: "No Kindergarten advisory",
      description: target.error,
      actionHref: "/teacher/terms-reports",
      actionLabel: "Go to End of Terms Reports",
    });
  }

  const advisory = target.placement;
  const learnerWhere = kinderAdvisoryLearnerWhere(schoolId, advisory);

  const [roster, checklist] = await Promise.all([
    prisma.learner.findMany({
      where: learnerWhere,
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    sp.learner
      ? loadKinderChecklist({
          schoolYearId: schoolYear.id,
          learnerId: sp.learner,
          learnerWhere,
        })
      : null,
  ]);

  const learnerId = checklist ? checklist.learner.id : null;
  const learnerName = checklist ? checklist.learner.fullName : null;
  const states = mergeKinderChecklist(checklist?.records ?? new Map());
  const { touched, total, pct } = countTouchedCompetencies(states);

  const windows = getTermWindows(
    parseLocalDateKey(schoolYear.startDateKey),
    schoolYear.overrides
  );
  const todayKey = formatLocalDateKey(schoolToday());
  const unlock = await readUnlockState({
    userId: user.id,
    schoolId,
    scope: "TERM_GRADES",
  });
  const isClosed = (term: (typeof windows)[number]) =>
    unlock.lockingEnabled && isTermLocked(term, todayKey) && !unlock.unlockedKeys.has(term.term);
  const locked = {
    t1: isClosed(windows[0]),
    t2: isClosed(windows[1]),
    t3: isClosed(windows[2]),
  };

  const advisories = kinderPlacements.map((p) => ({ id: p.sectionId, label: p.label }));

  return (
    <AppShell title="End of Terms Reports" role={user.role} userName={userName} hideTitle>
      <KinderChecklistHero
        title="End-of-Term Reports"
        subtitle="Kindergarten"
        meta={`${advisory.sectionName} · SY ${schoolYear.label}`}
        advisoryLabel={advisory.label}
        learnerName={learnerName}
        touched={touched}
        total={total}
        pct={pct}
        topRight={
          advisories.length > 1 ? (
            <KinderAdvisoryHeroControl
              schoolId={schoolId}
              advisories={advisories}
              value={advisory.sectionId}
              className="h-9 w-32 text-xs sm:h-10 sm:w-44 sm:text-sm lg:h-11 lg:w-56"
            />
          ) : undefined
        }
      />

      <KinderChecklistClient
        key={`${advisory.sectionId}:${learnerId ?? "none"}`}
        schoolId={schoolId}
        advisorySectionId={advisory.sectionId}
        learnerId={learnerId}
        learnerName={learnerName}
        learners={roster}
        initialEntries={[...states.entries()]}
        locked={locked}
        schoolName={school?.name ?? "School"}
        advisoryLabel={advisory.label}
        schoolYearLabel={schoolYear.label}
      />
    </AppShell>
  );
}
