import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AralTutorRow } from "@/lib/admin/aral-tutors";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/aral-tutors",
  useSearchParams: () => new URLSearchParams(""),
}));

const { AralTutorsTable, formatTutorGrades } = await import(
  "@/components/admin/management/aral-tutors-table"
);

afterEach(cleanup);

const BASE = "/school-head/aral-tutors";

function row(overrides: Partial<AralTutorRow> = {}): AralTutorRow {
  return {
    id: "t1",
    listingName: "Cruz, Ana",
    employment: "DEPED",
    employmentLabel: "DepEd",
    designation: null,
    advisorySummary: "Grade 3 · Sampaguita",
    aralLearnerCount: 6,
    grades: [
      { grade: "G3", label: "Grade 3", count: 4 },
      { grade: "G4", label: "Grade 4", count: 2 },
    ],
    school: { id: "s1", name: "Alpha Elementary" },
    ...overrides,
  };
}

function renderTable(
  props: Partial<React.ComponentProps<typeof AralTutorsTable>> & { totalCount?: number; q?: string } = {}
) {
  const { totalCount, q = "", ...rest } = props;
  const rows = rest.rows ?? [];
  return render(
    <AralTutorsTable
      rows={rows}
      filters={[]}
      basePath={BASE}
      sort="name"
      list={{ page: 1, pageSize: 25, totalPages: 1, totalCount: totalCount ?? rows.length, q }}
      {...rest}
    />
  );
}

describe("formatTutorGrades", () => {
  it("joins grades with a middle dot and puts the learner count in brackets", () => {
    expect(formatTutorGrades(row().grades)).toBe("Grade 3 (4) · Grade 4 (2)");
  });
});

describe("AralTutorsTable", () => {
  it("shows the empty state when no teacher tutors ARAL learners", () => {
    renderTable();
    expect(screen.getByText("No teacher is tutoring ARAL learners yet")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/no tutor\./)).toBeNull();
  });

  it("says nothing matches, with a way back, when a search finds no tutor", () => {
    renderTable({ q: "zzz", totalCount: 0 });
    expect(screen.getByText("No tutors match")).not.toBeNull();
    expect(screen.queryByText("No teacher is tutoring ARAL learners yet")).toBeNull();
    expect(screen.getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe(BASE);
  });

  it("lists name, employment chip, advisory, count and the grade summary", () => {
    renderTable({ rows: [row()] });
    const table = screen.getByRole("table");
    expect(within(table).getByText("Cruz, Ana")).not.toBeNull();
    expect(within(table).getByText("DepEd")).not.toBeNull();
    expect(within(table).getByText("Grade 3 · Sampaguita")).not.toBeNull();
    expect(within(table).getByText("6")).not.toBeNull();
    expect(within(table).getByText("Grade 3 (4) · Grade 4 (2)")).not.toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "School" })).toBeNull();
  });

  it("marks a Non-DepEd volunteer and a tutor with no advisory", () => {
    renderTable({
      rows: [
        row({
          id: "t2",
          listingName: "Reyes, Ben",
          employment: "NON_DEPED",
          employmentLabel: "Non-DepEd",
          advisorySummary: null,
        }),
      ],
    });
    const table = screen.getByRole("table");
    expect(within(table).getByText("Non-DepEd")).not.toBeNull();
    expect(within(table).getByText("No advisory")).not.toBeNull();
  });

  it("adds the School column only for the admin page", () => {
    renderTable({ rows: [row()], showSchool: true });
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "School" })).not.toBeNull();
    expect(within(table).getByText("Alpha Elementary")).not.toBeNull();
  });

  it("never nests a block element in a paragraph in the mobile card list", () => {
    renderTable({ rows: [row(), row({ id: "t2", employment: "NON_DEPED" })] });
    const list = screen.getByRole("list", { name: "ARAL tutors" });
    expect(list.querySelectorAll("p div")).toHaveLength(0);
    const chip = within(list).getAllByText("DepEd")[0]!;
    expect(chip.closest("p")).toBeNull();
  });

  it("renders no dash in the mobile card when employment is unknown, but keeps it in the table", () => {
    renderTable({ rows: [row({ employment: null, employmentLabel: null })] });
    const list = screen.getByRole("list", { name: "ARAL tutors" });
    expect(within(list).queryByText("—")).toBeNull();
    expect(within(screen.getByRole("table")).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("suggests a different search, not a wider filter, when only a search term narrows", () => {
    renderTable({ q: "zzz", totalCount: 0 });
    expect(screen.getByText(/Try a different search or clear it\./)).not.toBeNull();
    expect(screen.queryByText(/wider filter/)).toBeNull();
  });

  it("suggests a wider filter when a filter narrows", () => {
    renderTable({
      totalCount: 0,
      filters: [
        {
          key: "grade",
          label: "Grade",
          allLabel: "All grades",
          value: "G3",
          options: [{ value: "G3", label: "Grade 3" }],
        },
      ],
    });
    expect(screen.getByText(/Try a wider filter or clear them\./)).not.toBeNull();
  });});


