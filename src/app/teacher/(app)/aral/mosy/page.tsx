import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, Info } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { AralPageHero } from "@/components/aral/aral-page-hero";
import { MosyStatCards } from "@/components/aral/mosy-stat-cards";
import { MosyToolbar } from "@/components/aral/mosy-toolbar";
import { MosyTable } from "@/components/aral/mosy-table";
import { EmptyState } from "@/components/dashboard";
import { TableSectionSkeleton } from "@/components/loading";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { getActiveSchoolYear } from "@/lib/cache/school-year";
import { listKey } from "@/lib/nav/list-params";
import { ARAL_MOSY_HREF } from "@/lib/nav/nav-config";
import { LEARNER_PAGE_SIZE, type LearnerListSectionFilter } from "@/lib/learners/pagination";
import { loadMosyPage } from "@/lib/aral/mosy-queries";
import { MOSY_STATUSES, MOSY_STATUS_LABELS, parseMosyStatus, type MosyStatusFilter } from "@/lib/aral/mosy";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Params that change which rows the MOSY list shows — see `listKey`.
 * `schoolId` is the Super Admin's view-context switch, not a facet of the list.
 */
export const MOSY_LIST_KEYS = ["page", "status", "q", "grade", "section"] as const;

const TITLE = "MOSY Report";
const SUBTITLE =
  "Update reading levels and decide whether ARAL learners stay in or move out of the program.";

function parseSectionFilter(raw: string | undefined): LearnerListSectionFilter {
  const trimmed = (raw ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower === "all") return "all";
  return lower === "none" ? "none" : trimmed;
}

function statusHref(
  status: MosyStatusFilter,
  extra: { schoolId?: string; q?: string; grade?: string; section?: string }
): string {
  const qs = new URLSearchParams();
  if (status !== "all") qs.set("status", status);
  if (extra.schoolId) qs.set("schoolId", extra.schoolId);
  if (extra.q) qs.set("q", extra.q);
  if (extra.grade) qs.set("grade", extra.grade);
  if (extra.section && extra.section !== "all") qs.set("section", extra.section);
  const s = qs.toString();
  return s ? `${ARAL_MOSY_HREF}?${s}` : ARAL_MOSY_HREF;
}

interface PageProps {
  searchParams: Promise<{
    schoolId?: string;
    status?: string;
    page?: string;
    q?: string;
    grade?: string;
    section?: string;
  }>;
}

type MosyData = Awaited<ReturnType<typeof loadMosyPage>>;

async function MosyStats({ data }: { data: Promise<MosyData> }) {
  const { stats } = await data;
  return <MosyStatCards stats={stats} />;
}

async function MosyToolbarSlot({
  data,
  q,
  grade,
  section,
  status,
}: {
  data: Promise<MosyData>;
  q: string;
  grade: string;
  section: string;
  status: MosyStatusFilter;
}) {
  const { gradeOptions } = await data;
  return (
    <MosyToolbar q={q} grade={grade} section={section} status={status} grades={gradeOptions} />
  );
}

async function MosyStatusTabs({
  data,
  status,
  hrefExtra,
}: {
  data: Promise<MosyData>;
  status: MosyStatusFilter;
  hrefExtra: { schoolId?: string; q?: string; grade?: string; section?: string };
}) {
  const { counts } = await data;
  return (
    <nav aria-label="ARAL status" className="flex flex-wrap gap-2">
      {MOSY_STATUSES.map((s) => (
        <Link
          key={s}
          href={statusHref(s, hrefExtra)}
          aria-current={s === status ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors max-lg:min-h-10",
            s === status
              ? "border-violet bg-violet-soft text-violet"
              : "border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {MOSY_STATUS_LABELS[s]}
          <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums text-foreground">
            {counts[s]}
          </span>
        </Link>
      ))}
    </nav>
  );
}

async function MosyRows({
  data,
  status,
  canEdit,
  schoolIdParam,
  q,
  gradeParam,
  sectionParam,
}: {
  data: Promise<MosyData>;
  status: MosyStatusFilter;
  canEdit: boolean;
  schoolIdParam?: string;
  q: string;
  gradeParam?: string;
  sectionParam?: string;
}) {
  const { rows, totalCount, page, pages } = await data;
  return (
    <MosyTable
      rows={rows}
      totalCount={totalCount}
      page={page}
      pageSize={LEARNER_PAGE_SIZE}
      totalPages={pages}
      status={status}
      canEdit={canEdit}
      schoolIdParam={schoolIdParam}
      q={q}
      gradeParam={gradeParam}
      sectionParam={sectionParam}
    />
  );
}

export default async function AralMosyPage({ searchParams }: PageProps) {
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

  const schoolYear = await getActiveSchoolYear(schoolId);
  if (!schoolYear) {
    return (
      <AppShell {...shellProps}>
        <AralPageHero
          eyebrow={TITLE}
          eyebrowIcon={ClipboardCheck}
          title={TITLE}
          subtitle={SUBTITLE}
        />
        <Surface as="section" className="mt-4 rounded-2xl p-4">
          <EmptyState
            title="No active school year yet"
            description="Ask your School Head to set one before recording MOSY decisions."
          />
        </Surface>
      </AppShell>
    );
  }

  const status = parseMosyStatus(sp.status);
  const q = (sp.q ?? "").trim();
  const grade = (sp.grade ?? "").trim();
  const sectionFilter = parseSectionFilter(sp.section);
  const rawPage = Number.parseInt(sp.page ?? "1", 10);
  const teacherId = isSuperAdmin ? null : user.id;

  const data = loadMosyPage({
    schoolId,
    schoolYear: { id: schoolYear.id, startDateKey: schoolYear.startDateKey },
    teacherId,
    q,
    grade: grade || "all",
    section: sectionFilter,
    status,
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
  });

  const key = listKey(sp, MOSY_LIST_KEYS);
  const hrefExtra = {
    schoolId: sp.schoolId,
    q,
    grade: grade || undefined,
    section: sectionFilter,
  };

  return (
    <AppShell {...shellProps}>
      <AralPageHero
        eyebrow={TITLE}
        eyebrowIcon={ClipboardCheck}
        title={TITLE}
        subtitle={SUBTITLE}
      />

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
          <MosyStats data={data} />
        </Suspense>

        <Callout variant="aral" icon={Info}>
          This MOSY prompt appears automatically whenever you change an ARAL learner&apos;s
          reading level.
        </Callout>

        <ListNavigationProvider>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Suspense key={key} fallback={<div className="h-10" aria-hidden />}>
              <MosyStatusTabs data={data} status={status} hrefExtra={hrefExtra} />
            </Suspense>
            <Suspense fallback={<div className="h-11 lg:h-9" aria-hidden />}>
              <MosyToolbarSlot data={data} q={q} grade={grade} section={sectionFilter} status={status} />
            </Suspense>
          </div>

          <Suspense key={key} fallback={<TableSectionSkeleton rows={8} columns={8} />}>
            <MosyRows
              data={data}
              status={status}
              canEdit={!isSuperAdmin}
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
