import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import type { SheetGroup } from "@/lib/terms/sheet-data";

/**
 * Nothing a teacher typed on the weekly attendance grid, the monthly reading-level
 * grid or the term grades sheet may be thrown away without their say-so. Each
 * grid shows an "Unsaved changes" badge while it differs from the last save, and
 * every move that would discard it (week, month, section, links, closing the tab)
 * asks first: Save and continue / Discard changes / Stay.
 */

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh, prefetch: vi.fn() }),
  usePathname: () => "/teacher/terms-reports",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _p,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchAralAttendanceForWeek = vi.fn();
const fetchAralReadingLevelForMonth = vi.fn();
vi.mock("@/lib/actions/aral-grid", () => ({
  fetchAralAttendanceForWeek: (...args: unknown[]) => fetchAralAttendanceForWeek(...args),
  fetchAralReadingLevelForMonth: (...args: unknown[]) => fetchAralReadingLevelForMonth(...args),
}));

const saveAralWeeklyAttendance = vi.fn();
vi.mock("@/lib/actions/attendance", () => ({
  saveAralWeeklyAttendance: (...args: unknown[]) => saveAralWeeklyAttendance(...args),
}));

const bulkRecordMonthlyReadingLevel = vi.fn();
vi.mock("@/lib/actions/reading-level", () => ({
  bulkRecordMonthlyReadingLevel: (...args: unknown[]) => bulkRecordMonthlyReadingLevel(...args),
}));

