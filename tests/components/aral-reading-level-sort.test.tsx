import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Monthly reading level is paginated, so unlike weekly attendance it sorts
 * SERVER-side: the control only writes `?sort=` and lets the page re-query.
 * Sorting the rows already on screen would be wrong — page 2 would still hold
 * whoever the previous ordering put there.
 *
 * Two things have to hold for that to behave: the sort has to reach the URL,
 * and `page` has to be dropped when it does. Page 3 of an alphabetical roster
 * is meaningless once the roster is reordered, and keeping it strands the
 * teacher on rows they did not ask for.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/aral-grid", () => ({
  fetchAralReadingLevelForMonth: vi.fn(),
}));

vi.mock("@/lib/actions/reading-level", () => ({
  bulkRecordMonthlyReadingLevel: vi.fn(async () => ({
    ok: true,
    data: { upserted: 0, cleared: 0 },
  })),
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

const { AralMonthlyReadingLevelPanel } = await import(
  "@/components/aral/aral-monthly-reading-level-panel"
);

const LEARNERS = [
  { id: "l1", fullName: "Ana Santos", listingName: "Santos, Ana" },
];

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  push.mockClear();
});

type PanelProps = React.ComponentProps<typeof AralMonthlyReadingLevelPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  return render(
    <AralMonthlyReadingLevelPanel
      gradeId="grade-1"
      gradeType="G3"
      grades={[]}
      basePath="/teacher/aral/grade-1/reading-level"
      initialMonthKey="2026-09-01"
      section="all"
      sections={[{ id: "s1", name: "Sampaguita" }]}
      showSection
      gender="all"
      sort="name"
      learners={LEARNERS}
      initialExisting={[]}
      initialProgress={{ completed: 0, total: 1 }}
      page={1}
      pageSize={20}
      totalPages={1}
      totalCount={1}
      lockingEnabled={false}
      {...overrides}
    />
  );
}

async function pickSort(optionLabel: string) {
  fireEvent.click(screen.getByLabelText("Sort by"));
  // By role: "Section" is also a filter control's label on this toolbar.
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

describe("Monthly reading level — Sort by", () => {
  it("shows the learner surname-first", () => {
    renderPanel();
    expect(screen.getByText("Santos, Ana")).toBeTruthy();
  });

  it("writes the chosen sort to the URL and returns to page 1", async () => {
    renderPanel({ page: 3 });
    await pickSort("Filipino reading level");

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("sort=reading-level");
    expect(href).not.toContain("page=");
  });

  it("leaves the default sort out of the URL rather than spelling it out", async () => {
    renderPanel({ sort: "section" });
    await pickSort("Alphabetical");

    const href = push.mock.calls[0][0] as string;
    expect(href).not.toContain("sort=");
  });

  it("does not offer Section where the grade has no sections", () => {
    renderPanel({ showSection: false, sections: [] });
    fireEvent.click(screen.getByLabelText("Sort by"));
    expect(
      screen.queryByRole("option", { name: "Section" })
    ).toBeNull();
  });
});
