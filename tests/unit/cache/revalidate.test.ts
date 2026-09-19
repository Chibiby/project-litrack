import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tags from "@/lib/cache/tags";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * `revalidateSchoolHeadTeachers` is exercised, for real, against a recording
 * `next/cache` double — everything downstream of it (`revalidatePath`,
 * `revalidateTag`) is mocked, but the fold inside `revalidate.ts` itself is not.
 *
 * That fold is the point of this file. `revalidateSchoolHeadTeachers` used to
 * require every call site to *also* call `revalidateSchoolDashboard(schoolId)`
 * so the dashboard's pending-approval and teacher counts did not go stale.
 * Eight call sites across `school-head.ts` and `teacher.ts` did that pairing by
 * hand; the explicit calls are gone now because `revalidateSchoolHeadTeachers`
 * busts the dashboard itself. The four action-level test files that used to
 * assert the explicit pairing can no longer observe it — they mock
 * `@/lib/cache/revalidate` wholesale, so a mocked `revalidateSchoolHeadTeachers`
 * never runs the real function's body. This test is what actually still fails
 * if the fold is deleted from `src/lib/cache/revalidate.ts`: remove the
 * `revalidateSchoolDashboard(schoolId)` line from `revalidateSchoolHeadTeachers`
 * and the `schoolDashboard`/`schoolName` tag assertions below go missing from
 * `revalidateTag`'s calls while every action-level test stays green, because
 * they only assert their own mock was invoked with a `schoolId`.
 */

const SCHOOL_ID = "school-1";

const revalidatePath = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [never])),
  revalidateTag: (...args: unknown[]) => revalidateTag(...(args as [never])),
}));

// Imported after the mock factory above is registered — this is the real
// module under test, not a double of it.
const { revalidateSchoolHeadTeachers, revalidateSchoolDashboard } = await import(
  "@/lib/cache/revalidate"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("revalidateSchoolHeadTeachers", () => {
  it("busts the school dashboard and school name tags, not just the teacher tag", async () => {
    revalidateSchoolHeadTeachers(SCHOOL_ID);

    // The teacher-list side, tenant-scoped.
    expect(revalidateTag).toHaveBeenCalledWith(tags.schoolTeachers(SCHOOL_ID), { expire: 0 });

    // The fold under test: everything `revalidateSchoolDashboard` itself emits
    // must show up here too, with no call site having to ask for it.
    expect(revalidateTag).toHaveBeenCalledWith(tags.schoolDashboard(SCHOOL_ID), { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(tags.schoolName(SCHOOL_ID), { expire: 0 });
  });

  it("folds in exactly what a direct revalidateSchoolDashboard call would emit", async () => {
    revalidateSchoolHeadTeachers(SCHOOL_ID);
    const foldedTagCalls = revalidateTag.mock.calls.map((c) => c[0]);

    revalidateTag.mockClear();
    revalidateSchoolDashboard(SCHOOL_ID);
    const directTagCalls = revalidateTag.mock.calls.map((c) => c[0]);

    for (const tag of directTagCalls) {
      expect(foldedTagCalls).toContain(tag);
    }
  });

  it("still revalidates all five teacher-tab paths", async () => {
    revalidateSchoolHeadTeachers(SCHOOL_ID);

    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.teachers);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.teachersPending);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.teachersInactive);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.teachersDeclined);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.teachersRemoved);
  });

  it("scopes every busted tag to the given school, not another tenant's", async () => {
    const otherSchoolId = "school-2";

    revalidateSchoolHeadTeachers(otherSchoolId);

    expect(revalidateTag).not.toHaveBeenCalledWith(tags.schoolDashboard(SCHOOL_ID), { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith(tags.schoolName(SCHOOL_ID), { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith(tags.schoolTeachers(SCHOOL_ID), { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(tags.schoolDashboard(otherSchoolId), { expire: 0 });
  });
});
