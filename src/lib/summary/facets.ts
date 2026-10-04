import "server-only";
import { cache } from "react";
import type { z } from "zod";
import { cachedQuery } from "@/lib/cache/unstable";
import { divisionSummary, schoolDashboard } from "@/lib/cache/tags";
import { isDemoVisible } from "@/lib/demo/session";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { parseInput } from "@/lib/errors/validation";
import type { SummaryScope } from "@/lib/auth/admin-scope";
import type { ReportTable } from "@/lib/reports/render";
import type { ReportFrame } from "@/lib/reports/report-frame";
import {
  endOfTermParamsSchema,
  levelOnlyParamsSchema,
  monthParamsSchema,
  monthRangeParamsSchema,
} from "@/lib/validators/summary.schema";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { scopeRaw, type ScopableRow, type ScopedRaw } from "@/lib/summary/scoped-raw";
import { summaryReportTable } from "@/lib/summary/export";
import { SUMMARY_FACET_META } from "@/lib/summary/facet-meta";
import {
  defaultJulyMonth,
  defaultMonthRange,
  isPastMonth,
  monthEndKey,
} from "@/lib/summary/shape/months";
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
 * 3. reads the facet's DIVISION-WIDE raw rows: one SQL run over every school
 *    (demo and inactive included), cached once per facet and period
 *    (`rawCacheKeyParts`: no scope, no demo flag, no level), so every scope
 *    and every level of a period share one run. This is the facet's ONLY
 *    cache entry, read with a top-level `cachedQuery` call (never from inside
 *    another one: a nested `unstable_cache` never reads its cache, see
 *    `loadDivisionRaw`), tagged `divisionSummary` (plus `schoolDashboard(id)`
 *    for a school scope: `rawTagsFor`), 300 s TTL (3600 s for a past period);
 * 4. fences those rows to the scope's schools with `scopeRaw`;
 * 5. rolls the fenced rows up in pure code, on every request (no per-scope
 *    shaped entry: shaping is cheap next to a KV read of the raw blob).
 *
 * TENANCY: the raw entry holds every school's rows, so step 4 is the fence.
 * `shape` only accepts `ScopedRaw<T>`, which only `scopeRaw` produces, and
 * `scopeRaw` only ever receives the `schools` list from step 2. Nothing
 * scope-specific is cached, so no cached result can be served to another
 * scope (invariant I9): each request re-fences the shared rows itself.
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
  /**
   * The cron warm: refresh the division raw entry a page with no period in its
   * URL reads (same key: the params come from this facet's own `resolve`).
   * Runs the SQL when called inside the warm's own cache callback.
   */
  warmRaw(): Promise<void>;
  toReportTable(result: FacetResult, frame: ReportFrame): ReportTable;
};

/**
 * Cache-key version for every summary entry. Bump when a raw entry's shape
 * changes. v2: division-wide raw rows (end-of-term rows carry `label`, no
 * `selected` row). v3: the raw entry is `{ computedAt, rows }` and is the only
 * facet entry (no per-scope shaped entry).
 */
export const SUMMARY_CACHE_VERSION = "v3";

/** A facet's division raw entry: the rows and when the SQL read them ("Figures as of"). */
export type DivisionRaw<T> = { computedAt: string; rows: T[] };

/**
 * The raw-row cache key for a facet: exactly the params the SQL receives.
 * Nothing about the scope or the demo flag is in it, because the SQL is not
 * scoped (the fence is `scopeRaw`); `level` and every shape-only param stay
 * out, so all scopes and levels of one period share one SQL run. A school
 * created, archived, re-districted or flagged demo changes the scope's school
 * list, not these rows, so `divisionSummary` tags it; a school scope's read
 * also checks that school's `schoolDashboard` tag (`rawTagsFor`).
 */
export function rawCacheKeyParts(
  facetId: SummaryFacetId,
  sqlParams: Record<string, string | null>
): string[] {
  return ["summary-raw", facetId, SUMMARY_CACHE_VERSION, JSON.stringify(sqlParams)];
}

/**
 * One request asking for the same raw entry more than once (the `/district`
 * overview loads four facets; an export loads the facet the page already did)
 * shares one promise, so concurrent misses run the SQL once.
 */
const getRawRequestMemo = cache(() => new Map<string, Promise<unknown>>());

/** TTL of the current or default period (the `reference` profile). */
const CURRENT_PERIOD_TTL_SECONDS = 300;
/**
 * TTL of a period wholly before the current month (operator decision
 * 2026-10-04): a late edit to an old week shows within the hour.
 */
export const PAST_PERIOD_TTL_SECONDS = 3600;

/** The raw entry's TTL; undefined keeps the profile's 300 s. */
function ttlFor(past: boolean): number {
  return past ? PAST_PERIOD_TTL_SECONDS : CURRENT_PERIOD_TTL_SECONDS;
}

