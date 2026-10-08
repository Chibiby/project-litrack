import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerListRow } from "@/components/learners/learner-list-client";

/**
 * Archiving from the roster asks first, in both shapes (row menu and bulk),
 * names the count and the consequence, and only writes once confirmed.
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
vi.mock("@/lib/actions/learner-profile", () => ({ getLearnerProfile: vi.fn() }));
const archiveLearners = vi.fn();
vi.mock("@/lib/actions/learner", () => ({
  deleteLearners: vi.fn(),
  archiveLearners: (...args: unknown[]) => archiveLearners(...(args as [])),
  restoreLearner: vi.fn(),
  toggleAralLearner: vi.fn(),
  enrollRosterLearnersToAral: vi.fn(),
}));
vi.mock("@/lib/actions/aral-tutors", () => ({ listAralTutorOptions: vi.fn() }));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
    loading: vi.fn(() => "toast-1"),
  },
}));

const { LearnerListClient } = await import("@/components/learners/learner-list-client");

const ROWS: LearnerListRow[] = [
  {
    id: "learner-1",
    fullName: "Ana Santos",
    listingName: "Santos, Ana",
    age: 10,
    gender: "FEMALE",
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
    fullName: "Ben Cruz",
    listingName: "Cruz, Ben",
    age: 9,
    gender: "MALE",
    isAralLearner: true,
    archivedAt: null,
    englishReadingProfile: "FRUSTRATION_STRUGGLING",
    filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    section: { id: "sec-1", name: "Sampaguita" },
    gradeLevelId: "grade-g3",
    gradeType: "G3",
  },
];

function renderRoster() {
  return render(
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
}

const selectBoth = () => {
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Santos" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Ben Cruz" }));
};

beforeEach(() => {
  vi.clearAllMocks();
  archiveLearners.mockResolvedValue({ ok: true, data: { archived: 2 } });
});
afterEach(cleanup);

describe("roster archive confirmation", () => {
  it("asks before a bulk archive, stating count, recovery and the ARAL effect", async () => {
    renderRoster();
    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText("Archive 2 learners?")).toBeTruthy();
    expect(alert.textContent).toContain("hidden from active lists");
    expect(alert.textContent).toContain("restored from Archived Learners");
    expect(alert.textContent).toContain("1 of them is in ARAL");
    expect(alert.textContent).toContain("ARAL weekly grids");
    expect(within(alert).getByRole("button", { name: "Archive 2 learners" })).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(archiveLearners).not.toHaveBeenCalled();
  });

  it("writes nothing when the confirmation is cancelled", async () => {
    renderRoster();
    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(archiveLearners).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Select Ana Santos" })).toBeTruthy();
  });

  it("archives the selected ids once confirmed, then closes", async () => {
    renderRoster();
    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Archive 2 learners" }));

    await waitFor(() => expect(archiveLearners).toHaveBeenCalledTimes(1));
    const fd = archiveLearners.mock.calls[0][0] as FormData;
    expect(fd.getAll("learnerIds")).toEqual(["learner-1", "learner-2"]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("2 learners archived"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps the confirmation open and the selection when the server refuses", async () => {
    archiveLearners.mockResolvedValue({ ok: false, error: "Not allowed" });
    renderRoster();
    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Archive 2 learners" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not allowed"));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    // The row was hidden optimistically and comes back when the transition ends.
    const ana = await screen.findByRole(
      "checkbox",
      { name: "Select Ana Santos", hidden: true },
      { timeout: 5000 }
    );
    expect(ana.getAttribute("data-state")).toBe("checked");
  });

  it("asks before archiving from a row's menu, naming the learner", async () => {
    renderRoster();
    const table = screen.getByRole("table");
    const trigger = within(table).getByRole("button", { name: "More actions for Ana Santos" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Archive" }));

    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText("Archive Ana Santos?")).toBeTruthy();
    // Ana is not in ARAL, so the ARAL sentence would be noise.
    expect(alert.textContent).not.toContain("ARAL");
    expect(within(alert).getByRole("button", { name: "Archive learner" })).toBeTruthy();
    expect(archiveLearners).not.toHaveBeenCalled();
  });
});
