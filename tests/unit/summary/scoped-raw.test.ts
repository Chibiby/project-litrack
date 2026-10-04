import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  ALL_RAW_SCHOOL_IDS,
  DIVISION_SCHOOLS,
  divisionRaw,
  oldDefaultLabel,
  oldLabelOptions,
  PROFILES,
  schoolTokens,
  scopeReferenceRaw,
} from "./raw-fixtures";

/**
 * The Division Summary's tenancy fence (`scopeRaw`) and the one shared,
 * division-wide raw cache entry per facet and period.
 *
 * The SQL now runs over every school and its rows are cached once; each scope
 * keeps only its own schools' rows before shaping. These tests hold:
 * 1. for every facet, scope and level, the page is exactly what the old
 *    per-scope query gave (the "reference" raw is what that query returned);
 * 2. nothing that only an out-of-scope school has reaches the output;
 * 3. rows with no school are dropped, except attendance holidays of a kept
 *    roster's grade level;
 * 4. every scope and level of one period runs the SQL once; the raw entry is
 *    the only facet entry, read at the top level (never nested), so a cached
 *    raw entry serves every scope and level with no database call;
 * 5. raw rows survive the Data Cache's JSON round trip;
 * 6. every summary statement runs with `SET LOCAL work_mem` in a transaction
 *    with a 30 s timeout;
 * 7. the cron warm writes the very raw entry a default page reads.
 */

const schoolFindMany = vi.fn();
const queryRaw = vi.fn();
const executeRaw = vi.fn();
const transaction = vi.fn(
  async (fn: (tx: { $queryRaw: typeof queryRaw; $executeRaw: typeof executeRaw }) => unknown, _opts: unknown) =>
    fn({ $queryRaw: queryRaw, $executeRaw: executeRaw })
);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findMany() {
        return schoolFindMany;
      },
    },
    get $queryRaw() {
      return queryRaw;
    },
    get $executeRaw() {
      return executeRaw;
    },
    get $transaction() {
      return transaction;
    },
  },
}));

/**
 * The Data Cache: one entry per key, stored as JSON like the real one. It also
 * records how deep inside another entry's function each call was made: Next
 * 16's `unstable_cache` never READS its cache when nested in another one
 * (`isNestedUnstableCache`), so a nested read would rerun its query every
 * time. `nestedCalls` counts cache calls made at depth > 0.
 */
type CacheOptions = { keyParts: string[]; tags: string[] };
const store = new Map<string, string>();
let cacheDepth = 0;
let nestedCalls = 0;
const cachedQuery = vi.fn(async (fn: () => Promise<unknown>, opts: CacheOptions) => {
  if (cacheDepth > 0) nestedCalls++;
  const key = JSON.stringify(opts.keyParts);
  if (!store.has(key)) {
    cacheDepth++;
    try {
      store.set(key, JSON.stringify(await fn()));
    } finally {
      cacheDepth--;
    }
  }
  return JSON.parse(store.get(key)!);
});
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>, opts: CacheOptions) => cachedQuery(fn, opts),
}));

const isDemoVisible = vi.fn(async () => false);
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: () => isDemoVisible() }));

const { SUMMARY_FACETS, rawCacheKeyParts, facetParamsFromSearch } = await import("@/lib/summary/facets");
const { scopeRaw } = await import("@/lib/summary/scoped-raw");
const { shapeLearners } = await import("@/lib/summary/queries/learners");
const { shapeReadingBehavior } = await import("@/lib/summary/queries/reading-behavior");
const { shapeEndOfTerm, schoolYearLabelChoice } = await import("@/lib/summary/queries/end-of-term");
const { shapeAttendance } = await import("@/lib/summary/queries/attendance");
const { shapeReadingLevels } = await import("@/lib/summary/queries/reading-levels");
const { shapeCompliance } = await import("@/lib/summary/queries/compliance");
const { shapeProfiling } = await import("@/lib/summary/queries/profiling");
const { shapeAral } = await import("@/lib/summary/queries/aral");

type SummaryScope = import("@/lib/auth/admin-scope").SummaryScope;
type SummaryFacetId = import("@/lib/summary/types").SummaryFacetId;
type SummaryLevel = import("@/lib/summary/types").SummaryLevel;
type FacetResult = import("@/lib/summary/types").FacetResult;
type ScopeSchool = import("@/lib/summary/types").ScopeSchool;
type ScopedRaw<T> = import("@/lib/summary/scoped-raw").ScopedRaw<T>;
type RawAttendanceRow = import("@/lib/summary/queries/attendance").RawAttendanceRow;
type RawTermRow = import("@/lib/summary/queries/end-of-term").RawTermRow;

