import { Suspense, cache } from "react";
import { Building2 } from "lucide-react";
import type { AdminScope, SummaryScope } from "@/lib/auth/admin-scope";
import { isDemoVisible } from "@/lib/demo/session";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { facetParamsFromSearch, getSummaryFacet } from "@/lib/summary/facets";
import { SUMMARY_FACET_META } from "@/lib/summary/facet-meta";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { monthKeyOf, shiftMonth } from "@/lib/summary/shape/months";
import type { FacetResult, SummaryFacetId, SummaryLevel } from "@/lib/summary/types";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Surface } from "@/components/ui/surface";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { ListBusyRegion } from "@/components/loading/list-busy-region";
import { SummaryScopeBar } from "./summary-scope-bar";
import { SummaryDistrictPickPrompt } from "./summary-district-pick-prompt";
import { SummaryParamControls } from "./summary-param-controls";
import { SummaryExportMenu, type SummaryExportRequest } from "./summary-export-menu";
import { SummarySectionCard } from "./summary-section-card";
import { SummaryListCard } from "./summary-list-card";
import { SummaryNotes } from "./summary-notes";
import { SummaryPeriodBarSkeleton, SummaryResultsSkeleton } from "./summary-skeleton";
import { SummaryFacetSwitcher } from "./summary-facet-index";
import { resolvePageSummaryScope } from "./resolve-page-scope";
import { formatComputedAt, formatCount } from "./summary-format";
import {
  SUMMARY_SCOPE_KEYS,
  flattenSearchParams,
  sectionAnchorId,
  summaryHref,
  type FlatSearchParams,
} from "./summary-href";

const MONTH_OPTION_COUNT = 24;

function monthOptions(): string[] {
  const current = monthKeyOf(formatLocalDateKey(schoolToday()));
  return Array.from({ length: MONTH_OPTION_COUNT }, (_, i) => shiftMonth(current, -i));
}

function levelOf(flat: FlatSearchParams): SummaryLevel {
  return flat.level === "district" || flat.level === "school" ? flat.level : "overall";
}

function scopeQuery(flat: FlatSearchParams): string {
  const href = summaryHref("", flat, {}, SUMMARY_SCOPE_KEYS);
  return href.startsWith("?") ? href.slice(1) : "";
}

/**
 * The toolbar's period strip and the results below it stream behind separate
 * boundaries but read one facet result: `cache` makes that one load per
 * request. Both callers pass the very same `scope` and `searchParams` objects.
 */
const loadFacetResult = cache(
  async (
    facetId: SummaryFacetId,
    scope: SummaryScope,
    searchParams: Record<string, string | string[] | undefined>
  ): Promise<FacetResult | null> => {
    const facet = getSummaryFacet(facetId);
    if (!facet) return null;
    return facet.load(scope, facetParamsFromSearch(facet, searchParams));
  }
);

export type SummaryFacetViewProps = {
  facetId: SummaryFacetId;
  adminScope: AdminScope;
  searchParams: Record<string, string | string[] | undefined>;
  /** `/district/summary` or `/admin/summary`; the facet id is appended. */
  basePath: string;
  userId: string;
};

/**
 * One summary facet at three levels (spec 3.6). The scope is narrowed and a
 * requested school checked here, before anything is read; the facet's figures
 * then stream in behind a skeleton so the toolbar paints at once.
 */
export async function SummaryFacetView({
  facetId,
  adminScope,
  searchParams,
  basePath,
  userId,
}: SummaryFacetViewProps) {
  const flat = flattenSearchParams(searchParams);
  const facetPath = `${basePath}/${facetId}`;
  const page = await resolvePageSummaryScope(
    adminScope,
    { district: flat.district, schoolId: flat.schoolId },
    { route: `${basePath}/[facet]`, userId }
  );

  const schools = await resolveScopeSchools(adminScope, await isDemoVisible());
  const districts =
    adminScope.kind === "districts"
      ? [...adminScope.districts]
      : [...new Set(schools.map((s) => s.district).filter((d): d is string => d !== null))].sort();

  if (adminScope.kind === "districts" && adminScope.districts.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No districts assigned yet"
        description="Your account has no district assigned, so there are no schools to summarize. Ask the division office to assign your districts."
      />
    );
  }

  const level = levelOf(flat);
  const resultsKey = JSON.stringify(flat);
  const scopeLabel = page.school?.name ?? page.district;
  // At division scope, "By school" with no district picked resolves to
  // `{ kind: "all" }` — every school in the division. Loading that facet
  // result (up to ~2 MB for 300+ schools) is what made this page never
  // finish; render a prompt instead of ever calling `facet.load` for it.
  const needsDistrictPick =
    adminScope.kind === "division" && level === "school" && page.scope.kind === "all";

  return (
    <ListNavigationProvider>
      <div className="min-w-0 space-y-4">
        <SummaryFacetSwitcher basePath={basePath} current={facetId} scopeQuery={scopeQuery(flat)} />

        <Surface as="section" aria-label="Summary filters" className="min-w-0 rounded-2xl">
          <div className="p-3 sm:p-4 lg:px-5">
            <SummaryScopeBar
              basePath={facetPath}
              searchParams={flat}
              level={level}
              district={page.district}
              schoolId={page.school?.id ?? null}
              districts={districts}
              schools={schools.map((s) => ({
                id: s.id,
                name: s.name,
                schoolIdCode: s.schoolIdCode,
                district: s.district,
              }))}
              allDistrictsLabel={adminScope.kind === "districts" ? "All my districts" : "All districts"}
              requireDistrictForSchool={adminScope.kind === "division"}
            />
          </div>
          {needsDistrictPick ? null : (
            <div className="border-t border-border/60 p-3 sm:p-4 lg:px-5">
              <Suspense key={resultsKey} fallback={<SummaryPeriodBarSkeleton />}>
                <SummaryPeriodBar
                  facetId={facetId}
                  scope={page.scope}
                  scopeLabel={scopeLabel}
                  searchParams={searchParams}
                  flat={flat}
                  facetPath={facetPath}
                />
              </Suspense>
            </div>
          )}
        </Surface>

        {needsDistrictPick ? (
          <SummaryDistrictPickPrompt basePath={facetPath} searchParams={flat} districts={districts} />
        ) : (
          <ListBusyRegion label="summary figures" skeleton={<SummaryResultsSkeleton />}>
            <Suspense key={resultsKey} fallback={<SummaryResultsSkeleton />}>
              <SummaryFacetResults facetId={facetId} scope={page.scope} searchParams={searchParams} />
            </Suspense>
          </ListBusyRegion>
        )}
      </div>
    </ListNavigationProvider>
  );
}

