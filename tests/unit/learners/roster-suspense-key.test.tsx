import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { listKey } from "@/lib/nav/list-params";

/**
 * Proves the rows Suspense boundary in the teacher roster page is keyed on
 * exactly the params that change which rows are shown — and not on anything
 * else, like the admin `?schoolId=` view context. Without a matching key the
 * boundary keeps stale rows on screen (the bug this task fixes); a key that
 * is too wide re-suspends the whole panel for changes that never touch a row
 * (a needless flash for every unrelated param).
 *
 * Walks the returned React element tree rather than rendering to the DOM:
 * `LearnersBody` does real Prisma reads, and this test only cares about the
 * `key` prop React assigns the boundary — a concern that lives entirely in
 * the element tree, before any of that work runs.
 */

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({
    id: "teacher-1",
    role: "TEACHER",
    schoolId: "school-1",
    profileCompleted: true,
    fullName: "Marivic Reyes",
    firstName: "Marivic",
    lastName: "Reyes",
  }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/dashboard", () => ({ EmptyState: () => null }));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: () => null }));
vi.mock("@/components/learners/learner-roster-skeleton", () => ({
  LearnerStatCardsSkeleton: () => null,
  LearnerTableSkeleton: () => null,
}));
vi.mock("@/components/learners/learner-stat-cards", () => ({ LearnerStatCards: () => null }));
vi.mock("@/components/learners/learner-add-menu", () => ({
  LearnerAddMenu: () => null,
  LearnerAddMenuDisabled: () => null,
}));
vi.mock("@/components/learners/advisory-hero-control", () => ({
  AdvisoryHeroControl: () => null,
}));
vi.mock("@/components/learners/learner-list-client", () => ({
  LearnerListClient: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    gradeLevel: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/dashboard/aggregates", () => ({
  getTeacherShellContext: vi.fn().mockResolvedValue({
    grades: [{ id: "grade-g3", type: "G3" }],
    designation: "TEACHER",
    advisoryMode: "DEFAULT",
  }),
}));
vi.mock("@/lib/cache/grade-sections", () => ({ getGradeSections: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/teachers/scope", () => ({
  advisoryRosterDenial: () => null,
  teacherGradeScope: () => ({}),
  teacherLearnerScope: () => ({}),
}));
vi.mock("@/lib/teachers/advisory", () => ({
  getAdvisoryPlacements: vi.fn().mockResolvedValue([]),
  NO_ADVISORY_MESSAGE: "no advisory",
}));

const { default: TeacherLearnersPage } = await import(
  "@/app/teacher/(app)/learners/page"
);

/** The exact param set the roster's rows boundary must key on. */
const LEARNER_ROSTER_LIST_KEYS = [
  "page",
  "sort",
  "q",
  "perPage",
  "grade",
  "section",
  "gender",
  "aralStatus",
  "advisory",
  "filter",
] as const;

/** Depth-first search for the Suspense element wrapping `LearnersBody`. */
function findRowsSuspense(node: unknown): { key: React.Key | null } | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRowsSuspense(child);
      if (found) return found;
    }
    return undefined;
  }
  const el = node as {
    type?: unknown;
    key?: React.Key | null;
    props?: { children?: unknown };
  };
  if (el.type === Suspense) {
    const child = el.props?.children as { type?: { name?: string } } | undefined;
    if (child?.type?.name === "LearnersBody") {
      return { key: el.key ?? null };
    }
  }
  if (el.props?.children !== undefined) {
    return findRowsSuspense(el.props.children);
  }
  return undefined;
}

async function suspenseKeyFor(searchParams: Record<string, string | undefined>) {
  const ui = await TeacherLearnersPage({ searchParams: Promise.resolve(searchParams) });
  const found = findRowsSuspense(ui);
  if (!found) throw new Error("rows Suspense boundary not found in the page tree");
  return found.key;
}

describe("teacher learners roster page — rows Suspense key", () => {
  it("matches listKey() over the row-affecting params", async () => {
    const sp = { sort: "grade", grade: "grade-g3" };
    const key = await suspenseKeyFor(sp);
    expect(key).toBe(listKey(sp, LEARNER_ROSTER_LIST_KEYS));
  });

  it("changes when page, sort, q, a facet, or the archived tab changes", async () => {
    const base = await suspenseKeyFor({});
    expect(await suspenseKeyFor({ page: "2" })).not.toBe(base);
    expect(await suspenseKeyFor({ sort: "age" })).not.toBe(base);
    expect(await suspenseKeyFor({ q: "ana" })).not.toBe(base);
    expect(await suspenseKeyFor({ perPage: "20" })).not.toBe(base);
    expect(await suspenseKeyFor({ grade: "grade-g3" })).not.toBe(base);
    expect(await suspenseKeyFor({ section: "sec-1" })).not.toBe(base);
    expect(await suspenseKeyFor({ gender: "MALE" })).not.toBe(base);
    expect(await suspenseKeyFor({ aralStatus: "enrolled" })).not.toBe(base);
    expect(await suspenseKeyFor({ advisory: "sec-1" })).not.toBe(base);
    expect(await suspenseKeyFor({ filter: "archived" })).not.toBe(base);
  });

  it("does NOT change for an unrelated param, e.g. the admin ?schoolId= view context", async () => {
    const base = await suspenseKeyFor({});
    expect(await suspenseKeyFor({ schoolId: "school-2" })).toBe(base);
  });
});