const FACET_IDS = Object.keys(SUMMARY_FACETS) as SummaryFacetId[];
const LEVELS: SummaryLevel[] = ["overall", "district", "school"];

/** Params each facet is loaded with; month facets pinned so the fixtures' weeks are in range. */
const PARAMS: Record<SummaryFacetId, Record<string, string>> = {
  learners: {},
  "reading-behavior": { month: "2026-07" },
  "end-of-term": {},
  attendance: { from: "2026-09", to: "2026-09" },
  "reading-levels": { from: "2026-09", to: "2026-09" },
  compliance: {},
  profiling: {},
  aral: {},
};

/** Scopes and the schools each must cover, written out by hand (name order). */
const SCOPES: { name: string; scope: SummaryScope; demo: boolean; ids: string[] }[] = [
  {
    name: "division",
    scope: { kind: "all" },
    demo: false,
    ids: ["sch-alabel-ces", "sch-bagacay", "sch-glan-ces", "sch-gumasa", "sch-nodistrict"],
  },
  {
    name: "division, demo session",
    scope: { kind: "all" },
    demo: true,
    ids: ["sch-alabel-ces", "sch-bagacay", "sch-demo", "sch-glan-ces", "sch-gumasa", "sch-nodistrict"],
  },
  {
    name: "districts:[Alabel 1]",
    scope: { kind: "districts", districts: ["Alabel 1"] },
    demo: true, // a district scope never includes the demo school, demo session or not
    ids: ["sch-alabel-ces", "sch-bagacay"],
  },
  {
    name: "districts:[Glan 1]",
    scope: { kind: "districts", districts: ["Glan 1"] },
    demo: false,
    ids: ["sch-glan-ces", "sch-gumasa"],
  },
  {
    name: "districts:[Alabel 1, Glan 1]",
    scope: { kind: "districts", districts: ["Alabel 1", "Glan 1"] },
    demo: false,
    ids: ["sch-alabel-ces", "sch-bagacay", "sch-glan-ces", "sch-gumasa"],
  },
  {
    name: "school",
    scope: { kind: "school", schoolId: "sch-glan-ces" },
    demo: false,
    ids: ["sch-glan-ces"],
  },
];

let currentLabel: string | null = null;
let currentFacet: SummaryFacetId = "learners";

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  cacheDepth = 0;
  nestedCalls = 0;
  currentLabel = null;
  schoolFindMany.mockResolvedValue(DIVISION_SCHOOLS);
  queryRaw.mockImplementation(async () => divisionRaw(currentFacet, currentLabel));
  isDemoVisible.mockResolvedValue(false);
});

function scopeSchools(ids: readonly string[], activeOnly: boolean): ScopeSchool[] {
  return DIVISION_SCHOOLS.filter((s) => ids.includes(s.id) && (!activeOnly || s.isActive)).map(
    ({ isDemo: _isDemo, ...s }) => s
  );
}

/** Raw-row order as the SQL emits it: the fixture's school order. */
function inRawOrder(ids: readonly string[]): string[] {
  return ALL_RAW_SCHOOL_IDS.filter((id) => ids.includes(id));
}

/** What the page showed before: the shape of the per-scope query's rows. */
function referenceResult(
  facet: SummaryFacetId,
  ids: readonly string[],
  level: SummaryLevel,
  params: Record<string, string | null>,
  requestedLabel: string | null
): FacetResult {
  const activeOnly = facet === "compliance";
  const schools = scopeSchools(ids, activeOnly);
  // The old query's output is by construction fenced: cast is the test's
  // stand-in for "the SQL ran for exactly these schools".
  const raw = scopeReferenceRaw(facet, inRawOrder(schools.map((s) => s.id)), requestedLabel) as unknown as ScopedRaw<never>;
  const computedAt = "T";
  switch (facet) {
    case "learners":
      return shapeLearners({ raw, schools, level, computedAt });
    case "reading-behavior":
      return shapeReadingBehavior({ raw, schools, level, month: params.month!, computedAt });
    case "end-of-term":
      return shapeEndOfTerm({ raw, schools, level, requestedLabel, requestedTerm: null, computedAt });
    case "attendance":
      return shapeAttendance({ raw, schools, level, from: params.from!, to: params.to!, todayKey: params.today!, computedAt });
    case "reading-levels":
      return shapeReadingLevels({ raw, schools, level, from: params.from!, to: params.to!, computedAt });
    case "compliance":
      return shapeCompliance({ raw, schools, level, todayKey: params.today!, computedAt });
    case "profiling":
      return shapeProfiling({ raw, schools, level, computedAt });
    case "aral":
      return shapeAral({ raw, schools, level, computedAt });
  }
}