/**
 * The tags a raw read checks. Next and OpenNext judge an entry's freshness by
 * the tags passed at READ time, so a school scope adds `schoolDashboard(id)`:
 * the learner/attendance/reading mutations bust only that tag, and without it
 * a school view would shape the division rows cached before the edit. A
 * school read after such an edit misses, reruns the division SQL and writes
 * the fresh rows under the same shared key, so every other scope gets them
 * too. District and division reads keep `divisionSummary` alone (300 s TTL).
 */
function rawTagsFor(scope: SummaryScope): string[] {
  return scope.kind === "school"
    ? [divisionSummary, schoolDashboard(scope.schoolId)]
    : [divisionSummary];
}

/**
 * MUST be called OUTSIDE any other `cachedQuery` callback on a page or export
 * path. Next 16's `unstable_cache` skips its cache lookup when nested inside
 * another one (`isNestedUnstableCache`): it runs the function and only writes
 * the result, so a nested read would run the division-wide SQL every time.
 * The cron warm relies on exactly that (it calls this from inside its own
 * entry to recompute and store the rows).
 *
 * `computedAt` is taken when the SQL starts and stored with the rows, so the
 * page's "Figures as of" says when the data was read, not when it was shaped.
 */
function loadDivisionRaw<T>(
  facetId: SummaryFacetId,
  sqlParams: Record<string, string | null>,
  query: (sqlParams: Record<string, string | null>) => Promise<T[]>,
  past: boolean,
  tags: string[]
): Promise<DivisionRaw<T>> {
  const keyParts = rawCacheKeyParts(facetId, sqlParams);
  // Tags are in the memo key: a read that checks a school's tag must not be
  // answered by one that did not.
  const memoKey = JSON.stringify([keyParts, tags]);
  const memo = getRawRequestMemo();
  const hit = memo.get(memoKey);
  if (hit) return hit as Promise<DivisionRaw<T>>;
  const promise = cachedQuery(
    async (): Promise<DivisionRaw<T>> => {
      const computedAt = new Date().toISOString();
      return { computedAt, rows: await query(sqlParams) };
    },
    {
      keyParts,
      tags,
      profile: "reference",
      ...(past ? { revalidate: ttlFor(true) } : {}),
    }
  );
  memo.set(memoKey, promise);
  return promise;
}

function defineFacet<S extends z.ZodTypeAny, R extends ResolvedParams, T extends ScopableRow>(def: {
  id: SummaryFacetId;
  params: S;
  resolve(parsed: z.infer<S>, todayKey: string): R;
  /** Compliance covers active schools only. */
  activeSchoolsOnly?: boolean;
  /**
   * The last month (`YYYY-MM`) the period covers, or null when the facet has no
   * month period. A period ending before the current month is "past": 3600 s TTL.
   */
  periodEnd?(params: R): string | null;
  /** Exactly what `query` receives: never `level`, nothing only `shape` reads. */
  queryInput(params: R, todayKey: string): Record<string, string | null>;
  /** The SQL step, over every school. Its rows must survive a JSON round trip (cached as JSON). */
  query(input: Record<string, string | null>): Promise<T[]>;
  /** The pure step: the scope's fenced rows to the per-level result. */
  shape(raw: ScopedRaw<T>, ctx: FacetRunContext<R>): FacetResult;
}): SummaryFacet {
  const meta = SUMMARY_FACET_META[def.id];

  /** Params, today, the SQL input and the TTL class: shared by `load` and `warmRaw` so their raw keys match. */
  function plan(rawParams: unknown) {
    const parsed = parseInput(def.params, rawParams ?? {});
    const todayKey = formatLocalDateKey(schoolToday());
    const params = def.resolve(parsed, todayKey);
    const input = def.queryInput(params, todayKey);
    const end = def.periodEnd?.(params) ?? null;
    const past = end !== null && isPastMonth(end, todayKey);
    return { params, todayKey, input, past };
  }

  return {
    id: def.id,
    label: meta.label,
    description: meta.description,
    params: def.params,
    async load(scope, rawParams) {
      const { params, todayKey, input, past } = plan(rawParams);
      const demoVisible = await isDemoVisible();
      const inScope = await resolveScopeSchools(scope, demoVisible);
      const schools = def.activeSchoolsOnly ? inScope.filter((s) => s.isActive) : inScope;
      // A top-level read, never inside another cache callback (see
      // `loadDivisionRaw`). A scope with no schools reads nothing.
      const raw: DivisionRaw<T> =
        schools.length === 0
          ? { computedAt: new Date().toISOString(), rows: [] }
          : await loadDivisionRaw(def.id, input, def.query, past, rawTagsFor(scope));
      // The tenancy fence: only `schools` (from `resolveScopeSchools`) survive.
      const scoped = scopeRaw(def.id, raw.rows, schools);
      return def.shape(scoped, { schools, params, todayKey, computedAt: raw.computedAt });
    },
    async warmRaw() {
      // The default view: no params beyond what the schema defaults. `level`
      // never reaches the SQL input, so one entry serves every level.
      const { input, past } = plan({});
      await loadDivisionRaw(def.id, input, def.query, past, [divisionSummary]);
    },
    toReportTable: summaryReportTable,
  };
}

