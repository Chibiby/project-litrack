import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerListRow } from "@/components/learners/learner-list-client";

/**
 * The roster's Actions column after the brief moved Edit into the Student Profile
 * dialog and added ARAL enrolment to the row: View on every row, a violet spark
 * only where enrolling is still possible, and no pencil anywhere in the table.
 *
 * "Remove the edit button under Actions" is only observably true if nothing else
 * in a row still navigates to the edit form, so that is what is asserted here —
 * not merely the absence of an icon.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
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

const getLearnerProfile = vi.fn();
vi.mock("@/lib/actions/learner-profile", () => ({
  getLearnerProfile: (...args: unknown[]) => getLearnerProfile(...(args as [])),
}));
const enrollRosterLearnersToAral = vi.fn(async () => ({
  ok: true,
  data: { enrolled: 1, redesignated: 0 },
}));
vi.mock("@/lib/actions/learner", () => ({
  deleteLearners: vi.fn(async () => ({ ok: true })),
  toggleAralLearner: vi.fn(async () => ({ ok: true })),
  enrollRosterLearnersToAral: (...args: unknown[]) =>
    enrollRosterLearnersToAral(...(args as [])),
}));
// The tutor picker fetches this when it opens. Stubbed rather than left out:
// the module is a server action, so importing it for real would drag Prisma in.
const listAralTutorOptions = vi.fn();
vi.mock("@/lib/actions/aral-tutors", () => ({
  listAralTutorOptions: () => listAralTutorOptions(),
}));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "toast-1"),
  },
}));

const { LearnerListClient } = await import(
  "@/components/learners/learner-list-client"
);

const ROWS: LearnerListRow[] = [
  {
    id: "learner-1",
    fullName: "Ana Santos",
    age: 10,
    gender: "FEMALE",
    isAralLearner: false,
    hasAralProfile: false,
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
    age: 9,
    gender: "MALE",
    isAralLearner: true,
    hasAralProfile: true,
    archivedAt: null,
    englishReadingProfile: "FRUSTRATION_STRUGGLING",
    filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    section: { id: "sec-1", name: "Sampaguita" },
    gradeLevelId: "grade-g3",
    gradeType: "G3",
  },
];

function renderRoster(isSuperAdmin = false) {
  return render(
    <LearnerListClient
      gender="all"
      aralStatus="all"
      sections={[{ id: "sec-1", name: "Sampaguita" }]}
      isSuperAdmin={isSuperAdmin}
      learners={ROWS}
      page={1}
      pageSize={10}
      totalCount={ROWS.length}
      q=""
    />
  );
}

/** The data rows, excluding the header row. */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  getLearnerProfile.mockResolvedValue({ ok: false, error: "Not found" });
  listAralTutorOptions.mockResolvedValue({
    ok: true,
    data: {
      tutors: [
        {
          id: "self",
          name: "Marivic Reyes",
          advisoryLabel: "Grade 3 · Sampaguita",
          employmentType: "DEPED_PLANTILLA",
        },
        {
          id: "vol-1",
          name: "Jun Dela Cruz",
          advisoryLabel: null,
          employmentType: "NON_DEPED",
        },
      ],
      selfId: "self",
    },
  });
});

afterEach(cleanup);