async function load(
  facet: SummaryFacetId,
  scope: SummaryScope,
  demo: boolean,
  level: SummaryLevel,
  extra: Record<string, string> = {}
): Promise<FacetResult> {
  currentFacet = facet;
  isDemoVisible.mockResolvedValue(demo);
  const res = await SUMMARY_FACETS[facet].load(scope, { ...PARAMS[facet], ...extra, level });
  return { ...res, computedAt: "T" };
}

describe("(1) the fenced division raw shapes exactly like the per-scope query", () => {
  describe.each(FACET_IDS)("%s", (facet) => {
    it.each(SCOPES.flatMap((s) => LEVELS.map((level) => [s.name, level, s] as const)))(
      "%s, level %s",
      async (_name, level, s) => {
        const res = await load(facet, s.scope, s.demo, level);
        expect(res).toEqual(referenceResult(facet, s.ids, level, res.params, null));
      }
    );
  });

  it.each(SCOPES.map((s) => [s.name, s] as const))(
    "end-of-term %s: default school year and picker match the old SQL",
    async (_name, s) => {
      const res = await load("end-of-term", s.scope, s.demo, "overall");
      expect(res.params.schoolYearLabel).toBe(oldDefaultLabel(s.ids));
      expect(res.options?.schoolYearLabels).toEqual(oldLabelOptions(s.ids));
    }
  );

  it("end-of-term: the Glan default differs from the division's, and each scope gets its own", async () => {
    const division = await load("end-of-term", { kind: "all" }, false, "overall");
    const glan = await load("end-of-term", { kind: "districts", districts: ["Glan 1"] }, false, "overall");
    expect(division.params.schoolYearLabel).toBe("2026-2027");
    expect(glan.params.schoolYearLabel).toBe("2025-2026");
    expect(glan.params.term).toBe("SECOND");
  });

  it.each(SCOPES.map((s) => [s.name, s] as const))(
    "end-of-term %s with a requested school year",
    async (_name, s) => {
      currentLabel = "2025-2026";
      const res = await load("end-of-term", s.scope, s.demo, "school", { schoolYearLabel: "2025-2026" });
      expect(res).toEqual(referenceResult("end-of-term", s.ids, "school", res.params, "2025-2026"));
      expect(res.params.schoolYearLabel).toBe("2025-2026");
    }
  );
});

describe("(2) nothing only an out-of-scope school has reaches the output", () => {
  const ORPHAN_TOKENS = ["Orphan Designation", "2060-2061", "gl-orphan"];

  function leakTokens(inIds: readonly string[]): string[] {
    const inTokens = new Set(inIds.flatMap(schoolTokens));
    const out = ALL_RAW_SCHOOL_IDS.filter((id) => !inIds.includes(id)).flatMap(schoolTokens);
    return [...new Set(out)].filter((t) => !inTokens.has(t)).concat(ORPHAN_TOKENS);
  }

  const inScope = (ids: readonly string[], key: "age" | "gt" | "term") => new Set(ids.map((id) => PROFILES[id]![key]));

  describe.each(FACET_IDS)("%s", (facet) => {
    it.each(SCOPES.flatMap((s) => LEVELS.map((level) => [s.name, level, s] as const)))(
      "%s, level %s",
      async (_name, level, s) => {
        const ids = facet === "compliance" ? scopeSchools(s.ids, true).map((x) => x.id) : s.ids;
        const res = await load(facet, s.scope, s.demo, level);
        const text = JSON.stringify(res);
        for (const token of leakTokens(ids)) expect(text, `leaked "${token}"`).not.toContain(token);

        const gts = new Set(["G3", ...inScope(ids, "gt")]);
        const section = (id: string) => res.sections.find((x) => x.id === id)!;
        if (facet === "learners") {
          const ages = new Set(["10", ...inScope(ids, "age")]);
          for (const b of section("age").buckets) expect(ages).toContain(b.id);
          for (const g of Object.keys(section("englishProfile").gradeBucketLabels ?? {})) expect(gts).toContain(g);
        }
        if (facet === "reading-levels") {
          for (const g of Object.keys(res.sections[0]!.gradeBucketLabels ?? {})) expect(gts).toContain(g);
        }
        if (facet === "aral") {
          const shown = section("learnersByGrade").buckets.map((b) => b.id);
          for (const g of shown) expect(gts).toContain(g);
        }
        if (facet === "end-of-term") {
          const labels = new Set(ids.flatMap((id) => PROFILES[id]!.years.map((y) => y.label)));
          for (const l of res.options?.schoolYearLabels ?? []) expect(labels).toContain(l);
          // The latest term with grades is the scope's, not another school's.
          expect([...inScope(ids, "term"), "FIRST"]).toContain(res.params.term);
        }
        if (level === "school") {
          const shownIds = new Set(res.sections.flatMap((x) => x.table.groups.map((g) => g.schoolId)).filter(Boolean));
          for (const id of shownIds) expect(ids).toContain(id);
        }
      }
    );
  });
});

