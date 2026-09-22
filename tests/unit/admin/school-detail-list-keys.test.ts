import { describe, expect, it } from "vitest";
import { listKey } from "@/lib/nav/list-params";
import { SCHOOL_LEARNERS_KEYS } from "@/components/admin/school-detail-view";

/**
 * `/admin/schools/[schoolId]` keys the LEARNERS panel's `<Suspense>` on
 * `SCHOOL_LEARNERS_KEYS`. The (unpaginated, client-sorted) teachers table has
 * no Suspense key at all — it never re-fetches — so there is no pairwise
 * independence to prove here the way there is on the archive page; this just
 * guards that the learners key actually reacts to the params that change its
 * rows.
 */

describe("school-detail learners Suspense key", () => {
  it("changes when the learners page changes", () => {
    const before = { learners: "1", learnersSort: "alphabetical" };
    const after = { ...before, learners: "2" };
    expect(listKey(before, SCHOOL_LEARNERS_KEYS)).not.toBe(listKey(after, SCHOOL_LEARNERS_KEYS));
  });

  it("changes when the learners sort changes", () => {
    const before = { learners: "1", learnersSort: "alphabetical" };
    const after = { ...before, learnersSort: "grade-level" };
    expect(listKey(before, SCHOOL_LEARNERS_KEYS)).not.toBe(listKey(after, SCHOOL_LEARNERS_KEYS));
  });

  it("stays the same when an absent param is normalized to empty", () => {
    const withUndefined = { learnersSort: "alphabetical" };
    const withEmptyString = { learners: "", learnersSort: "alphabetical" };
    expect(listKey(withUndefined, SCHOOL_LEARNERS_KEYS)).toBe(
      listKey(withEmptyString, SCHOOL_LEARNERS_KEYS)
    );
  });
});
