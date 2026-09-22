import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { BookOpen, Heart } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Surface } from "@/components/ui/surface";
import { TableSectionSkeleton } from "@/components/loading";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { listKey } from "@/lib/nav/list-params";
import { ProfilingHero } from "@/components/aral/profiling-hero";
import { ProfilingStatCards } from "@/components/aral/profiling-stat-cards";
import { ProfilingToolbar } from "@/components/aral/profiling-toolbar";
import { ProfilingList, type ProfilingListRow } from "@/components/aral/profiling-list";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { ARAL_PROFILING_HREF } from "@/lib/nav/nav-config";
import { aralLearnerScope } from "@/lib/teachers/scope";
import { getGradeSections } from "@/lib/cache/grade-sections";
import {
  LEARNER_PAGE_SIZE,
  totalPages,
  nameSearchWhere,
  sectionIdWhere,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import {
  computeProfilingStats,
  parseProfilingStatus,
  PROFILING_STATUSES,
  PROFILING_STATUS_LABELS,
  type ProfilingStatusFilter,
} from "@/lib/aral/profiling-stats";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Params that change which rows the profiling list shows — see `listKey`.
 * `schoolId` is deliberately excluded: it is the Super Admin's view-context
 * switch, not a facet of this list, and the Suspense boundary must not
 * re-suspend for it.
 */
export const PROFILING_LIST_KEYS = ["page", "status", "q", "section"] as const;

/**
 * ARAL Profiling — Sections C, D and E for every ARAL learner this teacher is the
 * designated tutor for, across all their grades.
 *
 * Tutor scope (`aralLearnerScope`), not the wider care scope: `saveAralProfile`
 * only accepts the designated tutor, so listing anyone else would offer a button
 * that can only fail. The dashboard's "Pending Profiles" count uses the same
 * scope, so the card and the Pending tab here always agree.
 */

function statusWhere(status: ProfilingStatusFilter): Prisma.LearnerWhereInput {
  if (status === "pending") return { aralProfile: null };
  if (status === "completed") return { aralProfile: { isNot: null } };
  return {};
}

function statusHref(
  status: ProfilingStatusFilter,
  extra: { schoolId?: string; q?: string; section?: string }
): string {
  const qs = new URLSearchParams();
  if (status !== "all") qs.set("status", status);
  if (extra.schoolId) qs.set("schoolId", extra.schoolId);
  if (extra.q) qs.set("q", extra.q);
  if (extra.section && extra.section !== "all") qs.set("section", extra.section);
  const s = qs.toString();
  return s ? `${ARAL_PROFILING_HREF}?${s}` : ARAL_PROFILING_HREF;
}

/** "all"/"none"/section id, same parsing as `parseLearnerListParams`'s `section`. */
function parseSectionFilter(raw: string | undefined): LearnerListSectionFilter {
  const trimmed = (raw ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower === "all") return "all";
  return lower === "none" ? "none" : trimmed;
}

const dateFormat = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});

interface PageProps {
  searchParams: Promise<{
    schoolId?: string;
    status?: string;
    page?: string;
    q?: string;
    section?: string;
  }>;
}

async function ProfilingRows({
  where,
  totalCount,
  page,
  pages,
  status,
  canEdit,
  schoolIdParam,
  q,
  sectionParam,
}: {
  where: Prisma.LearnerWhereInput;
  totalCount: number;
  page: number;
  pages: number;
  status: ProfilingStatusFilter;
  canEdit: boolean;
  schoolIdParam?: string;
  q: string;
  sectionParam?: string;
}) {
  const learners = await prisma.learner.findMany({
    relationLoadStrategy: "join",
    where,
    select: {
      id: true,
      fullName: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
      section: { select: { name: true } },
      aralProfile: { select: { updatedAt: true } },
    },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    skip: (page - 1) * LEARNER_PAGE_SIZE,
    take: LEARNER_PAGE_SIZE,
  });

  const rows: ProfilingListRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    gradeLabel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
    sectionName: l.section?.name ?? null,
    done: l.aralProfile !== null,
    lastUpdatedDisplay: l.aralProfile ? dateFormat.format(l.aralProfile.updatedAt) : "—",
    updateHref: `/teacher/aral/${l.gradeLevelId}/learners/${l.id}/update`,
  }));

  return (
    <ProfilingList
      rows={rows}
      totalCount={totalCount}
      page={page}
      pageSize={LEARNER_PAGE_SIZE}
      totalPages={pages}
      status={status}
      canEdit={canEdit}
      schoolIdParam={schoolIdParam}
      q={q}
      sectionParam={sectionParam}
    />
  );
}