describe("(3) rows with no school are dropped, fail closed", () => {
  const SCHOOLS = [{ id: "sch-glan-ces" }];

  it("drops a null-school count row and rows of schools not in the list", () => {
    const raw = [
      { school_id: "sch-glan-ces", n: 1 },
      { school_id: null, n: 2 },
      { school_id: "sch-gumasa", n: 3 },
    ];
    expect([...scopeRaw("learners", raw, SCHOOLS)]).toEqual([{ school_id: "sch-glan-ces", n: 1 }]);
  });

  it("keeps an attendance holiday only for the grade level of a kept roster row", () => {
    const raw: RawAttendanceRow[] = [
      { kind: "roster", school_id: "sch-glan-ces", grade_level_id: "gl-glan", gt: "G3", week: null, n: 10 },
      { kind: "roster", school_id: "sch-gumasa", grade_level_id: "gl-gumasa", gt: "G3", week: null, n: 10 },
      { kind: "holiday", school_id: null, grade_level_id: "gl-glan", gt: null, week: "2026-09-07", n: 1 },
      { kind: "holiday", school_id: null, grade_level_id: "gl-gumasa", gt: null, week: "2026-09-07", n: 1 },
      { kind: "holiday", school_id: null, grade_level_id: "gl-orphan", gt: null, week: "2026-09-07", n: 1 },
      { kind: "holiday", school_id: null, grade_level_id: null, gt: null, week: "2026-09-07", n: 1 },
      { kind: "marks", school_id: null, grade_level_id: null, gt: null, week: null, n: 4 },
      { kind: "present", school_id: null, grade_level_id: "gl-glan", gt: null, week: "2026-09-07", n: 4 },
    ];
    const kept = scopeRaw("attendance", raw, SCHOOLS);
    expect(kept.map((r) => `${r.kind}:${r.grade_level_id}`)).toEqual(["roster:gl-glan", "holiday:gl-glan"]);
  });

  it("does not keep a holiday row for any other facet", () => {
    const raw = [{ kind: "holiday", school_id: null, grade_level_id: "gl-glan" }];
    expect(scopeRaw("learners", raw, SCHOOLS)).toHaveLength(0);
  });

  it("keeps nothing for a scope with no schools", () => {
    for (const facet of FACET_IDS) {
      expect(scopeRaw(facet, divisionRaw(facet) as { school_id: string | null }[], [])).toHaveLength(0);
    }
  });

  it.each(FACET_IDS)("%s: the division raw's orphan and deleted-school rows never survive", (facet) => {
    const live = DIVISION_SCHOOLS.map((s) => ({ id: s.id }));
    const kept = scopeRaw(facet, divisionRaw(facet) as { school_id: string | null; kind?: string }[], live);
    for (const r of kept) {
      if (r.school_id === null) expect(facet === "attendance" && r.kind === "holiday").toBe(true);
      else expect(live.map((s) => s.id)).toContain(r.school_id);
    }
    expect(kept.some((r) => r.school_id === "sch-deleted")).toBe(false);
  });
});

