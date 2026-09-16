import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetGroup } from "@/lib/terms/sheet-data";

/**
 * The v2 End of Terms panel: the combined (All Advisories) sheet saves one
 * section at a time and names it, the Subject filter only hides columns, and a
 * second advisory gets its own heading.
 *
 * jsdom renders both the xl table and the phone list, so queries are scoped
 * to the tables.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/terms-reports",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const saveTermGrades = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  data: { saved: 1, cleared: 0 },
}));
const exportTermGrades = vi.fn(async (_input: unknown) => ({ ok: false as const, error: "x" }));
vi.mock("@/lib/actions/term-grades", () => ({
  saveTermGrades: (input: unknown) => saveTermGrades(input),
  exportTermGrades: (input: unknown) => exportTermGrades(input),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  }),
}));

const { TermsReportPanel } = await import("@/components/terms/terms-report-panel");

const G3_SUBJECTS = [
  { id: "g3-eng", name: "English" },
  { id: "g3-math", name: "Mathematics" },
];
const G4_SUBJECTS = [
  { id: "g4-eng", name: "English" },
  { id: "g4-sci", name: "Science" },
];

function groups(): SheetGroup[] {
  return [
    {
      key: "atis",
      gradeLevelId: "g3",
      sectionId: "atis",
      label: "Grade 3 - Atis",
      subjects: G3_SUBJECTS,
      learners: [{ id: "ana", fullName: "Ana Abad", sectionLabel: "3 - Atis" }],
      initialGrades: [{ learnerId: "ana", termSubjectId: "g3-eng", score: 80 }],
      indexOffset: 0,
    },
    {
      key: "mabolo",
      gradeLevelId: "g4",
      sectionId: "mabolo",
      label: "Grade 4 - Mabolo",
      subjects: G4_SUBJECTS,
      learners: [{ id: "carlo", fullName: "Carlo Cruz", sectionLabel: "4 - Mabolo" }],
      initialGrades: [],
      indexOffset: 1,
    },
  ];
}

function renderPanel(overrides: Partial<Parameters<typeof TermsReportPanel>[0]> = {}) {
  return render(
    <TermsReportPanel
      basePath="/teacher/terms-reports"
      state={{ advisory: null, section: "all", term: "FIRST", q: "", pageSize: 10 }}
      sections={[
        { id: "atis", name: "Atis" },
        { id: "mabolo", name: "Mabolo" },
      ]}
      groups={groups()}
      completionPct={0}
      termLabel="First Term"
      readOnly={false}
      canSave
      exportScope={{ sectionIds: ["atis", "mabolo"] }}
      page={1}
      totalPages={1}
      totalCount={2}
      {...overrides}
    />
  );
}

const tables = () => screen.getAllByRole("table");

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("TermsReportPanel", () => {
  it("heads each advisory's group and gives each its own grade's subjects", () => {
    renderPanel();
    expect(screen.getAllByText("Grade 3 - Atis").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Grade 4 - Mabolo").length).toBeGreaterThan(0);
    const [g3, g4] = tables();
    expect(within(g3).getByRole("columnheader", { name: "Mathematics" })).toBeTruthy();
    expect(within(g3).queryByRole("columnheader", { name: "Science" })).toBeNull();
    expect(within(g4).getByRole("columnheader", { name: "Science" })).toBeTruthy();
  });

  it("saves one call per section with changes, each naming its section", async () => {
    renderPanel();
    const [g3, g4] = tables();
    fireEvent.change(within(g3).getByLabelText("Ana Abad — Mathematics grade"), {
      target: { value: "90" },
    });
    fireEvent.change(within(g4).getByLabelText("Carlo Cruz — Science grade"), {
      target: { value: "85" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]);

    await waitFor(() => expect(saveTermGrades).toHaveBeenCalledTimes(2));
    expect(saveTermGrades).toHaveBeenNthCalledWith(1, {
      gradeLevelId: "g3",
      sectionId: "atis",
      term: "FIRST",
      entries: [{ learnerId: "ana", termSubjectId: "g3-math", score: 90 }],
    });
    expect(saveTermGrades).toHaveBeenNthCalledWith(2, {
      gradeLevelId: "g4",
      sectionId: "mabolo",
      term: "FIRST",
      entries: [{ learnerId: "carlo", termSubjectId: "g4-sci", score: 85 }],
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("sends nothing for a section that was not touched", async () => {
    renderPanel();
    const [g3] = tables();
    fireEvent.change(within(g3).getByLabelText("Ana Abad — English grade"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]);
    await waitFor(() => expect(saveTermGrades).toHaveBeenCalledTimes(1));
    expect(saveTermGrades.mock.calls[0][0]).toMatchObject({
      sectionId: "atis",
      entries: [{ learnerId: "ana", termSubjectId: "g3-eng", score: null }],
    });
  });

  it("shows no Save in a read-only view, and keeps Export", () => {
    renderPanel({ readOnly: true });
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /export/i }).length).toBeGreaterThan(0);
  });

  it("carries the whole scope's sections into the export", async () => {
    renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: /export/i })[0]);
    await waitFor(() => expect(exportTermGrades).toHaveBeenCalled());
    expect(exportTermGrades.mock.calls[0][0]).toMatchObject({
      term: "FIRST",
      sectionIds: ["atis", "mabolo"],
    });
  });
});
