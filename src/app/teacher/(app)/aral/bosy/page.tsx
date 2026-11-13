import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Info } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { AralPageHero } from "@/components/aral/aral-page-hero";
import { BosyStatCards } from "@/components/aral/bosy-stat-cards";
import { BosyTable } from "@/components/aral/bosy-table";
import { MosyToolbar } from "@/components/aral/mosy-toolbar";
import { EmptyState } from "@/components/dashboard";
import { TableSectionSkeleton } from "@/components/loading";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { getActiveSchoolYear } from "@/lib/cache/school-year";
import { listKey } from "@/lib/nav/list-params";
import { ARAL_BOSY_HREF } from "@/lib/nav/nav-config";
import { LEARNER_PAGE_SIZE, type LearnerListSectionFilter } from "@/lib/learners/pagination";
import { loadBosyPage } from "@/lib/aral/bosy-queries";
import { resolveMosyAccess } from "@/lib/aral/mosy-access";
import { BOSY_TIERS, BOSY_TIER_LABELS, parseBosyTier, type BosyTierFilter } from "@/lib/aral/bosy";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Params that change which rows the BOSY list shows — see `listKey`. */
const BOSY_LIST_KEYS = ["page", "level", "q", "grade", "section"] as const;

const TITLE = "BOSY Report";
const SUBTITLE =
  "The reading levels your ARAL learners started the school year with, as recorded when they were enrolled.";

const LEVEL_OPTIONS = BOSY_TIERS.map((value) => ({
  value,
  label: value === "all" ? "All BOSY levels" : BOSY_TIER_LABELS[value],
}));

function parseSectionFilter(raw: string | undefined): LearnerListSectionFilter {
  const trimmed = (raw ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower === "all") return "all";
  return lower === "none" ? "none" : trimmed;
}

type HrefExtra = { schoolId?: string; q?: string; grade?: string; section?: string };

function levelHref(level: BosyTierFilter, extra: HrefExtra): string {
  const qs = new URLSearchParams();
  if (level !== "all") qs.set("level", level);
  if (extra.schoolId) qs.set("schoolId", extra.schoolId);
  if (extra.q) qs.set("q", extra.q);
  if (extra.grade) qs.set("grade", extra.grade);
  if (extra.section && extra.section !== "all") qs.set("section", extra.section);
  const s = qs.toString();
  return s ? `${ARAL_BOSY_HREF}?${s}` : ARAL_BOSY_HREF;
}

interface PageProps {
  searchParams: Promise<{
    schoolId?: string;
    level?: string;
    page?: string;
    q?: string;
    grade?: string;
    section?: string;
  }>;
}

type BosyData = Awaited<ReturnType<typeof loadBosyPage>>;

async function BosyStats({ data }: { data: Promise<BosyData> }) {
  const { cards } = await data;
  return <BosyStatCards cards={cards} />;
}

async function BosyToolbarSlot({
  data,
  q,
  grade,
  section,
  level,
}: {
  data: Promise<BosyData>;
  q: string;
  grade: string;
  section: string;
  level: BosyTierFilter;
}) {
  const { gradeOptions } = await data;
  return (
    <MosyToolbar
      q={q}
      grade={grade}
      section={section}
      status={level}
      grades={gradeOptions}
      basePath={ARAL_BOSY_HREF}
      statusParam="level"
      statusOptions={LEVEL_OPTIONS}
      statusAriaLabel="BOSY level"
    />
  );
}

