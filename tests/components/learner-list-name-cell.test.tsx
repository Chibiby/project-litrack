import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LearnerListRow } from "@/components/learners/learner-list-client";

/**
 * The roster's Learner Name column must display the surname-first listing
 * form the page computes with `formatListingNameFromRecord`, not the stored
 * Firstname-first `fullName` — see CONSISTENCY RULE in the toolbar's module
 * doc: a column that displays surname-first but sorts on `fullName` looks
 * unsorted.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/learner-profile", () => ({
  getLearnerProfile: vi.fn(),
}));
vi.mock("@/lib/actions/learner", () => ({
  deleteLearners: vi.fn(),
  archiveLearners: vi.fn(),
  restoreLearner: vi.fn(),
  toggleAralLearner: vi.fn(),
  enrollRosterLearnersToAral: vi.fn(),
}));
vi.mock("@/lib/actions/aral-tutors", () => ({
  listAralTutorOptions: vi.fn(),
}));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "toast-1") },
}));

const { LearnerListClient } = await import(
  "@/components/learners/learner-list-client"
);

const ROWS: LearnerListRow[] = [
  {
    id: "learner-1",
    fullName: "Juan Miguel Dela Cruz",
    listingName: "Dela Cruz, Juan Miguel",
    age: 10,
    gender: "MALE",
    isAralLearner: false,
    archivedAt: null,
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    section: { id: "sec-1", name: "Sampaguita" },
    gradeLevelId: "grade-g3",
    gradeType: "G3",
  },
  {
    id: "learner-2",
    // No middle name — must not carry a stray trailing space or comma.
    fullName: "Ana Santos",
    listingName: "Santos, Ana",
    age: 9,
    gender: "FEMALE",
    isAralLearner: false,
    archivedAt: null,
    englishReadingProfile: null,
    filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    section: { id: "sec-1", name: "Sampaguita" },
    gradeLevelId: "grade-g3",
    gradeType: "G3",
  },
];

afterEach(cleanup);

describe("LearnerListClient — Learner Name column", () => {
  it("renders the surname-first listing form, not the stored fullName", () => {
    render(
      <LearnerListClient
        gender="all"
        aralStatus="all"
        sections={[{ id: "sec-1", name: "Sampaguita" }]}
        isSuperAdmin={false}
        learners={ROWS}
        page={1}
        pageSize={10}
        totalCount={ROWS.length}
        q=""
      />
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("Dela Cruz, Juan Miguel")).toBeTruthy();
    expect(within(table).queryByText("Juan Miguel Dela Cruz")).toBeNull();
  });

  it("renders a learner with no middle name with no stray comma or space", () => {
    render(
      <LearnerListClient
        gender="all"
        aralStatus="all"
        sections={[{ id: "sec-1", name: "Sampaguita" }]}
        isSuperAdmin={false}
        learners={ROWS}
        page={1}
        pageSize={10}
        totalCount={ROWS.length}
        q=""
      />
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("Santos, Ana")).toBeTruthy();
  });
});