describe("LearnerListClient — Actions column", () => {
  it("carries View on every row, and the ARAL spark only where it applies", () => {
    renderRoster();
    const rows = bodyRows();
    expect(rows).toHaveLength(2);

    const actionsOf = (row: HTMLElement) => {
      const cells = within(row).getAllByRole("cell");
      return cells[cells.length - 1];
    };

    // Ana is not in ARAL, so enrolling her is still an option.
    const ana = actionsOf(rows[0]);
    expect(within(ana).getAllByRole("button")).toHaveLength(2);
    expect(
      within(ana).getByRole("button", { name: "View Ana Santos's profile" })
    ).toBeTruthy();
    expect(
      within(ana).getByRole("button", { name: "Enroll Ana Santos as ARAL" })
    ).toBeTruthy();

    // Ben already is, so the row offers no second enrolment — changing his tutor
    // lives on the profile dialog's ARAL tab instead.
    const ben = actionsOf(rows[1]);
    expect(within(ben).getAllByRole("button")).toHaveLength(1);
    expect(
      within(ben).getByRole("button", { name: "View Ben Cruz's profile" })
    ).toBeTruthy();

    for (const row of rows) {
      expect(within(actionsOf(row)).queryAllByRole("link")).toHaveLength(0);
    }
  });

  it("asks who will tutor before it enrolls anyone", async () => {
    renderRoster();
    fireEvent.click(
      screen.getByRole("button", { name: "Enroll Ana Santos as ARAL" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Enroll Ana Santos in ARAL");
    expect(dialog.textContent).toContain("ARAL tutor");
    expect(listAralTutorOptions).toHaveBeenCalled();

    // The picker is the gate, not a formality: the spark opens a choice and
    // writes nothing until it is confirmed.
    const trigger = await waitFor(() => within(dialog).getByRole("combobox"));
    expect(trigger.textContent).toContain("Myself");
    expect(enrollRosterLearnersToAral).not.toHaveBeenCalled();
  });

  it("enrolls with the chosen tutor once confirmed", async () => {
    renderRoster();
    fireEvent.click(
      screen.getByRole("button", { name: "Enroll Ana Santos as ARAL" })
    );
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => within(dialog).getByRole("combobox"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Enroll" }));

    // Keeping the learner yourself sends no tutor at all — the action reads an
    // omitted designation as "whoever enrolled them".
    await waitFor(() =>
      expect(enrollRosterLearnersToAral).toHaveBeenCalledWith({
        learnerIds: ["learner-1"],
        aralTeacherId: undefined,
      })
    );
  });

  it("leaves no route to the edit form anywhere in the table", () => {
    renderRoster();
    const table = screen.getByRole("table");

    expect(table.querySelectorAll('a[href*="/edit"]')).toHaveLength(0);
    expect(
      within(table).queryByRole("link", { name: /edit/i })
    ).toBeNull();
    expect(
      within(table).queryByRole("button", { name: /^edit/i })
    ).toBeNull();
  });

  it("opens the profile dialog instead of navigating", async () => {
    renderRoster();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "View Ana Santos's profile" })
    );

    // The row is state, not a route — nothing is pushed.
    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(getLearnerProfile).toHaveBeenCalledWith("learner-1");
  });

  it("re-targets the single dialog when a different row is viewed", async () => {
    renderRoster();
    fireEvent.click(
      screen.getByRole("button", { name: "View Ana Santos's profile" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(getLearnerProfile).toHaveBeenLastCalledWith("learner-1");

    // The open dialog aria-hides the roster behind it, so a second row is only
    // reachable after closing — which is the point of the header ✕. (The stubbed
    // fetch fails here, so the footer shows its own Close too; take the header's.)
    const headerClose = within(dialog)
      .getAllByRole("button", { name: "Close" })
      .find((b) => !b.closest("footer"));
    expect(headerClose).toBeDefined();
    fireEvent.click(headerClose!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(
      screen.getByRole("button", { name: "View Ben Cruz's profile" })
    );
    await screen.findByRole("dialog");

    expect(getLearnerProfile).toHaveBeenLastCalledWith("learner-2");
    // One dialog for the whole page, per the roster's own note.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("keeps the View control for Super Admin", () => {
    renderRoster(true);
    for (const row of bodyRows()) {
      const cells = within(row).getAllByRole("cell");
      expect(
        within(cells[cells.length - 1]).getAllByRole("button")
      ).toHaveLength(1);
    }
    // Super Admin views read-only, so neither the ARAL spark nor the selection
    // checkboxes are drawn.
    expect(
      screen.queryByRole("button", { name: /Enroll .+ as ARAL/ })
    ).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