describe("(4) every scope and level of a period runs the SQL once", () => {
  it.each(FACET_IDS)("%s", async (facet) => {
    for (const s of SCOPES) {
      for (const level of LEVELS) await load(facet, s.scope, s.demo, level);
    }
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    // The one raw entry carries no scope, no demo flag and no level.
    const rawKeys = cachedQuery.mock.calls.map(([, o]) => o).filter((o) => o.keyParts[0] === "summary-raw");
    expect(new Set(rawKeys.map((o) => JSON.stringify(o.keyParts))).size).toBe(1);
    expect(rawKeys[0]!.tags).toEqual(["division-summary"]);
  });

  it("the raw key is the SQL params only", () => {
    expect(rawCacheKeyParts("attendance", { from: "2026-09", to: "2026-09", todayKey: "2026-10-04" })).toEqual([
      "summary-raw",
      "attendance",
      "v3",
      JSON.stringify({ from: "2026-09", to: "2026-09", todayKey: "2026-10-04" }),
    ]);
  });

  it("a different period is a different raw entry", async () => {
    await load("reading-levels", { kind: "all" }, false, "overall");
    await load("reading-levels", { kind: "all" }, false, "overall", { from: "2026-08", to: "2026-08" });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each(FACET_IDS)("%s: no cache call on the load path is nested inside another", async (facet) => {
    for (const s of SCOPES) {
      for (const level of LEVELS) await load(facet, s.scope, s.demo, level);
    }
    expect(cachedQuery.mock.calls.some(([, o]) => o.keyParts[0] === "summary-raw")).toBe(true);
    expect(nestedCalls).toBe(0);
  });

  it.each(FACET_IDS)("%s: the raw entry is the only facet cache entry (no per-scope entry)", async (facet) => {
    for (const s of SCOPES) {
      for (const level of LEVELS) await load(facet, s.scope, s.demo, level);
    }
    const kinds = new Set(cachedQuery.mock.calls.map(([, o]) => o.keyParts[0]));
    expect([...kinds].sort()).toEqual(["summary-raw", "summary-scope-schools"]);
  });

  it.each(FACET_IDS)("%s: once the raw entry is cached, any other scope or level runs no SQL", async (facet) => {
    await load(facet, { kind: "all" }, false, "overall");
    expect(queryRaw).toHaveBeenCalledTimes(1);
    queryRaw.mockClear();
    transaction.mockClear();
    executeRaw.mockClear();
    for (const s of SCOPES) {
      for (const level of LEVELS) await load(facet, s.scope, s.demo, level);
    }
    expect(queryRaw).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it.each(FACET_IDS)("%s: with the raw and school-list entries cached, a load never touches the database", async (facet) => {
    // Fill the Data Cache, then drop every database mock's history.
    await load(facet, { kind: "all" }, false, "overall");
    vi.clearAllMocks();
    for (const s of SCOPES) {
      for (const level of LEVELS) await load(facet, s.scope, s.demo, level);
    }
    expect(schoolFindMany).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(FACET_IDS)("%s: 'Figures as of' is when the raw entry was read, at every scope and level", async (facet) => {
    currentFacet = facet;
    const first = await SUMMARY_FACETS[facet].load({ kind: "all" }, { ...PARAMS[facet], level: "overall" });
    const [rawKey] = [...store.keys()].filter((k) => k.startsWith('["summary-raw"'));
    const stored = JSON.parse(store.get(rawKey!)!) as { computedAt: string; rows: unknown[] };
    expect(typeof stored.computedAt).toBe("string");
    expect(Array.isArray(stored.rows)).toBe(true);
    expect(first.computedAt).toBe(stored.computedAt);
    for (const s of SCOPES) {
      if (scopeSchools(s.ids, facet === "compliance").length === 0) continue;
      for (const level of LEVELS) {
        isDemoVisible.mockResolvedValue(s.demo);
        const res = await SUMMARY_FACETS[facet].load(s.scope, { ...PARAMS[facet], level });
        expect(res.computedAt).toBe(stored.computedAt);
      }
    }
  });

  it.each(FACET_IDS)("%s: a school scope's raw read checks that school's dashboard tag", async (facet) => {
    const rawTags = () =>
      cachedQuery.mock.calls.map(([, o]) => o).filter((o) => o.keyParts[0] === "summary-raw").map((o) => o.tags);
    await load(facet, { kind: "school", schoolId: "sch-glan-ces" }, false, "overall");
    expect(rawTags()).toEqual([["division-summary", "school-dashboard:sch-glan-ces"]]);
    cachedQuery.mockClear();
    await load(facet, { kind: "districts", districts: ["Glan 1"] }, false, "overall");
    expect(rawTags()).toEqual([["division-summary"]]);
  });

  it("a scope with no schools runs no SQL", async () => {
    schoolFindMany.mockResolvedValue([]);
    for (const facet of FACET_IDS) await load(facet, { kind: "all" }, false, "overall");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("(5) raw rows survive the Data Cache's JSON round trip", () => {
  it.each(FACET_IDS)("%s", (facet) => {
    const raw = divisionRaw(facet);
    const back = JSON.parse(JSON.stringify(raw));
    expect(back).toEqual(raw);
    const live = DIVISION_SCHOOLS.map((s) => ({ id: s.id }));
    expect([...scopeRaw(facet, back, live)]).toEqual([...scopeRaw(facet, raw, live)]);
  });
});

describe("(6) every summary statement raises work_mem inside a bounded transaction", () => {
  it.each(FACET_IDS)("%s", async (facet) => {
    await load(facet, { kind: "all" }, false, "overall");

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]![1]).toEqual({ timeout: 30000, maxWait: 10000 });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const set = (executeRaw.mock.calls[0]![0] as TemplateStringsArray).join("?");
    expect(set).toBe("SET LOCAL work_mem = '64MB'");
    expect(executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(queryRaw.mock.invocationCallOrder[0]!);

    const sql = queryRaw.mock.calls[0]![0] as Prisma.Sql;
    expect(sql.sql).toMatch(/^\s*WITH /);
    // Division-wide: no school id is bound into the statement.
    const ids = new Set<string>(ALL_RAW_SCHOOL_IDS);
    const bound = sql.values.flat(2);
    expect(bound.some((v) => typeof v === "string" && ids.has(v))).toBe(false);
  });
});

describe("(7) the warm writes the raw entry a default page reads", () => {
  const rawCalls = () =>
    cachedQuery.mock.calls.map(([, o]) => o).filter((o) => o.keyParts[0] === "summary-raw");

  it.each(FACET_IDS)("%s: same key as a page with no period in its URL, then no SQL for that page", async (facet) => {
    currentFacet = facet;
    await SUMMARY_FACETS[facet].warmRaw();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const warmed = rawCalls();
    expect(warmed).toHaveLength(1);
    expect(warmed[0]!.tags).toEqual(["division-summary"]);
    // The warm shapes no scope and reads no school list.
    expect(schoolFindMany).not.toHaveBeenCalled();

    cachedQuery.mockClear();
    queryRaw.mockClear();
    for (const level of LEVELS) {
      const params = facetParamsFromSearch(SUMMARY_FACETS[facet], level === "overall" ? {} : { level });
      await SUMMARY_FACETS[facet].load({ kind: "all" }, params);
    }
    const page = rawCalls();
    expect(page.map((o) => JSON.stringify(o.keyParts))).toEqual(
      LEVELS.map(() => JSON.stringify(warmed[0]!.keyParts))
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("schoolYearLabelChoice", () => {
  const row = (school: string, label: string, n: number): RawTermRow => ({
    kind: "label", school_id: school, gt: null, term: null, legacy_area: null, subject_name: null,
    legacy_subject: null, bucket: label, label, n, total: 0, n80: 0,
  });
  const fence = (rows: RawTermRow[]) => scopeRaw("end-of-term", rows, [{ id: "a" }, { id: "b" }, { id: "c" }]);

  it("breaks a tie toward the higher label, like ORDER BY COUNT(*) DESC, label DESC", () => {
    const raw = fence([row("a", "2025-2026", 1), row("b", "2026-2027", 1)]);
    expect(schoolYearLabelChoice(raw, null).selected).toBe("2026-2027");
  });

  it("counts active rows only, and ignores a label with none", () => {
    const raw = fence([row("a", "2027-2028", 0), row("b", "2025-2026", 1), row("c", "2025-2026", 1), row("a", "2026-2027", 1)]);
    expect(schoolYearLabelChoice(raw, null)).toEqual({
      options: ["2027-2028", "2026-2027", "2025-2026"],
      selected: "2025-2026",
    });
  });

  it("returns the requested label as is, and null when nothing is active", () => {
    expect(schoolYearLabelChoice(fence([row("a", "2025-2026", 0)]), null).selected).toBeNull();
    expect(schoolYearLabelChoice(fence([row("a", "2025-2026", 1)]), "2019-2020").selected).toBe("2019-2020");
  });
});
