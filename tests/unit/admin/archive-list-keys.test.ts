import { describe, expect, it } from "vitest";
import { listKey } from "@/lib/nav/list-params";
import { ARCHIVE_TEACHERS_KEYS, ARCHIVE_LEARNERS_KEYS } from "@/components/admin/archive-view";

/**
 * `/admin/archive` has TWO independently paginated, independently sortable
 * lists on ONE url. `ArchiveView` keys the teachers panel's `<Suspense>` on
 * `ARCHIVE_TEACHERS_KEYS` and the learners panel's on `ARCHIVE_LEARNERS_KEYS`
 * — this file guards the independence guarantee those two key lists exist to
 * provide: paging or re-sorting one bucket must never change the OTHER
 * bucket's Suspense key (which would force it to re-suspend and flash a
 * skeleton it has no reason to show), while the shared `school`/`q` filters
 * legitimately change both.
 */

describe("archive Suspense keys — teachers/learners independence", () => {
  it("paging TEACHERS changes the teachers key but not the learners key", () => {
    const before = { school: "", q: "", teachers: "1", learners: "3", teachersSort: "", learnersSort: "" };
    const after = { ...before, teachers: "2" };

    expect(listKey(before, ARCHIVE_TEACHERS_KEYS)).not.toBe(listKey(after, ARCHIVE_TEACHERS_KEYS));
    expect(listKey(before, ARCHIVE_LEARNERS_KEYS)).toBe(listKey(after, ARCHIVE_LEARNERS_KEYS));
  });

  it("paging LEARNERS changes the learners key but not the teachers key", () => {
    const before = { school: "", q: "", teachers: "1", learners: "3", teachersSort: "", learnersSort: "" };
    const after = { ...before, learners: "4" };

    expect(listKey(before, ARCHIVE_LEARNERS_KEYS)).not.toBe(listKey(after, ARCHIVE_LEARNERS_KEYS));
    expect(listKey(before, ARCHIVE_TEACHERS_KEYS)).toBe(listKey(after, ARCHIVE_TEACHERS_KEYS));
  });

  it("re-sorting TEACHERS changes the teachers key but not the learners key", () => {
    const before = { teachersSort: "recent", learnersSort: "recent" };
    const after = { ...before, teachersSort: "alphabetical" };

    expect(listKey(before, ARCHIVE_TEACHERS_KEYS)).not.toBe(listKey(after, ARCHIVE_TEACHERS_KEYS));
    expect(listKey(before, ARCHIVE_LEARNERS_KEYS)).toBe(listKey(after, ARCHIVE_LEARNERS_KEYS));
  });

  it("re-sorting LEARNERS changes the learners key but not the teachers key", () => {
    const before = { teachersSort: "recent", learnersSort: "recent" };
    const after = { ...before, learnersSort: "school" };

    expect(listKey(before, ARCHIVE_LEARNERS_KEYS)).not.toBe(listKey(after, ARCHIVE_LEARNERS_KEYS));
    expect(listKey(before, ARCHIVE_TEACHERS_KEYS)).toBe(listKey(after, ARCHIVE_TEACHERS_KEYS));
  });

  it("changing the shared `school` filter changes BOTH keys", () => {
    const before = { school: "", q: "" };
    const after = { school: "school-1", q: "" };

    expect(listKey(before, ARCHIVE_TEACHERS_KEYS)).not.toBe(listKey(after, ARCHIVE_TEACHERS_KEYS));
    expect(listKey(before, ARCHIVE_LEARNERS_KEYS)).not.toBe(listKey(after, ARCHIVE_LEARNERS_KEYS));
  });

  it("changing the shared `q` filter changes BOTH keys", () => {
    const before = { school: "", q: "" };
    const after = { school: "", q: "cruz" };

    expect(listKey(before, ARCHIVE_TEACHERS_KEYS)).not.toBe(listKey(after, ARCHIVE_TEACHERS_KEYS));
    expect(listKey(before, ARCHIVE_LEARNERS_KEYS)).not.toBe(listKey(after, ARCHIVE_LEARNERS_KEYS));
  });
});
