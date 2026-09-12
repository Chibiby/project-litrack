import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ReadingLevelRecord.englishProfile` / `filipinoProfile` became nullable so a
 * teacher can save a partially-filled monthly row. This proves the per-learner
 * history table renders that null as an em dash rather than crashing on the
 * label lookup, and — just as important — still lists the partial row instead
 * of dropping it from the twelve most recent weeks.
 */

const findFirstMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { learner: { findFirst: (...a: unknown[]) => findFirstMock(...a) } },
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
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/nav-prefetcher", () => ({
  NavPrefetcher: () => null,
}));

vi.mock("@/lib/nav/warm-hrefs", () => ({
  getAralActionWarmHrefs: () => [],
}));

vi.mock("@/lib/teachers/scope", () => ({
  aralLearnerScope: () => ({}),
}));

const { default: ReadingLevelPage } = await import(
  "@/app/teacher/(app)/aral/[gradeId]/learners/[id]/reading-level/page"
);

beforeEach(() => {
  vi.clearAllMocks();
  findFirstMock.mockResolvedValue({
    id: "learner-1",
    fullName: "Ana Santos",
    gradeLevelId: "grade-1",
    gradeLevel: { type: "G3" },
    readingLevels: [
      {
        id: "rl-partial",
        weekStart: new Date("2026-09-07T00:00:00Z"),
        englishProfile: null,
        filipinoProfile: null,
        wordRecognitionLevel: "FLUENT",
        readingComprehensionLevel: null,
        notes: null,
      },
      {
        id: "rl-complete",
        weekStart: new Date("2026-08-31T00:00:00Z"),
        englishProfile: "INSTRUCTIONAL_DEVELOPING",
        filipinoProfile: "INDEPENDENT_GRADE_READY",
        wordRecognitionLevel: "FLUENT",
        readingComprehensionLevel: "INDEPENDENT",
        notes: null,
      },
    ],
  });
});

afterEach(cleanup);

describe("teacher reading-level history — null profile", () => {
  it("renders an em dash for a null profile and keeps the partial row listed", async () => {
    const ui = await ReadingLevelPage({
      params: Promise.resolve({ gradeId: "grade-1", id: "learner-1" }),
      searchParams: Promise.resolve({}),
    });
    render(ui);

    const rows = screen.getAllByRole("row");
    // Header + two data rows: the partial row must not be filtered out.
    expect(rows).toHaveLength(3);

    const partialRow = within(rows[1]);
    expect(partialRow.getAllByText("—").length).toBeGreaterThanOrEqual(2);

    const completeRow = within(rows[2]);
    expect(completeRow.getByText("Developing or Transitioning")).not.toBeNull();
    expect(completeRow.getByText("Grade-level Ready")).not.toBeNull();
  });
});
