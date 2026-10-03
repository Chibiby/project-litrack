// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => "/teacher/learners",
}));

const getLearnerProfile = vi.fn();
vi.mock("@/lib/actions/learner-profile", () => ({
  getLearnerProfile: (...args: unknown[]) => getLearnerProfile(...(args as [])),
}));
vi.mock("@/components/forms/learner-form", () => ({ LearnerForm: () => null }));
vi.mock("@/lib/actions/learner", () => ({
  toggleAralLearner: vi.fn(),
  enrollRosterLearnersToAral: vi.fn(),
}));
vi.mock("@/lib/actions/aral-tutors", () => ({
  listAralTutorOptions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: () => "t" },
}));

const { LearnerProfileModal } = await import(
  "@/components/learners/learner-profile-modal"
);

function learner(id: string, first: string, last: string) {
  return {
    id,
    fullName: `${first} ${last}`,
    firstName: first,
    middleName: null,
    lastName: last,
    age: 10,
    gender: "FEMALE",
    nutritionalStatus: "NORMAL",
    ethnicity: null,
    ethnicityOther: null,
    secondaryEthnicity: null,
    secondaryEthnicityOther: null,
    englishReadingProfile: null,
    filipinoReadingProfile: null,
    englishFrustrationSubtypes: [],
    filipinoFrustrationSubtypes: [],
    governmentBenefits: [],
    parentEducation: null,
    modeOfTransportation: null,
    distanceHomeToSchool: null,
    previousTransfers: null,
    transferDetails: null,
    gradeLevelId: "grade-g3",
    gradeType: "G3",
    sectionName: "Sampaguita",
    adviserName: "Teacher One",
    isAralLearner: false,
    aralEnrolledAt: null,
    aralTutorName: null,
    aralTeacherId: null,
    archivedAt: null,
    createdAt: "2026-06-10",
    enrollments: [],
    attendances: [],
    readingLevels: [],
    aralProfile: null,
  };
}

afterEach(cleanup);

describe("LearnerProfileModal stale responses", () => {
  it("drops a slower response for a learner that is no longer selected", async () => {
    let resolveA: (v: unknown) => void = () => {};
    let resolveB: (v: unknown) => void = () => {};
    getLearnerProfile
      .mockReturnValueOnce(new Promise((r) => (resolveA = r)))
      .mockReturnValueOnce(new Promise((r) => (resolveB = r)));

    const ui = (id: string) => (
      <LearnerProfileModal learnerId={id} onClose={vi.fn()} isSuperAdmin={false} />
    );
    const view = render(ui("a"));
    view.rerender(ui("b"));

    await act(async () => {
      resolveB({ ok: true, data: learner("b", "Bea", "Bautista") });
    });
    expect((await screen.findAllByText("Bea Bautista")).length).toBeGreaterThan(0);

    await act(async () => {
      resolveA({ ok: true, data: learner("a", "Ana", "Alonzo") });
    });
    expect(screen.queryByText("Ana Alonzo")).toBeNull();
    expect(screen.getAllByText("Bea Bautista").length).toBeGreaterThan(0);
  });
});
