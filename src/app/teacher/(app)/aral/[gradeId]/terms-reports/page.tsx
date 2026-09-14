import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard";
import {
  AralTermGradesPanel,
  type TermTabOption,
} from "@/components/aral/aral-term-grades-panel";
import { AralTermGradesSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellContext } from "@/lib/dashboard/aggregates";
import { getGradeSections } from "@/lib/cache/grade-sections";
import { getActiveSchoolYear } from "@/lib/cache/school-year";
import { advisoryRosterDenial, teacherAdvisoryGradeScope } from "@/lib/teachers/scope";
import {
  getAdvisoryPlacements,
  resolveAdvisoryGradeScope,
  advisoryGradeLevelIds,
  type AdvisoryGradeScope,
  type AdvisoryPlacement,
} from "@/lib/teachers/advisory";
import { termSheetHref } from "@/lib/terms/advisory-href";
import { DECLARED_FLOATING_CARD } from "@/lib/teachers/floating-copy";
import {
  AralEnrollAction,
  AralEnrollActionFallback,
} from "../_enroll-action";
import {
  nameSearchWhere,
  parseLearnerListParams,
  parseLearnerPageSize,
  sectionIdWhere,
  totalPages,
} from "@/lib/learners/pagination";
import {
  formatLocalDateKey,
  parseLocalDateKey,
  schoolToday,
} from "@/lib/date-keys";
import {
  getTermWindows,
  isTermLocked,
  type TermPeriodValue,
  type TermWindow,
} from "@/lib/terms/windows";
import { readUnlockState } from "@/lib/unlock/grants";
import {
  TERM_SHEET_NO_ADVISORY_CARD,
  TERM_SHEET_VOLUNTEER_CARD,
} from "@/lib/terms/gate-copy";
import { BookOpen, CalendarCheck, CalendarX } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Which term the sheet opens on.
 *
 * An explicit `?term=` wins. Otherwise the term whose window contains today —
 * the one a teacher is actually encoding.
 *
 * Outside every window the search runs FORWARD and falls back to the LAST term,
 * because the two edges want opposite answers. Before the first window (a School
 * Head activating a year ahead of its own `startDate` month) nothing is locked
 * yet, so the first unlocked term is First — reversing the search would open the
 * sheet on Third before the year has begun. After the last window (the months
 * between one school year and the next) everything is locked and `find` returns
 * nothing, so the fallback is Third — the last term anyone actually encoded,
 * where First would send them back to the start of a finished year.
 *
 * `windows` is non-empty by construction: `getTermWindows` maps `TERM_PERIODS`,
 * which has three entries, so the final index is always defined.
 */
function resolveActiveTerm(
  windows: TermWindow[],
  requested: string | undefined,
  todayKey: string
): TermPeriodValue {
  const explicit = windows.find((w) => w.term === requested);
  if (explicit) return explicit.term;

  const current = windows.find(
    (w) => todayKey >= w.startKey && todayKey <= w.endKey
  );
  if (current) return current.term;

  const firstOpen = windows.find((w) => !isTermLocked(w, todayKey));
  return firstOpen?.term ?? windows[windows.length - 1].term;
}

interface PageProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<{
    schoolId?: string;
    section?: string;
    term?: string;
    q?: string;
    page?: string;
    perPage?: string;
  }>;
}

