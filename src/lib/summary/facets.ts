import "server-only";
import type { z } from "zod";
import { cachedQuery } from "@/lib/cache/unstable";
import { divisionSummary, schoolDashboard } from "@/lib/cache/tags";
import { isDemoVisible } from "@/lib/demo/session";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { parseInput } from "@/lib/errors/validation";
import { scopeCacheKey, type SummaryScope } from "@/lib/auth/admin-scope";
import type { ReportTable } from "@/lib/reports/render";
import type { ReportFrame } from "@/lib/reports/report-frame";
import {
  endOfTermParamsSchema,
  levelOnlyParamsSchema,
  monthParamsSchema,
  monthRangeParamsSchema,
} from "@/lib/validators/summary.schema";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { summaryReportTable } from "@/lib/summary/export";
import { SUMMARY_FACET_META } from "@/lib/summary/facet-meta";
import { defaultJulyMonth, defaultMonthRange } from "@/lib/summary/shape/months";
import { queryLearnerRows, shapeLearners } from "@/lib/summary/queries/learners";
import {
  queryReadingBehaviorRows,
  shapeReadingBehavior,
} from "@/lib/summary/queries/reading-behavior";
import { queryEndOfTermRows, shapeEndOfTerm } from "@/lib/summary/queries/end-of-term";
import { queryAttendanceRows, shapeAttendance } from "@/lib/summary/queries/attendance";
import { queryReadingLevelRows, shapeReadingLevels } from "@/lib/summary/queries/reading-levels";
import { queryComplianceRows, shapeCompliance } from "@/lib/summary/queries/compliance";
import { queryProfilingRows, shapeProfiling } from "@/lib/summary/queries/profiling";
import { queryAralRows, shapeAral } from "@/lib/summary/queries/aral";
import {
  SUMMARY_FACET_IDS,
  type FacetResult,
  type ScopeSchool,
  type SummaryFacetId,
  type SummaryLevel,
} from "@/lib/summary/types";

/**
 * The single list of summary facets (docs/specs/district-admin.md 3.6). Pages,
 * nav, export and tests all read from here.
 *
 * Every facet's `load`:
 * 1. validates its params (throws VALIDATION_FAILED);
 * 2. takes its schools from `resolveScopeSchools(scope)` — the caller must have
 *    narrowed `scope` with `resolveSummaryScope`, and a `school` scope must
 *    already have passed `loadSchoolInScope`;
 * 3. runs ONE `$queryRaw` scoped by `"schoolId" = ANY(<those ids>)`;
 * 4. rolls the rows up in pure code;
 * all inside one `cachedQuery` whose key carries `scopeCacheKey(scope, demo)`
 * (invariant I9), tagged `divisionSummary` (plus `schoolDashboard(id)` for a
 * school scope), 300 s TTL.
 */

/** Defaults filled in; also the cache key's params part. Always carries `level`. */
export type ResolvedParams = { level: SummaryLevel } & Record<string, string | null>;

export type FacetRunContext<R extends ResolvedParams> = {
  schools: ScopeSchool[];
  params: R;
  todayKey: string;
  computedAt: string;
};

export type SummaryFacet = {
  id: SummaryFacetId;
  label: string;
  description: string;
  /** Zod schema for the facet's params (search params or the export payload). */
  params: z.ZodTypeAny;
  load(scope: SummaryScope, params: unknown): Promise<FacetResult>;
  toReportTable(result: FacetResult, frame: ReportFrame): ReportTable;
};

/** Cache-key version for every facet entry. Bump when `FacetResult`'s shape changes. */
export const SUMMARY_CACHE_VERSION = "v1";

function defineFacet<S extends z.ZodTypeAny, R extends ResolvedParams>(def: {
  id: SummaryFacetId;
  params: S;
  resolve(parsed: z.infer<S>, todayKey: string): R;
  /** Compliance covers active schools only. */
  activeSchoolsOnly?: boolean;
  run(ctx: FacetRunContext<R>): Promise<FacetResult>;
}): SummaryFacet {
  const meta = SUMMARY_FACET_META[def.id];
  return {
    id: def.id,
    label: meta.label,
    description: meta.description,
    params: def.params,
    async load(scope, rawParams) {
      const parsed = parseInput(def.params, rawParams ?? {});
      const demoVisible = await isDemoVisible();
      const todayKey = formatLocalDateKey(schoolToday());
      const params = def.resolve(parsed, todayKey);
      const inScope = await resolveScopeSchools(scope, demoVisible);
      const schools = def.activeSchoolsOnly ? inScope.filter((s) => s.isActive) : inScope;
      return cachedQuery(
        () => def.run({ schools, params, todayKey, computedAt: new Date().toISOString() }),
        {
          keyParts: [
            "summary",
            def.id,
            SUMMARY_CACHE_VERSION,
            scopeCacheKey(scope, demoVisible),
            JSON.stringify(params),
          ],
          tags:
            scope.kind === "school"
              ? [divisionSummary, schoolDashboard(scope.schoolId)]
              : [divisionSummary],
          profile: "reference",
        }
      );
    },
    toReportTable: summaryReportTable,
  };
}