export default async function AralProfilingPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const schoolId = (isSuperAdmin ? sp.schoolId : user.schoolId) ?? user.schoolId;
  if (!schoolId) redirect("/login");

  const status = parseProfilingStatus(sp.status);
  const q = (sp.q ?? "").trim();
  const sectionFilter = parseSectionFilter(sp.section);

  const baseWhere: Prisma.LearnerWhereInput = {
    schoolId,
    isAralLearner: true,
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : aralLearnerScope(user.id)),
  };

  const filterWhere: Prisma.LearnerWhereInput = {
    ...nameSearchWhere(q),
    ...sectionIdWhere(sectionFilter),
  };
  const listWhere: Prisma.LearnerWhereInput = {
    ...baseWhere,
    ...filterWhere,
    ...statusWhere(status),
  };

  const [allCount, pendingCount, filteredTotalCount, latestProfile, gradeIdRows] =
    await Promise.all([
      prisma.learner.count({ where: baseWhere }),
      prisma.learner.count({ where: { ...baseWhere, aralProfile: null } }),
      prisma.learner.count({ where: listWhere }),
      prisma.aralProfile.findFirst({
        where: { learner: baseWhere },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      prisma.learner.findMany({
        where: baseWhere,
        select: { gradeLevelId: true },
        distinct: ["gradeLevelId"],
      }),
    ]);

  const counts: Record<ProfilingStatusFilter, number> = {
    all: allCount,
    pending: pendingCount,
    completed: allCount - pendingCount,
  };

  const sections =
    gradeIdRows.length > 0
      ? await getGradeSections({
          schoolId,
          gradeLevelIds: gradeIdRows.map((g) => g.gradeLevelId),
        })
      : [];

  const stats = computeProfilingStats({
    total: allCount,
    pending: pendingCount,
    lastUpdatedAt: latestProfile?.updatedAt ?? null,
  });

  const pages = totalPages(filteredTotalCount, LEARNER_PAGE_SIZE);
  const rawPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Math.min(Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1, pages);

  const subtitle = `${pendingCount} of ${allCount} ARAL learner${allCount === 1 ? "" : "s"} still need a profile${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`;

  return (
    <AppShell
      title="ARAL Profiling"
      subtitle={subtitle}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      hideTitle
    >
      <ProfilingHero title="ARAL Profiling" subtitle={subtitle} />

      <div className="mb-4">
        <ProfilingStatCards stats={stats} />
      </div>

      <ListNavigationProvider>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Profile status" className="flex flex-wrap gap-2">
            {PROFILING_STATUSES.map((s) => (
              <Link
                key={s}
                href={statusHref(s, { schoolId: sp.schoolId, q, section: sectionFilter })}
                aria-current={s === status ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  s === status
                    ? "border-violet bg-violet-soft text-violet"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {PROFILING_STATUS_LABELS[s]}
                <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums text-foreground">
                  {counts[s]}
                </span>
              </Link>
            ))}
          </nav>

          <ProfilingToolbar q={q} section={sectionFilter} sections={sections} status={status} />
        </div>

        <Suspense
          key={listKey(sp, PROFILING_LIST_KEYS)}
          fallback={<TableSectionSkeleton rows={8} columns={7} />}
        >
          <ProfilingRows
            where={listWhere}
            totalCount={filteredTotalCount}
            page={page}
            pages={pages}
            status={status}
            canEdit={!isSuperAdmin}
            schoolIdParam={sp.schoolId}
            q={q}
            sectionParam={sectionFilter !== "all" ? sectionFilter : undefined}
          />
        </Suspense>
      </ListNavigationProvider>

      <Surface as="section" className="mt-4 flex flex-col gap-2 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
            <BookOpen className="size-4" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-foreground sm:text-base">
            About ARAL Profiling
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Sections C to E cover reading behavior, outside factors and suggested
          interventions for every ARAL learner. Absences are not asked here —
          Weekly Attendance already records them.
        </p>
        <p className="flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300">
          Same Learners, Brighter Tomorrows
          <Heart className="size-3 shrink-0 fill-current" aria-hidden />
        </p>
      </Surface>
    </AppShell>
  );
}