export const SUMMARY_FACETS: Record<SummaryFacetId, SummaryFacet> = {
  learners: defineFacet({
    id: "learners",
    params: levelOnlyParamsSchema,
    resolve: (p) => ({ level: p.level }),
    queryInput: () => ({}),
    query: () => queryLearnerRows(),
    shape: (raw, { schools, params, computedAt }) =>
      shapeLearners({ raw, schools, level: params.level, computedAt }),
  }),

  "reading-behavior": defineFacet({
    id: "reading-behavior",
    params: monthParamsSchema,
    resolve: (p, todayKey) => ({ level: p.level, month: p.month ?? defaultJulyMonth(todayKey) }),
    periodEnd: (params) => params.month,
    queryInput: (params) => ({ month: params.month }),
    query: (input) => queryReadingBehaviorRows(input.month as string),
    shape: (raw, { schools, params, computedAt }) =>
      shapeReadingBehavior({ raw, schools, level: params.level, month: params.month, computedAt }),
  }),

  "end-of-term": defineFacet({
    id: "end-of-term",
    params: endOfTermParamsSchema,
    resolve: (p) => ({
      level: p.level,
      schoolYearLabel: p.schoolYearLabel ?? null,
      term: p.term ?? null,
    }),
    // `term` only picks which term to show; every term comes back in one query.
    queryInput: (params) => ({ schoolYearLabel: params.schoolYearLabel }),
    query: (input) => queryEndOfTermRows(input.schoolYearLabel ?? null),
    shape: (raw, { schools, params, computedAt }) =>
      shapeEndOfTerm({
        raw,
        schools,
        level: params.level,
        requestedLabel: params.schoolYearLabel,
        requestedTerm: params.term,
        computedAt,
      }),
  }),

  attendance: defineFacet({
    id: "attendance",
    params: monthRangeParamsSchema,
    resolve: (p, todayKey) => {
      const d = defaultMonthRange(todayKey);
      const from = p.from ?? d.from;
      const to = p.to ?? d.to;
      // `today` only bounds which weeks have started. A range wholly before the
      // current month has every week started, so the range end stands in for
      // today: the key (and the SQL) no longer change at Manila midnight.
      const end = orderedRange(from, to).to;
      return {
        level: p.level,
        from,
        to,
        today: isPastMonth(end, todayKey) ? monthEndKey(end) : todayKey,
      };
    },
    periodEnd: (params) => orderedRange(params.from, params.to).to,
    queryInput: (params) => ({ ...orderedRange(params.from, params.to), todayKey: params.today }),
    query: (input) =>
      queryAttendanceRows({
        from: input.from as string,
        to: input.to as string,
        todayKey: input.todayKey as string,
      }),
    shape: (raw, { schools, params, computedAt }) =>
      shapeAttendance({
        raw,
        schools,
        level: params.level,
        ...orderedRange(params.from, params.to),
        todayKey: params.today,
        computedAt,
      }),
  }),

  "reading-levels": defineFacet({
    id: "reading-levels",
    params: monthRangeParamsSchema,
    resolve: (p, todayKey) => {
      const d = defaultMonthRange(todayKey);
      return { level: p.level, from: p.from ?? d.from, to: p.to ?? d.to };
    },
    periodEnd: (params) => orderedRange(params.from, params.to).to,
    queryInput: (params) => orderedRange(params.from, params.to),
    query: (input) => queryReadingLevelRows({ from: input.from as string, to: input.to as string }),
    shape: (raw, { schools, params, computedAt }) =>
      shapeReadingLevels({
        raw,
        schools,
        level: params.level,
        ...orderedRange(params.from, params.to),
        computedAt,
      }),
  }),

  compliance: defineFacet({
    id: "compliance",
    params: levelOnlyParamsSchema,
    resolve: (p, todayKey) => ({ level: p.level, today: todayKey }),
    activeSchoolsOnly: true,
    queryInput: (_params, todayKey) => ({ todayKey }),
    // Active schools only: a filter on the school list `scopeRaw` receives.
    query: (input) => queryComplianceRows(input.todayKey as string),
    shape: (raw, { schools, params, todayKey, computedAt }) =>
      shapeCompliance({ raw, schools, level: params.level, todayKey, computedAt }),
  }),

  profiling: defineFacet({
    id: "profiling",
    params: levelOnlyParamsSchema,
    resolve: (p) => ({ level: p.level }),
    queryInput: () => ({}),
    query: () => queryProfilingRows(),
    shape: (raw, { schools, params, computedAt }) =>
      shapeProfiling({ raw, schools, level: params.level, computedAt }),
  }),

  aral: defineFacet({
    id: "aral",
    params: levelOnlyParamsSchema,
    resolve: (p) => ({ level: p.level }),
    queryInput: () => ({}),
    query: () => queryAralRows(),
    shape: (raw, { schools, params, computedAt }) =>
      shapeAral({ raw, schools, level: params.level, computedAt }),
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