const saveTermGrades = vi.fn();
vi.mock("@/lib/actions/term-grades", () => ({
  saveTermGrades: (...args: unknown[]) => saveTermGrades(...args),
  exportTermGrades: vi.fn(),
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
const { AralMonthlyReadingLevelPanel } = await import(
  "@/components/aral/aral-monthly-reading-level-panel"
);
const { TermsReportPanel } = await import("@/components/terms/terms-report-panel");

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchAralAttendanceForWeek.mockResolvedValue({
    ok: true,
    data: { records: [], holidayKeys: [] },
  });
  fetchAralReadingLevelForMonth.mockResolvedValue({
    ok: true,
    data: { records: [], progress: { completed: 0, total: 1 } },
  });
  saveAralWeeklyAttendance.mockResolvedValue({ ok: true });
  bulkRecordMonthlyReadingLevel.mockResolvedValue({
    ok: true,
    data: { upserted: 1, cleared: 0 },
  });
  saveTermGrades.mockResolvedValue({ ok: true, data: { saved: 1, cleared: 0 } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const dialog = () => screen.findByRole("alertdialog");
const button = (name: string | RegExp) => screen.getByRole("button", { name });
// The terms sheet renders the badge in both its phone and desktop toolbars.
const hasBadge = () => screen.queryAllByText("Unsaved changes").length > 0;

describe("weekly attendance grid", () => {
  const WEEK = "2026-09-07";
  const LEARNERS = [
    { id: "l1", fullName: "Ana Santos", listingName: "Santos, Ana", sectionName: null },
    { id: "l2", fullName: "Ben Cruz", listingName: "Cruz, Ben", sectionName: null },
  ];
  const EXISTING = [{ learnerId: "l1", dateKey: WEEK, status: "PRESENT", notes: null }];

  function renderWeekly() {
    return render(
      <>
        <Link href="/teacher/dashboard">Dashboard</Link>
        <AralWeeklyAttendancePanel
          gradeId="grade-1"
          grades={[{ id: "grade-1", label: "Grade 3" }]}
          basePath="/teacher/aral/grade-1/attendance"
          initialWeekKey={WEEK}
          section="all"
          sections={[]}
          showSection={false}
          learners={LEARNERS}
          initialExisting={EXISTING}
          initialHolidayKeys={[]}
          lockingEnabled={false}
        />
      </>
    );
  }

  const makeDirty = () => fireEvent.click(button("Clear Ana Santos's week"));

  it("changes week straight away when nothing is unsaved", () => {
    renderWeekly();
    expect(hasBadge()).toBe(false);
    fireEvent.click(button("Next week"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchAralAttendanceForWeek).toHaveBeenCalledTimes(1);
  });

  it("marks the grid unsaved, and clean again once the change is undone by saving", async () => {
    renderWeekly();
    makeDirty();
    expect(hasBadge()).toBe(true);
    fireEvent.click(button("Save attendance"));
    await waitFor(() => expect(saveAralWeeklyAttendance).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hasBadge()).toBe(false));
  });

  it("asks before leaving the week, and Stay keeps the week and the marks", async () => {
    renderWeekly();
    makeDirty();
    fireEvent.click(button("Next week"));

    const box = await dialog();
    expect(within(box).getByText("You have unsaved changes")).toBeTruthy();
    expect(fetchAralAttendanceForWeek).not.toHaveBeenCalled();

    fireEvent.click(within(box).getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(fetchAralAttendanceForWeek).not.toHaveBeenCalled();
    expect(hasBadge()).toBe(true);
  });

  it("Discard changes switches the week without saving", async () => {
    renderWeekly();
    makeDirty();
    fireEvent.click(button("Next week"));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(fetchAralAttendanceForWeek).toHaveBeenCalledTimes(1));
    expect(saveAralWeeklyAttendance).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Save and continue saves first and switches only after the server accepted it", async () => {
    let finishSave: (value: { ok: true }) => void = () => {};
    saveAralWeeklyAttendance.mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      })
    );
    renderWeekly();
    makeDirty();
    fireEvent.click(button("Next week"));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(saveAralWeeklyAttendance).toHaveBeenCalledTimes(1));
    expect(fetchAralAttendanceForWeek).not.toHaveBeenCalled();
    expect(
      (within(screen.getByRole("alertdialog")).getByRole("button", { name: /saving/i }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    await act(async () => finishSave({ ok: true }));
    await waitFor(() => expect(fetchAralAttendanceForWeek).toHaveBeenCalledTimes(1));
  });

  it("stays on the week with the marks intact when the save is refused", async () => {
    saveAralWeeklyAttendance.mockResolvedValue({
      ok: false,
      code: "SERVER_ERROR",
      error: "Could not save attendance.",
    });
    renderWeekly();
    makeDirty();
    fireEvent.click(button("Next week"));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
    expect(fetchAralAttendanceForWeek).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(hasBadge()).toBe(true);
  });

  it("stays put and sends nothing when the device is offline", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderWeekly();
    makeDirty();
    fireEvent.click(button("Next week"));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
    expect(saveAralWeeklyAttendance).not.toHaveBeenCalled();
    expect(fetchAralAttendanceForWeek).not.toHaveBeenCalled();
    expect(hasBadge()).toBe(true);
  });

  it("holds back a link click while unsaved, and follows it once discarded", async () => {
    renderWeekly();
    makeDirty();
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));

    expect(push).not.toHaveBeenCalled();
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Discard changes" }));
    expect(push).toHaveBeenCalledWith("/teacher/dashboard");
  });

  it("lets a link click through when nothing is unsaved", () => {
    renderWeekly();
    const link = screen.getByRole("link", { name: "Dashboard" });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("prompts the browser on tab close only while unsaved", () => {
    renderWeekly();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    makeDirty();
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("a save that is refused without being tried", () => {
  it("tells the teacher when the weekly grid is locked", async () => {
    const { AralWeeklyAttendanceGridForm } = await import(
      "@/components/forms/aral-weekly-attendance-grid-form"
    );
    const { createRef } = await import("react");
    const ref = createRef<import("@/components/forms/aral-weekly-attendance-grid-form").AralWeeklyAttendanceGridFormHandle>();
    render(
      <AralWeeklyAttendanceGridForm
        ref={ref}
        gradeId="g"
        weekStartKey="2026-09-07"
        learners={[{ id: "l1", fullName: "Ana Santos", listingName: "Santos, Ana", sectionName: null }]}
        existing={[]}
        holidayKeys={[]}
        showSection={false}
        readOnly
      />
    );
    let result: boolean | undefined;
    await act(async () => {
      result = await ref.current?.persist();
    });
    expect(result).toBe(false);
    expect(toastFn.error).toHaveBeenCalledWith(expect.stringContaining("locked"));
    expect(saveAralWeeklyAttendance).not.toHaveBeenCalled();
  });

  it("tells the teacher when the monthly grid is locked", async () => {
    const { AralMonthlyReadingLevelGridForm } = await import(
      "@/components/forms/aral-monthly-reading-level-grid-form"
    );
    const { createRef } = await import("react");
    const ref = createRef<import("@/components/forms/aral-monthly-reading-level-grid-form").AralMonthlyReadingLevelGridFormHandle>();
    render(
      <AralMonthlyReadingLevelGridForm
        ref={ref}
        monthStartKey="2026-09-01"
        gradeType="G3"
        learners={[{ id: "l1", fullName: "Ana Santos", listingName: "Santos, Ana" }]}
        existing={[]}
        readOnly
      />
    );
    let result: boolean | undefined;
    await act(async () => {
      result = await ref.current?.persist();
    });
    expect(result).toBe(false);
    expect(toastFn.error).toHaveBeenCalledWith(expect.stringContaining("locked"));
    expect(bulkRecordMonthlyReadingLevel).not.toHaveBeenCalled();
  });
});

describe("monthly reading-level grid", () => {
  const MONTH = "2026-09-01";

  function renderMonthly() {
    return render(
      <AralMonthlyReadingLevelPanel
        gradeId="grade-1"
        gradeType="G3"
        grades={[]}
        basePath="/teacher/aral/grade-1/reading-level"
        initialMonthKey={MONTH}
        section="all"
        sections={[]}
        showSection={false}
        gender="all"
        sort="name"
        learners={[{ id: "l1", fullName: "Ana Santos", listingName: "Santos, Ana" }]}
        initialExisting={[]}
        initialProgress={{ completed: 0, total: 1 }}
        page={1}
        pageSize={20}
        totalPages={1}
        totalCount={1}
        lockingEnabled={false}
      />
    );
  }

  async function makeDirty() {
    const label = "Ana Santos — English reading level";
    fireEvent.click(button(/^Ana Santos — English reading level: /));
    const listbox = await screen.findByRole("listbox", { name: label });
    fireEvent.click(within(listbox).getByText("GR"));
  }

  it("changes month straight away when nothing is unsaved", () => {
    renderMonthly();
    fireEvent.click(button("Next month"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchAralReadingLevelForMonth).toHaveBeenCalledTimes(1);
  });

  it("shows the badge, asks before changing month, and saves then continues", async () => {
    renderMonthly();
    expect(hasBadge()).toBe(false);
    await makeDirty();
    expect(hasBadge()).toBe(true);

    fireEvent.click(button("Next month"));
    expect(fetchAralReadingLevelForMonth).not.toHaveBeenCalled();
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchAralReadingLevelForMonth).toHaveBeenCalledTimes(1));
  });

  it("keeps the month and the levels when the save fails", async () => {
    bulkRecordMonthlyReadingLevel.mockResolvedValue({
      ok: false,
      code: "SERVER_ERROR",
      error: "Could not save reading levels.",
    });
    renderMonthly();
    await makeDirty();
    fireEvent.click(button("Next month"));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
    expect(fetchAralReadingLevelForMonth).not.toHaveBeenCalled();
    expect(hasBadge()).toBe(true);
  });

  it("Discard changes drops the pick and moves on", async () => {
    renderMonthly();
    await makeDirty();
    fireEvent.click(button("Next month"));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(fetchAralReadingLevelForMonth).toHaveBeenCalledTimes(1));
    expect(bulkRecordMonthlyReadingLevel).not.toHaveBeenCalled();
  });

  it("holds back the Gender filter, which reloads the roster, until answered", async () => {
    renderMonthly();
    await makeDirty();
    fireEvent.click(screen.getByLabelText("Filter by gender"));
    fireEvent.click(await screen.findByRole("option", { name: "Male" }));

    expect(push).not.toHaveBeenCalled();
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(String(push.mock.calls[0][0])).toContain("gender=MALE");
  });
});

describe("term grades sheet", () => {
  const GROUPS: SheetGroup[] = [
    {
      key: "atis",
      gradeLevelId: "g3",
      gradeType: "G3",
      sectionId: "atis",
      label: "Grade 3 - Atis",
      subjects: [
        { id: "g3-eng", name: "English" },
        { id: "g3-math", name: "Mathematics" },
      ],
      learners: [{ id: "ana", fullName: "Ana Abad", sectionLabel: "3 - Atis" }],
      initialGrades: [{ learnerId: "ana", termSubjectId: "g3-eng", score: 80, mark: null }],
      indexOffset: 0,
    },
  ];

  function renderTerms(section = "all") {
    return render(
      <>
        <Link href="/teacher/dashboard">Dashboard</Link>
        <TermsReportPanel
          basePath="/teacher/terms-reports"
          state={{ advisory: null, section, term: "FIRST", q: "", pageSize: 10 }}
          sections={[
            { id: "atis", name: "Atis" },
            { id: "mabolo", name: "Mabolo" },
          ]}
          groups={GROUPS}
          completionPct={0}
          termLabel="First Term"
          readOnly={false}
          canSave
          exportScope={{ sectionIds: ["atis"] }}
          page={1}
          totalPages={1}
          totalCount={1}
        />
      </>
    );
  }

  const cell = () =>
    within(screen.getAllByRole("table")[0]).getByLabelText(
      "Ana Abad — Mathematics grade"
    ) as HTMLInputElement;

  async function pickSection(name: string) {
    fireEvent.click(screen.getAllByLabelText("Section")[0]);
    fireEvent.click(await screen.findByRole("option", { name }));
  }

  it("follows the section filter at once when no grade was typed", async () => {
    renderTerms();
    await pickSection("Mabolo");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("shows the badge for a typed grade and asks before a filter reloads the sheet", async () => {
    renderTerms();
    expect(hasBadge()).toBe(false);
    fireEvent.change(cell(), { target: { value: "90" } });
    expect(hasBadge()).toBe(true);

    await pickSection("Mabolo");
    expect(push).not.toHaveBeenCalled();
    expect(within(await dialog()).getByText("You have unsaved changes")).toBeTruthy();
  });

  it("Save and continue saves the grade, then applies the filter", async () => {
    renderTerms();
    fireEvent.change(cell(), { target: { value: "90" } });
    await pickSection("Mabolo");
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(saveTermGrades).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(String(push.mock.calls[0][0])).toContain("section=mabolo");
  });

  it("keeps the grade and the sheet when the save is refused", async () => {
    saveTermGrades.mockResolvedValue({ ok: false, code: "SERVER_ERROR", error: "Term is locked." });
    renderTerms();
    fireEvent.change(cell(), { target: { value: "90" } });
    await pickSection("Mabolo");
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
    expect(cell().value).toBe("90");
    expect(hasBadge()).toBe(true);
  });

  it("does not move on when a typed grade is not a valid score", async () => {
    renderTerms();
    fireEvent.change(cell(), { target: { value: "abc" } });
    await pickSection("Mabolo");
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
    expect(saveTermGrades).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(cell().value).toBe("abc");
  });

  it("does not search mid-typing while grades are unsaved, and asks only on Enter", async () => {
    renderTerms();
    fireEvent.change(cell(), { target: { value: "90" } });
    const box = screen.getAllByRole("searchbox")[0];
    fireEvent.change(box, { target: { value: "ana" } });

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Save or discard your changes to search/).length).toBeGreaterThan(0);

    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Discard changes" }));
    expect(String(push.mock.calls[0][0])).toContain("q=ana");
  });

  it("still searches by debounce when nothing is unsaved", async () => {
    renderTerms();
    fireEvent.change(screen.getAllByRole("searchbox")[0], { target: { value: "ana" } });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("does not ask again for a second link click once the first was answered", async () => {
    renderTerms();
    fireEvent.change(cell(), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Discard changes restores the saved grades and moves on", async () => {
    renderTerms();
    fireEvent.change(cell(), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Discard changes" }));

    expect(push).toHaveBeenCalledWith("/teacher/dashboard");
    expect(saveTermGrades).not.toHaveBeenCalled();
    await waitFor(() => expect(hasBadge()).toBe(false));
    expect(cell().value).toBe("");
  });
});

describe("terms report filters on a phone", () => {
  const GROUPS: SheetGroup[] = [
    {
      key: "atis",
      gradeLevelId: "g3",
      gradeType: "G3",
      sectionId: "atis",
      label: "Grade 3 - Atis",
      subjects: [{ id: "g3-eng", name: "English" }],
      learners: [{ id: "ana", fullName: "Ana Abad", sectionLabel: "3 - Atis" }],
      initialGrades: [],
      indexOffset: 0,
    },
  ];

  function renderTerms(section = "all") {
    return render(
      <TermsReportPanel
        basePath="/teacher/terms-reports"
        state={{ advisory: null, section, term: "FIRST", q: "", pageSize: 10 }}
        sections={[{ id: "atis", name: "Atis" }]}
        groups={GROUPS}
        completionPct={0}
        termLabel="First Term"
        readOnly={false}
        canSave
        exportScope={{ sectionIds: ["atis"] }}
        page={1}
        totalPages={1}
        totalCount={1}
      />
    );
  }

  it("offers a Filters button that opens the Section and Subject filters", async () => {
    renderTerms();
    expect(document.getElementById("terms-section-popover")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

    await waitFor(() =>
      expect(document.getElementById("terms-section-popover")).not.toBeNull()
    );
    expect(document.getElementById("terms-subject-popover")).not.toBeNull();
  });

  it("says how many filters are active", () => {
    renderTerms("atis");
    expect(screen.getByRole("button", { name: "Filters 1 active" })).toBeTruthy();
  });

  it("keeps the inline filters for tablets and desktops", () => {
    renderTerms();
    expect(document.getElementById("terms-section-phone")).not.toBeNull();
    expect(document.getElementById("terms-section-desktop")).not.toBeNull();
  });
});
