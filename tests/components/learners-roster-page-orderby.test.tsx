import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { learnerListOrderBy } from "@/lib/learners/pagination";

/**
 * Proves the teacher roster page threads `learnerListOrderBy`'s output into
 * `prisma.learner.findMany` unchanged — the actual guarantee this task cares
 * about, since a page that computed the right orderBy and then forgot to pass
 * it would still look correct at a glance.
 */

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findMany: (...a: unknown[]) => findManyMock(...a),
      count: (...a: unknown[]) => countMock(...a),
    },
    gradeLevel: { findFirst: vi.fn() },
  },
}));

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

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/dashboard", () => ({
  EmptyState: () => null,
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: () => null }));
vi.mock("@/components/learners/learner-roster-skeleton", () => ({
  LearnerStatCardsSkeleton: () => null,
  LearnerTableSkeleton: () => null,
}));
vi.mock("@/components/learners/learner-stat-cards", () => ({
  LearnerStatCards: () => null,
}));
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

vi.mock("@/lib/dashboard/aggregates", () => ({
  getTeacherShellContext: vi.fn().mockResolvedValue({
    grades: [{ id: "grade-g3", type: "G3" }],
    designation: "TEACHER",
    advisoryMode: "DEFAULT",
  }),
}));
vi.mock("@/lib/cache/grade-sections", () => ({
  getGradeSections: vi.fn().mockResolvedValue([]),
}));
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

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("teacher learners roster page — orderBy wiring", () => {
  it("passes learnerListOrderBy('name') to findMany when no ?sort is given", async () => {
    const ui = await TeacherLearnersPage({ searchParams: Promise.resolve({}) });
    render(ui);

    await waitFor(() => expect(findManyMock).toHaveBeenCalledTimes(1));
    const call = findManyMock.mock.calls[0][0];
    expect(call.orderBy).toEqual(learnerListOrderBy("name"));
  });

  it("passes learnerListOrderBy('grade') to findMany for ?sort=grade", async () => {
    const ui = await TeacherLearnersPage({
      searchParams: Promise.resolve({ sort: "grade" }),
    });
    render(ui);

    await waitFor(() => expect(findManyMock).toHaveBeenCalledTimes(1));
    const call = findManyMock.mock.calls[0][0];
    expect(call.orderBy).toEqual(learnerListOrderBy("grade"));
  });
});
