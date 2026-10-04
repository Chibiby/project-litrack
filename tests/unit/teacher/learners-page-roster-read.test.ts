import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

/**
 * The teacher roster reads the page the URL asked for in parallel with the
 * count, and only re-reads when the count clamps the page to a different one
 * (origin/main read count first, then the clamped page, always). Pins:
 * in-range = one count + one findMany issued together; past the end = clamped
 * page re-read; empty roster = page 1, no rows.
 *
 * `LearnersBody` is an unexported async Server Component, so the page's element
 * tree is walked to it and it is called directly.
 */

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  events: [] as string[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { count: mocks.count, findMany: mocks.findMany },
    gradeLevel: { findFirst: vi.fn(async () => null) },
  },
}));

const teacher = {
  id: "t1",
  role: "TEACHER",
  schoolId: "s1",
  profileCompleted: true,
  fullName: "Teach Er",
  firstName: "Teach",
  lastName: "Er",
};
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(async () => teacher) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/dashboard/aggregates", () => ({
  getTeacherShellContext: vi.fn(async () => ({
    grades: [{ id: "g1", type: "GRADE_3" }],
    designation: "DEPED",
    advisoryMode: "DEFAULT",
  })),
}));
vi.mock("@/lib/cache/grade-sections", () => ({ getGradeSections: vi.fn(async () => []) }));
vi.mock("@/lib/teachers/advisory", () => ({
  getAdvisoryPlacements: vi.fn(async () => []),
  NO_ADVISORY_MESSAGE: "none",
}));
vi.mock("@/lib/teachers/scope", () => ({
  advisoryRosterDenial: () => null,
  teacherGradeScope: () => ({}),
  teacherLearnerScope: () => ({}),
}));

const stub = () => null;
vi.mock("@/components/app-shell", () => ({ AppShell: stub }));
vi.mock("@/components/learners/learner-list-client", () => ({ LearnerListClient: stub }));
vi.mock("@/components/learners/learner-stat-cards", () => ({ LearnerStatCards: stub }));
vi.mock("@/components/learners/learner-add-menu", () => ({
  LearnerAddMenu: stub,
  LearnerAddMenuDisabled: stub,
}));
vi.mock("@/components/dashboard", () => ({ EmptyState: stub }));
vi.mock("@/components/learners/learner-roster-skeleton", () => ({
  LearnerStatCardsSkeleton: stub,
  LearnerTableSkeleton: stub,
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: stub }));
vi.mock("@/components/shell/page-hero", () => ({ PageHero: stub }));
vi.mock("@/components/learners/advisory-hero-control", () => ({ AdvisoryHeroControl: stub }));

const { default: Page } = await import("@/app/teacher/(app)/learners/page");
const { LEARNER_LIST_DEFAULT_PAGE_SIZE: PAGE_SIZE } = await import("@/lib/learners/pagination");

function findByName(node: ReactNode, name: string): ReactElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findByName(n, name);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function" && el.type.name === name) return el;
  return findByName(el.props?.children, name);
}

const learnerRow = (id: string) => ({
  id,
  firstName: "A",
  middleName: null,
  lastName: "B",
  fullName: "A B",
  age: 9,
  gender: "MALE",
  isAralLearner: false,
  archivedAt: null,
  deletedAt: null,
  englishReadingProfile: null,
  filipinoReadingProfile: null,
  gradeLevelId: "g1",
  gradeLevel: { type: "GRADE_3" },
  section: null,
});

async function renderBody(searchParams: Record<string, string>) {
  const tree = await Page({ searchParams: Promise.resolve(searchParams) });
  const bodyEl = findByName(tree, "LearnersBody");
  expect(bodyEl).not.toBeNull();
  const out = (await (bodyEl!.type as (p: unknown) => Promise<ReactElement>)(
    bodyEl!.props
  )) as ReactElement<{ page: number; totalCount: number; learners: { id: string }[] }>;
  return out.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
});

describe("teacher roster — speculative page read", () => {
  it("in range: one count and one findMany, issued together, no re-read", async () => {
    mocks.count.mockImplementation(async () => {
      mocks.events.push("count:start");
      await Promise.resolve();
      mocks.events.push("count:end");
      return PAGE_SIZE * 3;
    });
    mocks.findMany.mockImplementation(async () => {
      mocks.events.push("find:start");
      return [learnerRow("l1")];
    });

    const props = await renderBody({ page: "2" });

    expect(mocks.count).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    // findMany started before count finished: they ran in parallel.
    expect(mocks.events.indexOf("find:start")).toBeLessThan(mocks.events.indexOf("count:end"));
    expect(mocks.findMany.mock.calls[0]![0]).toMatchObject({ skip: PAGE_SIZE });
    expect(props.page).toBe(2);
    expect(props.totalCount).toBe(PAGE_SIZE * 3);
    expect(props.learners.map((l) => l.id)).toEqual(["l1"]);
  });

  it("past the end: clamps to the last page and re-reads it", async () => {
    mocks.count.mockResolvedValue(PAGE_SIZE * 2 + 1); // 3 pages
    mocks.findMany.mockImplementation(async (args: { skip: number }) =>
      args.skip === 2 * PAGE_SIZE ? [learnerRow("last")] : []
    );

    const props = await renderBody({ page: "9" });

    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.findMany.mock.calls[0]![0]).toMatchObject({ skip: 8 * PAGE_SIZE });
    expect(mocks.findMany.mock.calls[1]![0]).toMatchObject({ skip: 2 * PAGE_SIZE });
    expect(props.page).toBe(3);
    expect(props.learners.map((l) => l.id)).toEqual(["last"]);
  });

  it("absurd page: skips the speculative read and reads only the clamped page", async () => {
    mocks.count.mockResolvedValue(PAGE_SIZE + 1); // 2 pages
    mocks.findMany.mockResolvedValue([learnerRow("p2")]);

    const props = await renderBody({ page: "99999999" });

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany.mock.calls[0]![0]).toMatchObject({ skip: PAGE_SIZE });
    expect(props.page).toBe(2);
  });

  it("empty roster: page 1, no rows, one count and one findMany at skip 0", async () => {
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);

    const props = await renderBody({});

    expect(mocks.count).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany.mock.calls[0]![0]).toMatchObject({ skip: 0 });
    expect(props.page).toBe(1);
    expect(props.totalCount).toBe(0);
    expect(props.learners).toEqual([]);
  });

  it("empty roster with a stale page: clamps to page 1 and re-reads at skip 0", async () => {
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);

    const props = await renderBody({ page: "3" });

    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.findMany.mock.calls[1]![0]).toMatchObject({ skip: 0 });
    expect(props.page).toBe(1);
  });
});
