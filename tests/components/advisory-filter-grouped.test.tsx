import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every advisory filter reads the same: "All advisories", then each grade as a
 * heading over its sections ("Kinder - A"), with no "All of Kinder" row.
 */

const push = vi.fn();
const listNavigate = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("schoolId=sch"),
}));
vi.mock("@/components/nav/list-navigation", () => ({
  useListNavigate: () => listNavigate,
}));
vi.mock("@/lib/ui/unsaved-guard", () => ({
  runGuarded: (fn: () => void) => fn(),
}));

const { AdvisorySelect, groupAdvisoriesByGrade } = await import(
  "@/components/learners/advisory-select"
);
const { AralAdvisoryFilter } = await import("@/components/aral/aral-scope-select");
const { MosyToolbar } = await import("@/components/aral/mosy-toolbar");

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  push.mockReset();
  listNavigate.mockReset();
});
afterEach(cleanup);

function open() {
  fireEvent.click(screen.getByRole("combobox", { name: "Advisory" }));
}

function expectGroupedNoAllOf() {
  const listbox = screen.getByRole("listbox");
  // The grade heading is text, not an option.
  expect(within(listbox).getByText("Kinder")).toBeTruthy();
  expect(within(listbox).getByText("Grade 1")).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Kinder" })).toBeNull();
  expect(screen.getByRole("option", { name: "Kinder - A" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Kinder - B" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Grade 1 - A" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /^All of / })).toBeNull();
  expect(screen.getByRole("option", { name: "All advisories" })).toBeTruthy();
}

describe("groupAdvisoriesByGrade", () => {
  it("groups by the grade before the first ' - ', in arrival order", () => {
    const groups = groupAdvisoriesByGrade([
      { id: "a", label: "Kinder - A" },
      { id: "c", label: "Grade 1 - A" },
      { id: "b", label: "Kinder - B" },
    ]);
    expect(groups.map((g) => [g.grade, g.items.map((i) => i.id)])).toEqual([
      ["Kinder", ["a", "b"]],
      ["Grade 1", ["c"]],
    ]);
  });

  it("reads the · separator the same way, and gives a bare label no heading", () => {
    const groups = groupAdvisoriesByGrade([
      { id: "r", label: "Kindergarten · Rose" },
      { id: "z", label: "Unplaced" },
    ]);
    expect(groups.map((g) => g.grade)).toEqual(["Kindergarten", null]);
  });

  it("keeps a section name that itself contains ' - ' under its grade", () => {
    const [group] = groupAdvisoriesByGrade([{ id: "x", label: "Grade 2 - Rosal - Annex" }]);
    expect(group.grade).toBe("Grade 2");
  });
});

describe("AdvisorySelect (Learners, End of Terms)", () => {
  it("lists grade headings over their sections, with no All of row", () => {
    render(
      <AdvisorySelect
        advisories={[
          { id: "ka", label: "Kinder - A" },
          { id: "kb", label: "Kinder - B" },
          { id: "g1a", label: "Grade 1 - A" },
        ]}
        value={null}
        onChange={() => {}}
      />
    );
    open();
    expectGroupedNoAllOf();
  });
});

const GROUPS = [
  {
    gradeId: "k",
    gradeLabel: "Kinder",
    sections: [
      { id: "ka", name: "A" },
      { id: "kb", name: "B" },
    ],
  },
  { gradeId: "g1", gradeLabel: "Grade 1", sections: [{ id: "g1a", name: "A" }] },
];

describe("AralAdvisoryFilter (Weekly Attendance)", () => {
  it("lists grade headings over their sections, with no All of row", () => {
    render(
      <AralAdvisoryFilter
        groups={GROUPS}
        value="all"
        allHref="/teacher/aral/attendance"
        pathForGrade={(id) => `/teacher/aral/${id}/attendance`}
      />
    );
    open();
    expectGroupedNoAllOf();
  });

  it("opens the all-grades page narrowed to a picked section", () => {
    render(
      <AralAdvisoryFilter
        groups={GROUPS}
        value="all"
        schoolId="sch"
        allHref="/teacher/aral/attendance"
        pathForGrade={(id) => `/teacher/aral/${id}/attendance`}
        preserveParams={{ week: "2026-11-23" }}
      />
    );
    open();
    fireEvent.click(screen.getByRole("option", { name: "Kinder - B" }));
    expect(push).toHaveBeenCalledWith(
      "/teacher/aral/attendance?schoolId=sch&week=2026-11-23&section=kb"
    );
  });

  it("with one grade, stays on that grade's page", () => {
    render(
      <AralAdvisoryFilter
        groups={[GROUPS[0]]}
        value="ka"
        allHref="/teacher/aral/attendance"
        pathForGrade={(id) => `/teacher/aral/${id}/attendance`}
        currentGradeId="k"
      />
    );
    open();
    fireEvent.click(screen.getByRole("option", { name: "All advisories" }));
    expect(push).toHaveBeenCalledWith("/teacher/aral/k/attendance");
  });

  it("renders nothing when there is only one choice", () => {
    render(
      <AralAdvisoryFilter
        groups={[{ gradeId: "g1", gradeLabel: "Grade 1", sections: [{ id: "g1a", name: "A" }] }]}
        value="all"
        allHref="/teacher/aral/attendance"
        pathForGrade={(id) => `/teacher/aral/${id}/attendance`}
      />
    );
    expect(screen.queryByRole("combobox", { name: "Advisory" })).toBeNull();
  });
});

describe("MosyToolbar (MOSY and BOSY)", () => {
  const grades = [
    { id: "k", label: "Kinder", sections: [{ id: "ka", name: "A" }, { id: "kb", name: "B" }] },
    { id: "g1", label: "Grade 1", sections: [{ id: "g1a", name: "A" }] },
  ];

  it("is one advisory filter, grouped, with no All of row", () => {
    render(<MosyToolbar q="" grade="" section="all" status="all" grades={grades} />);
    expect(screen.queryByRole("combobox", { name: "Grade and section" })).toBeNull();
    open();
    expectGroupedNoAllOf();
  });

  it("writes grade and section together when a section is picked", () => {
    render(<MosyToolbar q="" grade="" section="all" status="all" grades={grades} />);
    open();
    fireEvent.click(screen.getByRole("option", { name: "Grade 1 - A" }));
    const href = listNavigate.mock.calls[0][0] as string;
    const sp = new URL(href, "http://x").searchParams;
    expect(sp.get("grade")).toBe("g1");
    expect(sp.get("section")).toBe("g1a");
    expect(sp.get("schoolId")).toBe("sch");
  });
});