const ids = (schools: readonly ScopeSchool[]) => schools.map((s) => s.id);

export const SUMMARY_FACETS: Record<SummaryFacetId, SummaryFacet> = {
  learners: defineFacet({
    id: "learners",
    params: levelOnlyParamsSchema,
    resolve: (p) => ({ level: p.level }),
    async run({ schools, params, computedAt }) {
      const raw = await queryLearnerRows(ids(schools));
      return shapeLearners({ raw, schools, level: params.level, computedAt });
    },
  }),

  "reading-behavior": defineFacet({
    id: "reading-behavior",
    params: monthParamsSchema,
    resolve: (p, todayKey) => ({ level: p.level, month: p.month ?? defaultJulyMonth(todayKey) }),
    async run({ schools, params, computedAt }) {
      const raw = await queryReadingBehaviorRows(ids(schools), params.month);
      return shapeReadingBehavior({ raw, schools, level: params.level, month: params.month, computedAt });
    },
  }),

  "end-of-term": defineFacet({
    id: "end-of-term",
    params: endOfTermParamsSchema,
    resolve: (p) => ({
      level: p.level,
      schoolYearLabel: p.schoolYearLabel ?? null,
      term: p.term ?? null,
    }),
    async run({ schools, params, computedAt }) {
      const raw = await queryEndOfTermRows(ids(schools), params.schoolYearLabel);
      return shapeEndOfTerm({
        raw,
        schools,
        level: params.level,
        requestedTerm: params.term,
        computedAt,
      });
    },
  }),

  attendance: defineFacet({
    id: "attendance",
    params: monthRangeParamsSchema,
    resolve: (p, todayKey) => {
      const d = defaultMonthRange(todayKey);
      return { level: p.level, from: p.from ?? d.from, to: p.to ?? d.to, today: todayKey };
    },
    async run({ schools, params, todayKey, computedAt }) {
      const range = orderedRange(params.from, params.to);
      const raw = await queryAttendanceRows(ids(schools), { ...range, todayKey });
      return shapeAttendance({ raw, schools, level: params.level, ...range, todayKey, computedAt });
    },
  }),

  "reading-levels": defineFacet({
    id: "reading-levels",
    params: monthRangeParamsSchema,
    resolve: (p, todayKey) => {
      const d = defaultMonthRange(todayKey);
      return { level: p.level, from: p.from ?? d.from, to: p.to ?? d.to };
    },
    async run({ schools, params, computedAt }) {
      const range = orderedRange(params.from, params.to);
      const raw = await queryReadingLevelRows(ids(schools), range);
      return shapeReadingLevels({ raw, schools, level: params.level, ...range, computedAt });
    },
  }),

  compliance: defineFacet({
    id: "compliance",
    params: levelOnlyParamsSchema,
    resolve: (p, todayKey) => ({ level: p.level, today: todayKey }),
    activeSchoolsOnly: true,
    async run({ schools, params, todayKey, computedAt }) {
      const raw = await queryComplianceRows(ids(schools), todayKey);
      return shapeCompliance({ raw, schools, level: params.level, todayKey, computedAt });
    },
  }),

  profiling: defineFacet({
    id: "profiling",
    params: levelOnlyParamsSchema,
    resolve: (p) => ({ level: p.level }),
    async run({ schools, params, computedAt }) {
      const raw = await queryProfilingRows(ids(schools));
      return shapeProfiling({ raw, schools, level: params.level, computedAt });
    },
  }),

  aral: defineFacet({
    id: "aral",
    params: levelOnlyParamsSchema,
    resolve: (p) => ({ level: p.level }),
    async run({ schools, params, computedAt }) {
      const raw = await queryAralRows(ids(schools));
      return shapeAral({ raw, schools, level: params.level, computedAt });
    },
  }),
};

/** One default only (`from` given, `to` defaulted to before it) can invert a range; put it back in order. */
function orderedRange(from: string, to: string): { from: string; to: string } {
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The facet for a route segment, or null (the page calls `notFound()`). */
export function getSummaryFacet(id: string): SummaryFacet | null {
  return (SUMMARY_FACET_IDS as readonly string[]).includes(id)
    ? SUMMARY_FACETS[id as SummaryFacetId]
    : null;
}

/**
 * Params from a page's search params, falling back to the defaults when they
 * do not validate — a hand-edited URL shows the default view rather than an
 * error page. (Exports validate strictly through `load`.)
 */
export function facetParamsFromSearch(
  facet: SummaryFacet,
  search: Record<string, string | string[] | undefined>
): Record<string, unknown> {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(search)) flat[k] = Array.isArray(v) ? v[0] : v;
  const parsed = facet.params.safeParse(flat);
  if (parsed.success) return parsed.data as Record<string, unknown>;
  const level = levelOnlyParamsSchema.safeParse({ level: flat.level });
  return { level: level.success ? level.data.level : "overall" };
}
