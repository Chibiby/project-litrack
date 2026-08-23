import { beforeEach, describe, expect, it, vi } from "vitest";
import { schoolDashboard } from "@/lib/cache/tags";

/**
 * `getGradeSections`' cache key, which is the whole reason the function exists.
 *
 * Five roster surfaces share one Data Cache entry only if they mint the same key
 * from the same school and grade set. Two things in
 * `src/lib/cache/grade-sections.ts` make that true, and neither is visible to
 * typecheck or to any assertion on the returned rows:
 *
 * 1. the `.sort()` on a **copy** at `:41`, so `[a,b]` and `[b,a]` are one entry
 *    and the caller's own array is left alone;
 * 2. the `.join(",")` at `:55`, so the ids occupy one key part with a separator
 *    rather than being concatenated into an ambiguous string.
 *
 * Lose either and nothing breaks loudly — the reads just stop sharing, the hit
 * rate quietly drops to zero, and every surface pays full price again. That is a
 * silent regression of exactly the kind this task was for, so it is asserted on
 * the key itself rather than on anything the query returns.
 */

const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";

type CacheCall = {
  keyParts: string[];
  options: { tags: string[]; revalidate?: number | false };
};

/** Every `unstable_cache(...)` registration, in call order. */
let cacheCalls: CacheCall[] = [];

type FindManyArgs = {
  where: {
    schoolId: string;
    deletedAt: null;
    gradeLevelId: { in: string[] };
  };
};

let findManyArgs: FindManyArgs[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    section: {
      findMany: async (args: FindManyArgs) => {
        findManyArgs.push(args);
        return [];
      },
    },
  },
}));

// Captures what `cachedQuery` handed Next, then returns `fn` unwrapped so the
// read still runs. The key parts are the subject here, so they are recorded
// rather than discarded.
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => unknown,
    keyParts: string[],
    options: { tags: string[]; revalidate?: number | false }
  ) => {
    cacheCalls.push({ keyParts, options });
    return fn;
  },
}));

const { getGradeSections } = await import("@/lib/cache/grade-sections");

beforeEach(() => {
  cacheCalls = [];
  findManyArgs = [];
});

describe("getGradeSections — cache key composition", () => {
  it("puts permuted grade ids on one cache entry", async () => {
    await getGradeSections({
      schoolId: SCHOOL_ID,
      gradeLevelIds: ["g-3", "g-1", "g-2"],
    });
    await getGradeSections({
      schoolId: SCHOOL_ID,
      gradeLevelIds: ["g-2", "g-3", "g-1"],
    });

    expect(cacheCalls).toHaveLength(2);
    expect(cacheCalls[0].keyParts).toEqual(cacheCalls[1].keyParts);
    // Pinned, not just compared: two calls that both produced a *constant* key
    // would satisfy the equality above while sharing nothing meaningful.
    expect(cacheCalls[0].keyParts).toEqual([
      "grade-sections-v1",
      SCHOOL_ID,
      "g-1,g-2,g-3",
    ]);

    // The read really ran, and it ran on the sorted ids.
    expect(findManyArgs).toHaveLength(2);
    expect(findManyArgs[0].where).toEqual({
      schoolId: SCHOOL_ID,
      deletedAt: null,
      gradeLevelId: { in: ["g-1", "g-2", "g-3"] },
    });
  });

  it("keeps two different grade sets on different entries", async () => {
    // Chosen so a bare concatenation collides where the join does not: without
    // the separator both of these become "abc", and two different grade sets
    // would serve each other's sections.
    await getGradeSections({ schoolId: SCHOOL_ID, gradeLevelIds: ["a", "bc"] });
    await getGradeSections({ schoolId: SCHOOL_ID, gradeLevelIds: ["ab", "c"] });

    expect(cacheCalls[0].keyParts).not.toEqual(cacheCalls[1].keyParts);
    expect(cacheCalls[0].keyParts.at(-1)).toBe("a,bc");
    expect(cacheCalls[1].keyParts.at(-1)).toBe("ab,c");
  });

  it("keeps the schoolId in the key and the tag, so two schools never share an entry", async () => {
    const gradeLevelIds = ["g-1", "g-2"];
    await getGradeSections({ schoolId: SCHOOL_ID, gradeLevelIds });
    await getGradeSections({ schoolId: OTHER_SCHOOL_ID, gradeLevelIds });

    // Same grades, different schools: the entries must not be shared, and each
    // must be bustable without touching the other.
    expect(cacheCalls[0].keyParts).toContain(SCHOOL_ID);
    expect(cacheCalls[1].keyParts).toContain(OTHER_SCHOOL_ID);
    expect(cacheCalls[0].keyParts).not.toEqual(cacheCalls[1].keyParts);
    expect(cacheCalls[0].options.tags).toEqual([schoolDashboard(SCHOOL_ID)]);
    expect(cacheCalls[1].options.tags).toEqual([
      schoolDashboard(OTHER_SCHOOL_ID),
    ]);
  });

  it("sorts a copy and leaves the caller's array alone", async () => {
    // The callers pass arrays they go on to use for their own rendering, so the
    // sort has to be on a copy. `.sort()` on the argument itself would pass every
    // assertion above and reorder a grade list somewhere upstream.
    const gradeLevelIds = ["g-3", "g-1", "g-2"];
    await getGradeSections({ schoolId: SCHOOL_ID, gradeLevelIds });

    expect(gradeLevelIds).toEqual(["g-3", "g-1", "g-2"]);
  });
});
