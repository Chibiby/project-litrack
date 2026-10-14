// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearnerListRow } from "@/components/learners/learner-list-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
  useSearchParams: () => new URLSearchParams("filter=archived"),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/learner-profile", () => ({ getLearnerProfile: vi.fn() }));
vi.mock("@/lib/actions/learner", () => ({
  deleteLearners: vi.fn(),
  archiveLearners: vi.fn(),
  restoreLearner: vi.fn(),
  toggleAralLearner: vi.fn(),
  enrollRosterLearnersToAral: vi.fn(),
}));
vi.mock("@/lib/actions/aral-tutors", () => ({ listAralTutorOptions: vi.fn() }));
vi.mock("@/lib/actions/learner-purge", () => ({ purgeArchivedLearner: vi.fn() }));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "t") },
}));

const { LearnerListClient } = await import("@/components/learners/learner-list-client");

const ROW: LearnerListRow = {
  id: "learner-1",
  fullName: "Ana Santos",
  listingName: "Santos, Ana",
  age: 10,
  gender: "FEMALE",
  isAralLearner: false,
  archivedAt: "2026-10-20T00:00:00.000Z",
  englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
  filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
  section: { id: "sec-1", name: "Sampaguita" },
  gradeLevelId: "grade-g3",
  gradeType: "G3",
};

afterEach(cleanup);

function renderRemoved(learners: LearnerListRow[]) {
  return render(
    <LearnerListClient
      gender="all"
      aralStatus="all"
      sections={[{ id: "sec-1", name: "Sampaguita" }]}
      isSuperAdmin={false}
      learners={learners}
      page={1}
      pageSize={10}
      totalCount={learners.length}
      q=""
      archivedView
    />
  );
}

describe("Removed view", () => {
  it("shows the Removed badge and the date the removal becomes permanent", () => {
    renderRemoved([ROW]);
    expect(screen.getAllByText("Removed").length).toBeGreaterThan(0);
    // 20 Oct 2026 + 30 days
    expect(screen.getAllByText("Deletes Nov 19, 2026").length).toBeGreaterThan(0);
    expect(screen.queryByText(/archiv/i)).toBeNull();
  });

  it("says nothing is removed when the list is empty", () => {
    renderRemoved([]);
    expect(screen.getByText("No removed learners")).toBeTruthy();
    expect(
      screen.getByText("Learners you remove appear here for 30 days and can be restored.")
    ).toBeTruthy();
  });
});
