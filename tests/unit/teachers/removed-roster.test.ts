import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * The Removed tab of the School Head teacher workspace.
 *
 * Removed teachers are soft-deleted rows, which every other roster state
 * filters OUT — so this tab cannot spread the shared `teacherRosterScope`
 * (it pins `deletedAt: null`) and has a scope of its own. The property worth
 * pinning is that the new scope still carries the tenant boundary.
 */

const count = vi.fn(async (_args: { where: Record<string, unknown> }) => 0);
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { count: (...a: unknown[]) => count(...(a as [never])) } },
}));

const { removedTeacherScope, teacherTabCounts } = await import("@/lib/teachers/roster");
const { teacherWorkspaceTabs, TEACHER_TABS } = await import(
  "@/components/school-head/workspace-tabs"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removed teacher roster", () => {
  it("is this school's soft-deleted teachers, and only this school's", () => {
    expect(removedTeacherScope("school-1")).toEqual({
      schoolId: "school-1",
      role: "TEACHER",
      deletedAt: { not: null },
    });
  });

  it("counts removed teachers for the tab badge, tenant-scoped", async () => {
    count.mockImplementation(async ({ where }) =>
      (where.deletedAt as { not?: null } | null)?.not === null ? 4 : 1
    );

    const counts = await teacherTabCounts("school-1");

    expect(counts.removed).toBe(4);
    expect(counts.active).toBe(1);
    for (const call of count.mock.calls) {
      expect(call[0].where.schoolId).toBe("school-1");
    }
  });

  it("puts a Removed tab last in the teacher workspace", () => {
    const tabs = teacherWorkspaceTabs({
      active: 5,
      pending: 1,
      inactive: 2,
      declined: 0,
      removed: 3,
    });

    expect(tabs.map((t) => t.key)).toEqual([
      TEACHER_TABS.active,
      TEACHER_TABS.pending,
      TEACHER_TABS.inactive,
      TEACHER_TABS.declined,
      TEACHER_TABS.removed,
    ]);
    expect(tabs.at(-1)).toMatchObject({
      label: "Removed",
      href: SCHOOL_HEAD_ROUTES.teachersRemoved,
      count: 3,
    });
  });
});
