import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Weekly attendance is the one ARAL grid that sorts in the BROWSER rather than
 * through a URL round trip, because it is unpaginated and its rows hold marks
 * the teacher has typed but not saved (see `src/lib/aral/grid-sorts.ts`).
 *
 * That choice is only safe if re-sorting preserves the grid's row state, which
 * is keyed by learner id rather than by position. The selection assertion at
 * the bottom is what proves it: a positional state array, or a remount on
 * sort, would hand the tick to whoever moved into that row's slot — or drop it
 * entirely — and the same defect would silently discard an unsaved mark.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/aral-grid", () => ({
  fetchAralAttendanceForWeek: vi.fn(),
}));

vi.mock("@/lib/actions/attendance", () => ({
  saveAralWeeklyAttendance: vi.fn(async () => ({ ok: true as const })),
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  loading: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
toastFn.loading = vi.fn(() => "toast-1");
vi.mock("sonner", () => ({ toast: toastFn }));

const { AralWeeklyAttendancePanel } = await import(
  "@/components/aral/aral-weekly-attendance-panel"
);

/** Monday of the week under test. */
const WEEK_START = "2026-09-07";
const MON = "2026-09-07";
const TUE = "2026-09-08";

const LEARNERS = [
  {
    id: "l1",
    fullName: "Ana Santos",
    listingName: "Santos, Ana",
    sectionName: "Sampaguita",
  },
  {
    id: "l2",
    fullName: "Ben Cruz",
    listingName: "Cruz, Ben",
    sectionName: "Ilang-Ilang",
  },
];

/** Ana absent twice, Ben not at all — so name order and absence order differ. */
const EXISTING = [
  { learnerId: "l1", dateKey: MON, status: "ABSENT", notes: null },
  { learnerId: "l1", dateKey: TUE, status: "ABSENT", notes: null },
  { learnerId: "l2", dateKey: MON, status: "PRESENT", notes: null },
];

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

function renderPanel() {
  return render(
    <AralWeeklyAttendancePanel
      gradeId="grade-1"
      grades={[{ id: "grade-1", label: "Grade 3" }]}
      basePath="/teacher/aral/grade-1/attendance"
      initialWeekKey={WEEK_START}
      section="all"
      sections={[{ id: "s1", name: "Sampaguita" }]}
      showSection
      learners={LEARNERS}
      initialExisting={EXISTING}
      initialHolidayKeys={[]}
      lockingEnabled={false}
    />
  );
}

/** The Learner column of every rendered row, top to bottom. */
function rowNames(): string[] {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (row) => row.querySelectorAll("td")[2]?.textContent?.trim() ?? ""
  );
}

async function pickSort(optionLabel: string) {
  fireEvent.click(screen.getByLabelText("Sort by"));
  // By role, not by text: "Section" is also a column header, and the sort
  // options are the only things on the page with the option role.
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

describe("Weekly attendance — Sort by", () => {
  it("shows learners surname-first and alphabetical by default", () => {
    renderPanel();
    expect(rowNames()).toEqual(["Cruz, Ben", "Santos, Ana"]);
  });

  it("re-orders by most absences without a navigation", async () => {
    renderPanel();
    await pickSort("Absences this week (most)");
    expect(rowNames()).toEqual(["Santos, Ana", "Cruz, Ben"]);
  });

  it("orders by section name", async () => {
    renderPanel();
    await pickSort("Section");
    expect(rowNames()).toEqual(["Cruz, Ben", "Santos, Ana"]); // Ilang-Ilang, Sampaguita
  });

  it("keeps a row's grid state with the learner when the order changes", async () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("Select Ana Santos"));
    expect(rowNames()).toEqual(["Cruz, Ben", "Santos, Ana"]);

    await pickSort("Absences this week (most)");

    // Ana moved to the top; the tick moved with her rather than staying on
    // whoever now occupies the second row.
    expect(rowNames()).toEqual(["Santos, Ana", "Cruz, Ben"]);
    const rows = document.querySelectorAll("tbody tr");
    expect(
      within(rows[0] as HTMLElement).getByLabelText("Select Ana Santos")
    ).toBeTruthy();
    expect(
      (within(rows[0] as HTMLElement).getByLabelText(
        "Select Ana Santos"
      ) as HTMLElement).getAttribute("data-state")
    ).toBe("checked");
  });
});