async function BosyLevelTabs({
  data,
  level,
  hrefExtra,
}: {
  data: Promise<BosyData>;
  level: BosyTierFilter;
  hrefExtra: HrefExtra;
}) {
  const { counts } = await data;
  return (
    <nav aria-label="BOSY level" className="flex flex-wrap gap-2">
      {BOSY_TIERS.map((t) => (
        <Link
          key={t}
          href={levelHref(t, hrefExtra)}
          aria-current={t === level ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors max-lg:min-h-10",
            t === level
              ? "border-aral bg-aral-soft text-aral"
              : "border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {BOSY_TIER_LABELS[t]}
          <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums text-foreground">
            {counts[t]}
          </span>
        </Link>
      ))}
    </nav>
  );
}

async function BosyRows({
  data,
  level,
  schoolIdParam,
  q,
  gradeParam,
  sectionParam,
}: {
  data: Promise<BosyData>;
  level: BosyTierFilter;
  schoolIdParam?: string;
  q: string;
  gradeParam?: string;
  sectionParam?: string;
}) {
  const { rows, totalCount, page, pages } = await data;
  return (
    <BosyTable
      rows={rows}
      totalCount={totalCount}
      page={page}
      pageSize={LEARNER_PAGE_SIZE}
      totalPages={pages}
      tier={level}
      schoolIdParam={schoolIdParam}
      q={q}
      gradeParam={gradeParam}
      sectionParam={sectionParam}
    />
  );
}

export default async function AralBosyPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const schoolId = (isSuperAdmin ? sp.schoolId : user.schoolId) ?? user.schoolId;
  if (!schoolId) redirect("/login");

  const shellProps = {
    title: TITLE,
    subtitle: SUBTITLE,
    role: user.role,
    userName: user.fullName || `${user.firstName} ${user.lastName}`,
    isSuperAdminView: isSuperAdmin && !!sp.schoolId,
    hideTitle: true,
  } as const;

  const hero = (
    <AralPageHero eyebrow={TITLE} eyebrowIcon={ClipboardList} title={TITLE} subtitle={SUBTITLE} />
  );

  const schoolYear = await getActiveSchoolYear(schoolId);
  if (!schoolYear) {
    return (
      <AppShell {...shellProps}>
        {hero}
        <Surface as="section" className="mt-4 rounded-2xl p-4">
          <EmptyState
            title="No active school year yet"
            description="Ask your School Head to set one to see BOSY reading levels."
          />
        </Surface>
      </AppShell>
    );
  }

  // Same gate and scope as the MOSY Report: a teacher sees only the sections
  // they advise; volunteers, floating and no-advisory teachers are refused.
  let sectionIds: string[] | null = null;
  if (!isSuperAdmin) {
    const access = await resolveMosyAccess({ id: user.id, role: user.role, schoolId });
    if (!access.ok) {
      return (
        <AppShell {...shellProps}>
          {hero}
          <Surface as="section" className="mt-4 rounded-2xl p-4">
            <EmptyState
              title="BOSY Report is not available"
              description={access.message.replaceAll("MOSY Report", "BOSY Report")}
            />
          </Surface>
        </AppShell>
      );
    }
    sectionIds = access.sectionIds;
  }

  const level = parseBosyTier(sp.level);
  const q = (sp.q ?? "").trim();
  const grade = (sp.grade ?? "").trim();
  const sectionFilter = parseSectionFilter(sp.section);
  const rawPage = Number.parseInt(sp.page ?? "1", 10);

  const data = loadBosyPage({
    schoolId,
    schoolYearId: schoolYear.id,
    sectionIds,
    q,
    grade: grade || "all",
    section: sectionFilter,
    tier: level,
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
  });

  const key = listKey(sp, BOSY_LIST_KEYS);
  const hrefExtra: HrefExtra = {
    schoolId: sp.schoolId,
    q,
    grade: grade || undefined,
    section: sectionFilter,
  };

  return (
    <AppShell {...shellProps}>
      {hero}

      <div className="mt-4 space-y-4">
        <Suspense
          key={key}
          fallback={
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          }
        >
          <BosyStats data={data} />
        </Suspense>

        <Callout variant="aral" icon={Info}>
          These are the Filipino and English reading levels recorded when each ARAL learner in
          your advisory was enrolled. This page is view-only; level groups follow the Filipino
          level.
        </Callout>

        <ListNavigationProvider>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Suspense key={key} fallback={<div className="h-10" aria-hidden />}>
              <BosyLevelTabs data={data} level={level} hrefExtra={hrefExtra} />
            </Suspense>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Suspense fallback={<div className="h-11 lg:h-9" aria-hidden />}>
                <BosyToolbarSlot data={data} q={q} grade={grade} section={sectionFilter} level={level} />
              </Suspense>
            </div>
          </div>

          <Suspense key={key} fallback={<TableSectionSkeleton rows={8} columns={7} />}>
            <BosyRows
              data={data}
              level={level}
              schoolIdParam={sp.schoolId}
              q={q}
              gradeParam={grade || undefined}
              sectionParam={sectionFilter !== "all" ? sectionFilter : undefined}
            />
          </Suspense>
        </ListNavigationProvider>
      </div>
    </AppShell>
  );
}
