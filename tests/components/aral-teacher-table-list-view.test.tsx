import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The below-`lg` stacked `<ul aria-label="ARAL learners">` in
 * `AralTeacherTable` duplicates the desktop table's rows, including its own
 * `aral-teacher-m-{id}` select distinct from the desktop `aral-teacher-{id}`
 * select. These tests fail if that list block is removed.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/aral",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const okResult = { ok: true as const };
const setLearnerAralTeacher = vi.fn(async (_fd: FormData) => okResult);
vi.mock("@/lib/actions/learner", () => ({
  setLearnerAralTeacher: (fd: FormData) => setLearnerAralTeacher(fd),
}));

const { AralTeacherTable } = await import("@/components/school-head/aral-teacher-table");
type AralLearnerRowType = Parameters<typeof AralTeacherTable>[0]["rows"][number];
type AralTeacherOptionType = Parameters<typeof AralTeacherTable>[0]["teachers"][number];

const ROWS: AralLearnerRowType[] = [
  {
    id: "learner-1",
    fullName: "Ada Cruz",
    gradeLabel: "Grade 3",
    sectionName: "Sampaguita",
    adviserName: "Marivic Santos",
    aralTeacherId: null,
  },
  {
    id: "learner-2",
    fullName: "Ben Santos",
    gradeLabel: "Grade 4",
    sectionName: "Rosal",
    adviserName: "Jose Reyes",
    aralTeacherId: null,
  },
];

const TEACHERS: AralTeacherOptionType[] = [
  { id: "teacher-1", fullName: "Marivic Santos", advisoryLabel: "Grade 3 · Sampaguita", employmentType: "DEPED_PLANTILLA" },
];

const LIST = {
  page: 1,
  totalPages: 1,
  totalCount: ROWS.length,
  q: "",
  basePath: "/school-head/aral",
  searchParams: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("AralTeacherTable — mobile list view", () => {
  it("renders the same row data as the desktop table", () => {
    render(<AralTeacherTable rows={ROWS} teachers={TEACHERS} list={LIST} />);

    const table = screen.getByRole("table");
    const list = screen.getByRole("list", { name: "ARAL learners" });

    for (const row of ROWS) {
      expect(within(table).getByText(row.fullName)).not.toBeNull();
      expect(within(list).getByText(row.fullName)).not.toBeNull();
    }

    expect(within(table).getAllByRole("row")).toHaveLength(ROWS.length + 1);
    expect(list.querySelectorAll("li")).toHaveLength(ROWS.length);
  });

  it("gives the mobile ARAL teacher select a unique id, distinct from the desktop one", () => {
    render(<AralTeacherTable rows={ROWS} teachers={TEACHERS} list={LIST} />);

    const desktopSelect = document.querySelector("#aral-teacher-learner-1");
    const mobileSelect = document.querySelector("#aral-teacher-m-learner-1");

    expect(desktopSelect).not.toBeNull();
    expect(mobileSelect).not.toBeNull();
    expect(mobileSelect).not.toBe(desktopSelect);
    expect(mobileSelect?.id).not.toBe(desktopSelect?.id);
  });

  it("wires the list's select to the same setLearnerAralTeacher action the table uses", async () => {
    render(<AralTeacherTable rows={ROWS} teachers={TEACHERS} list={LIST} />);

    const mobileSelect = document.querySelector(
      "#aral-teacher-m-learner-1"
    ) as HTMLSelectElement;
    expect(mobileSelect).not.toBeNull();

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(mobileSelect, { target: { value: "teacher-1" } });

    await vi.waitFor(() => {
      expect(setLearnerAralTeacher).toHaveBeenCalledTimes(1);
    });
    const fd = setLearnerAralTeacher.mock.calls[0][0] as FormData;
    expect(fd.get("learnerId")).toBe("learner-1");
    expect(fd.get("aralTeacherId")).toBe("teacher-1");
  });
});