export default async function AralGradeTermsReportsPage({
  params,
  searchParams,
}: PageProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const schoolId = (isSuperAdmin ? sp.schoolId : user.schoolId) ?? user.schoolId;
  if (!schoolId) redirect("/login");

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;
  const pageSize = parseLearnerPageSize(sp.perPage);
  const list = parseLearnerListParams(sp, pageSize);

  // Advisory scope, NOT `teacherGradeScope`: that one is a union that also
  // includes every grade holding a learner this teacher tutors for ARAL, which
  // would let an ARAL-only tutor reach a grade sheet they must never write.
  const gradeFilter: Prisma.GradeLevelWhereInput = isSuperAdmin
    ? { id: gradeId, deletedAt: null }
    : {
        id: gradeId,
        deletedAt: null,
        schoolId,
        ...teacherAdvisoryGradeScope(user.id),
      };

  // Every gate input in one round trip. None of the three reads consumes
  // another's result, and the gates below still fire in their original order, so
  // a refused teacher gets the same refusal, worded the same way. What it does
  // change is failure rather than outcome: a volunteer used to be turned away
  // before the grade query ran, and now that query runs first and can throw a
  // pool timeout where a card would have rendered. That is one indexed lookup
  // on a pool the rest of the page already depends on, so the trade is a rare
  // error page against a round trip on every load.
  const [{ grades: shellGrades, designation, advisoryMode }, placements, grade] =
    await Promise.all([
      // The teacher layout already awaited this exact call for this request and it
      // is React-`cache()`d on (schoolId, teacherId, isSuperAdmin), so both halves
      // come free here.
      getTeacherShellContext({
        schoolId,
        teacherId: user.id,
        isSuperAdmin,
      }),
      // The sheet renders ONE section. A multi-advisory teacher may hold several,
      // in several grades and even several inside this one grade, so the whole
      // list is read here: `?section=` names which sheet, and the rest become the
      // grade and section switchers the teacher moves between advisories with.
      isSuperAdmin
        ? Promise.resolve([] as AdvisoryPlacement[])
        : getAdvisoryPlacements({ id: user.id, schoolId }),
      prisma.gradeLevel.findFirst({
        where: gradeFilter,
        select: { id: true, type: true, schoolId: true },
      }),
    ]);

  // Never by grade alone: with two advisory sections in one grade the URL has to
  // say which, and guessing would open a class the teacher did not ask for.
  const advisoryScope: AdvisoryGradeScope = isSuperAdmin
    ? { kind: "none" }
    : resolveAdvisoryGradeScope(placements, gradeId, sp.section);

  // A term report card is a whole-class artifact, so it belongs to the DepEd
  // teacher who advises the section. The nav renders this row inert with a
  // "DepEd only" pill; this is the gate behind it, because a disabled row is not
  // access control — the URL can be typed. Explanation, not a 404, matching
  // `/teacher/learners`. The Super Admin carve-out lives in the predicate, and
  // the copy is shared with the `/teacher/terms-reports` resolver so the two
  // entry points cannot come to word the same refusal differently.
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

  if (!isSuperAdmin && advisoryScope.kind === "none") {
    return (
      <AppShell title="End of Terms Reports" role={user.role} userName={userName}>
        <EmptyState {...TERM_SHEET_NO_ADVISORY_CARD} />
      </AppShell>
    );
  }

  if (!grade) notFound();

  // Several advisory sections in the grade the URL names, and nothing naming
  // which. Ask. `?section=` is how the answer comes back, and every link into
  // this page carries it — see `termSheetHref`.
  if (advisoryScope.kind === "choose" || advisoryScope.kind === "elsewhere") {
    const heading =
      advisoryScope.kind === "choose"
        ? `You advise ${advisoryScope.options.length} sections in ${GRADE_LEVEL_LABELS[grade.type]}`
        : "Pick one of your advisory sections";
    return (
      <AppShell
        title={`End of Terms Reports — ${GRADE_LEVEL_LABELS[grade.type]}`}
        subtitle={heading}
        role={user.role}
        userName={userName}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {advisoryScope.options.map((option) => (
            <Card key={option.sectionId}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{option.label}</p>
                  <p className="text-xs text-muted-foreground">{option.gradeLabel}</p>
                </div>
                <Button asChild size="sm">
                  <Link href={termSheetHref(option)}>Open sheet</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </AppShell>
    );
  }

  const advisory =
    advisoryScope.kind === "placement" ? advisoryScope.placement : null;
  // The grade scope above already restricts to grades this teacher advises in —
  // assert the resolved placement agrees with the URL rather than trusting it to.
  if (advisory && grade.id !== advisory.gradeLevelId) notFound();

  // Terms are windows over the active school year, so without one there is
  // nothing to key a row to. A real state the schema permits: explain it rather
  // than render a grid that would silently discard everything typed into it.
  const schoolYear = await getActiveSchoolYear(grade.schoolId);
  if (!schoolYear) {
    return (
      <AppShell
        title={`End of Terms Reports — ${GRADE_LEVEL_LABELS[grade.type]}`}
        role={user.role}
        userName={userName}
        isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      >
        <EmptyState
          icon={CalendarX}
          title="No active school year"
          description="Term windows are derived from the active school year, so grades cannot be recorded without one. Ask your School Head to activate a school year, then come back."
        />
      </AppShell>
    );
  }

  const todayKey = formatLocalDateKey(schoolToday());
  const windows = getTermWindows(parseLocalDateKey(schoolYear.startDateKey), schoolYear.overrides);
  const activeTerm = resolveActiveTerm(windows, sp.term, todayKey);
  const activeWindow = windows.find((w) => w.term === activeTerm) ?? windows[0];
  // The lock is computed, and a grant reopens one term for one teacher. The
  // server action re-checks grants when a save arrives; the sheet has to see
  // the same answer or it would claim a term is locked that `saveTermGrades`
  // would accept (and the teacher could never start typing into it).
  //
  // Locking switched off programme-wide reopens every term for everyone, which
  // is why the flag is checked before the set: an empty `unlockedKeys` means no
  // grant was read, not that the teacher holds none.
  const unlock = isSuperAdmin
    ? { lockingEnabled: true, unlockedKeys: new Set<string>() }
    : await readUnlockState({
        userId: user.id,
        schoolId: user.schoolId,
        scope: "TERM_GRADES",
      });
  const isEncodingClosed = (w: TermWindow) =>
    unlock.lockingEnabled &&
    isTermLocked(w, todayKey) &&
    !unlock.unlockedKeys.has(w.term);

  const terms = windows.map((w) => ({
    term: w.term,
    label: w.label,
    rangeLabel: w.rangeLabel,
    locked: isEncodingClosed(w),
  }));

  const basePath = `/teacher/aral/${grade.id}/terms-reports`;
  // A teacher's grade switcher lists the grades they ADVISE IN, not every grade
  // the shell knows about: the shell list is a union that also carries grades
  // they only tutor for ARAL, and offering one of those here would switch them
  // into a sheet the gate above then refuses. A Super Admin reads whole grades,
  // so the shell list is right for them.
  const grades = (
    isSuperAdmin
      ? shellGrades.map((g) => ({ id: g.id, label: GRADE_LEVEL_LABELS[g.type] }))
      : advisoryGradeLevelIds(placements).map((id) => ({
          id,
          label:
            placements.find((p) => p.gradeLevelId === id)?.gradeLabel ??
            GRADE_LEVEL_LABELS[grade.type],
        }))
  ).slice();
  if (!grades.some((g) => g.id === grade.id)) {
    grades.unshift({ id: grade.id, label: GRADE_LEVEL_LABELS[grade.type] });
  }

  // Locked terms and admin views are both read-only: viewing and export
  // survive the lock, only encoding stops.
  const readOnly = isSuperAdmin || isEncodingClosed(activeWindow);

  // Same cross-link treatment the two sibling ARAL pages give each other: the
  // section filter rides along so a round trip does not silently widen the
  // roster the viewer narrowed.
  const linkParams = new URLSearchParams();
  if (sp.schoolId) linkParams.set("schoolId", sp.schoolId);
  if (list.section !== "all") linkParams.set("section", list.section);
  const linkSuffix = linkParams.toString();
  const suffix = linkSuffix ? `?${linkSuffix}` : "";
  const attendanceHref = `/teacher/aral/${grade.id}/attendance${suffix}`;
  const readingHref = `/teacher/aral/${grade.id}/reading-level${suffix}`;

  return (
    <AppShell
      title={`End of Terms Reports — ${GRADE_LEVEL_LABELS[grade.type]}`}
      subtitle={`${activeWindow.label} (${activeWindow.rangeLabel}) · SY ${schoolYear.label}${
        isSuperAdmin && sp.schoolId ? " (Admin View)" : ""
      }`}
      role={user.role}
      userName={userName}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={attendanceHref}>
              <CalendarCheck className="h-4 w-4" />
              Weekly attendance
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={readingHref}>
              <BookOpen className="h-4 w-4" />
              Monthly reading level
            </Link>
          </Button>
          {!isSuperAdmin && (
            // Same treatment the attendance sheet gives it: the candidate and
            // tutor lists are two queries nothing else on this page consumes, and
            // the grid behind them is what the teacher came for.
            <Suspense fallback={<AralEnrollActionFallback />}>
              <AralEnrollAction
                gradeId={grade.id}
                schoolId={grade.schoolId}
                teacherId={user.id}
              />
            </Suspense>
          )}
        </>
      }
    >
      <Suspense fallback={<AralTermGradesSkeleton />}>
        <AralTermGradesGrid
          grade={grade}
          schoolYear={schoolYear}
          advisory={advisory}
          advisorySections={
            // The teacher's advisory sections in THIS grade, so the section
            // control switches between advisories instead of pretending the
            // sheet only ever has one. A single advisory here collapses it —
            // there is nothing to switch to.
            placements
              .filter((placement) => placement.gradeLevelId === grade.id)
              .map((placement) => ({
                id: placement.sectionId,
                name: placement.sectionName,
              }))
          }
          schoolId={schoolId}
          schoolIdParam={sp.schoolId}
          isSuperAdmin={isSuperAdmin}
          list={list}
          pageSize={pageSize}
          grades={grades}
          basePath={basePath}
          activeTerm={activeTerm}
          terms={terms}
          readOnly={readOnly}
        />
      </Suspense>
    </AppShell>
  );
}

/**
 * The sheet body, behind its own Suspense boundary so the shell, title and
 * header actions do not wait on the roster reads.
 *
 * Nothing here can change whether this page is the sheet or a refusal card —
 * every gate resolves above the return, which is why this split is safe.
 */
async function AralTermGradesGrid({
  grade,
  schoolYear,
  advisory,
  advisorySections,
  schoolId,
  schoolIdParam,
  isSuperAdmin,
  list,
  pageSize,
  grades,
  basePath,
  activeTerm,
  terms,
  readOnly,
}: {
  grade: { id: string; schoolId: string };
  schoolYear: { id: string };
  advisory: AdvisoryPlacement | null;
  /** This teacher's advisory sections inside this grade, for the switcher. */
  advisorySections: { id: string; name: string }[];
  schoolId: string;
  schoolIdParam?: string;
  isSuperAdmin: boolean;
  list: ReturnType<typeof parseLearnerListParams>;
  pageSize: number;
  grades: { id: string; label: string }[];
  basePath: string;
  activeTerm: TermPeriodValue;
  terms: TermTabOption[];
  readOnly: boolean;
}) {
  // The teacher's roster IS their advisory section, so `?section=` never applies
  // to them. A Super Admin reads the whole grade and gets the section facet the
  // sibling ARAL pages already give them.
  const rosterWhere: Prisma.LearnerWhereInput = advisory
    ? {
        schoolId,
        gradeLevelId: advisory.gradeLevelId,
        sectionId: advisory.sectionId,
        deletedAt: null,
        archivedAt: null,
        ...nameSearchWhere(list.q),
      }
    : {
        schoolId: grade.schoolId,
        gradeLevelId: grade.id,
        deletedAt: null,
        archivedAt: null,
        ...sectionIdWhere(list.section),
        ...nameSearchWhere(list.q),
      };

  // Size the pager before the roster query: `?page=` is user-supplied and the
  // filtered set shrinks whenever a learner is archived or the search narrows.
  // Unclamped, `skip` walks past the end and the footer prints a range that does
  // not exist. `totalPages` floors at 1, so this never reaches 0. Stays serial
  // for that reason — `skip` below is derived from the clamped page.
  const totalCount = await prisma.learner.count({ where: rosterWhere });
  const pageCount = totalPages(totalCount, pageSize);
  const page = Math.min(list.page, pageCount);
  const skip = (page - 1) * pageSize;

  const [gradeSections, learners, termGrades] = await Promise.all([
    isSuperAdmin
      ? getGradeSections({
          schoolId: grade.schoolId,
          gradeLevelIds: [grade.id],
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    prisma.learner.findMany({
      where: rosterWhere,
      select: {
        id: true,
        fullName: true,
        section: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      skip,
      take: pageSize,
    }),
    // Every matching learner's cells, not just this page's: the grid keys its
    // rows by learner id, so the wider set costs one small query and no client
    // work. Narrowing it to the visible page would mean waiting for the roster
    // query to name its ids, serializing two queries that run side by side.
    prisma.termGrade.findMany({
      where: {
        schoolYearId: schoolYear.id,
        term: activeTerm,
        learner: rosterWhere,
      },
      select: { learnerId: true, subject: true, score: true },
    }),
  ]);

  // A Super Admin reads the whole grade and gets its real section facet; a
  // teacher gets their own advisories, because those are the only sections of
  // this grade they may encode into.
  const sectionOptions = isSuperAdmin ? gradeSections : advisorySections;

  const gridLearners = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    sectionName: l.section?.name ?? null,
  }));

  const initialGrades = termGrades.map((g) => ({
    learnerId: g.learnerId,
    subject: g.subject as string,
    score: g.score,
  }));

  return (
    <AralTermGradesPanel
      // Remount when the term or the filtered roster changes: the panel holds
      // the cell set in state and all three are scoping inputs to it.
      key={`${activeTerm}:${advisory?.sectionId ?? list.section}:${schoolIdParam ?? ""}`}
      gradeId={grade.id}
      grades={grades}
      basePath={basePath}
      sections={sectionOptions}
      // A teacher sees the switcher only when this grade holds a second advisory
      // of theirs to switch to: one advisory has nothing to choose between, and a
      // single-option picker reads as a filter that does nothing.
      showSection={
        isSuperAdmin ? sectionOptions.length > 0 : sectionOptions.length > 1
      }
      section={advisory ? advisory.sectionId : list.section}
      schoolId={schoolIdParam}
      q={list.q}
      activeTerm={activeTerm}
      terms={terms}
      learners={gridLearners}
      initialGrades={initialGrades}
      readOnly={readOnly}
      page={page}
      totalPages={pageCount}
      totalCount={totalCount}
      pageSize={pageSize}
    />
  );
}