function exportRequest(result: FacetResult, flat: FlatSearchParams): SummaryExportRequest {
  const p = result.params;
  const req: SummaryExportRequest = { level: result.level };
  if (flat.district) req.district = flat.district;
  if (flat.schoolId) req.schoolId = flat.schoolId;
  if (p.month) req.month = p.month;
  if (p.from) req.from = p.from;
  if (p.to) req.to = p.to;
  if (p.schoolYearLabel) req.schoolYearLabel = p.schoolYearLabel;
  if (p.term) req.term = p.term;
  return req;
}

/** What the figures cover, the facet's own period controls, and Export. */
async function SummaryPeriodBar({
  facetId,
  scope,
  scopeLabel,
  searchParams,
  flat,
  facetPath,
}: {
  facetId: SummaryFacetId;
  /** Already narrowed by `resolvePageSummaryScope` (a school passed `loadSchoolInScope`). */
  scope: SummaryScope;
  scopeLabel: string | null;
  searchParams: Record<string, string | string[] | undefined>;
  flat: FlatSearchParams;
  facetPath: string;
}) {
  const result = await loadFacetResult(facetId, scope, searchParams);
  if (!result) return null;
  const meta = SUMMARY_FACET_META[facetId];
  const time = formatComputedAt(result.computedAt);
  const schoolWord = result.schoolCount === 1 ? "school" : "schools";

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-3">
        <div>
          <p className="font-semibold text-foreground">{result.subtitle}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {scopeLabel ? `${scopeLabel} · ` : ""}
            {formatCount(result.schoolCount)} {schoolWord}
            {time ? ` · Figures as of ${time} (refreshed every 5 minutes)` : ""}
          </p>
        </div>
        <SummaryParamControls
          basePath={facetPath}
          searchParams={flat}
          kinds={meta.paramKinds}
          params={result.params}
          monthOptions={monthOptions()}
          schoolYearLabels={result.options?.schoolYearLabels}
        />
      </div>
      <div className="shrink-0">
        <SummaryExportMenu facetId={facetId} request={exportRequest(result, flat)} />
      </div>
    </div>
  );
}

const JUMP_LINK =
  "inline-flex min-h-10 max-w-full items-center rounded-full border border-border/80 bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8";

async function SummaryFacetResults({
  facetId,
  scope,
  searchParams,
}: {
  facetId: SummaryFacetId;
  scope: SummaryScope;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const result = await loadFacetResult(facetId, scope, searchParams);
  if (!result) return null;

  return (
    <div className="min-w-0 space-y-4">
      <SummaryNotes notes={result.notes} gaps={result.gaps} />

      {result.schoolCount === 0 ? (
        <EmptyState
          icon={Building2}
          title="No schools in this scope"
          description="There are no schools to summarize for the district or school you chose."
        />
      ) : (
        <>
          {result.sections.length + result.lists.length > 3 ? (
            <nav aria-label="On this page" className="min-w-0">
              <p className="mb-2 text-xs font-medium text-muted-foreground">On this page</p>
              <ul className="flex flex-wrap gap-2">
                {result.sections.map((s) => (
                  <li key={s.id} className="min-w-0 max-w-full">
                    <a href={`#${sectionAnchorId(s.id)}`} className={JUMP_LINK}>
                      <span className="truncate" title={s.title}>{s.title}</span>
                    </a>
                  </li>
                ))}
                {result.lists.map((l) => (
                  <li key={l.id} className="min-w-0 max-w-full">
                    <a href={`#${sectionAnchorId(`list-${l.id}`)}`} className={JUMP_LINK}>
                      <span className="truncate" title={l.title}>{l.title}</span>
                      <span className="ml-1.5 tabular-nums">({l.rows.length})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {result.sections.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              description="No figures exist for this summary in the chosen scope and period."
            />
          ) : (
            result.sections.map((section) => (
              <SummarySectionCard key={section.id} section={section} level={result.level} />
            ))
          )}

          {result.lists.length > 0 ? (
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
              {result.lists.map((list) => (
                <SummaryListCard key={list.id} list={list} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
