import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerProfileData } from "@/lib/learners/profile";

/**
 * The Student Profile dialog on the teacher roster.
 *
 * Three things here are contract rather than styling, so they are asserted
 * directly: the view mode never offers an editable control, its footer carries
 * the three actions that replaced the comp's single "Close" — Transfer student,
 * Enroll as ARAL, Edit — and Edit turns the dialog into the form in place rather
 * than navigating to a page.
 *
 * Playwright would be the natural home for the click-through, but every e2e spec
 * in this repo is unauthenticated (no login fixture exists) and the only seeded
 * account is a Super Admin, who by design sees the suppressed footer. So the
 * teacher-facing footer is only reachable from a component test.
 */

beforeAll(() => {
  // Radix Dialog / AlertDialog reach for pointer capture, which jsdom lacks.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
}));

const getLearnerProfile = vi.fn();
vi.mock("@/lib/actions/learner-profile", () => ({
  getLearnerProfile: (...args: unknown[]) => getLearnerProfile(...(args as [])),
}));

type StubFormProps = {
  mode?: string;
  submitLabel?: string;
  gradeLevelId?: string;
  gradeType?: string;
  placement?: { gradeLabel: string; sectionName: string | null };
  defaultValues?: Record<string, unknown>;
  onSaved?: () => void;
  onCancel?: () => void;
};

/** What the dialog last handed the form. Reset per test. */
let formProps: StubFormProps | null = null;

/**
 * The form is stubbed. What edit mode owes it is a contract — the learner's own
 * defaults, the placement to show read-only, and two callbacks — and asserting
 * that through the real sixty-field form would be testing the form instead.
 *
 * Mocking the module also stands in for the chunk `next/dynamic` fetches, so the
 * lazy path the dialog actually uses is still the path under test.
 */
vi.mock("@/components/forms/learner-form", () => ({
  LearnerForm: (props: StubFormProps) => {
    formProps = props;
    return (
      <div>
        <p>learner form stub</p>
        <button type="button" onClick={() => props.onCancel?.()}>
          Cancel
        </button>
        <button type="button" onClick={() => props.onSaved?.()}>
          {props.submitLabel ?? "Save"}
        </button>
      </div>
    );
  },
}));

const toggleAralLearner = vi.fn();
const enrollRosterLearnersToAral = vi.fn();
vi.mock("@/lib/actions/learner", () => ({
  toggleAralLearner: (...args: unknown[]) => toggleAralLearner(...(args as [])),
  enrollRosterLearnersToAral: (...args: unknown[]) =>
    enrollRosterLearnersToAral(...(args as [])),
}));

/** The tutor picker's list. A server action, so it is stubbed, not imported. */
const listAralTutorOptions = vi.fn();
vi.mock("@/lib/actions/aral-tutors", () => ({
  listAralTutorOptions: () => listAralTutorOptions(),
}));

vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
    loading: () => "toast-1",
  },
}));

const { LearnerProfileModal } = await import(
  "@/components/learners/learner-profile-modal"
);

function makeLearner(
  overrides: Partial<LearnerProfileData> = {}
): LearnerProfileData {
  return {
    id: "learner-1",
    fullName: "Ana Santos",
    firstName: "Ana",
    middleName: "Reyes",
    lastName: "Santos",
    age: 10,
    gender: "FEMALE",
    ethnicity: null,
    ethnicityOther: null,
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    englishFrustrationSubtypes: [],
    filipinoFrustrationSubtypes: [],
    governmentBenefits: [],
    parentEducation: "COLLEGE_GRADUATE",
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
    ...overrides,
  };
}

function renderModal(
  props: Partial<{
    learnerId: string | null;
    isSuperAdmin: boolean;
    initialIsAralLearner: boolean;
    initialMode: "view" | "edit";
    onClose: () => void;
  }> = {}
) {
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <LearnerProfileModal
      // `??` would swallow a deliberate null, which is the closed case.
      learnerId={"learnerId" in props ? props.learnerId! : "learner-1"}
      onClose={onClose}
      isSuperAdmin={props.isSuperAdmin ?? false}
      initialIsAralLearner={props.initialIsAralLearner ?? false}
      initialMode={props.initialMode ?? "view"}
    />
  );
  return { ...view, onClose };
}

/** Holds the fetch open so the loading frame can be asserted. */
function deferProfile(): (value: unknown) => void {
  let settle: (value: unknown) => void = () => {};
  getLearnerProfile.mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    })
  );
  return (value) => settle(value);
}

/**
 * The footer, by DOM rather than by role: once a confirm sheet opens Radix marks
 * the dialog `aria-hidden`, and these assertions still need to reach past it.
 */
function footer(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"] footer');
  if (!el) throw new Error("dialog footer did not render");
  return el;
}

/** Footer button labels, whitespace-collapsed, in render order. */
function footerLabels(): string[] {
  return Array.from(footer().querySelectorAll("button")).map((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").trim()
  );
}

/**
 * The ARAL action's current label, by name rather than by position: an enrolled
 * learner also gets Transfer tutor, so the footer's length is not fixed and an
 * index would be asserting the wrong thing.
 */
function aralActionLabel(): string | undefined {
  return footerLabels().find(
    (l) => l === "Enroll as ARAL" || l === "Remove from ARAL"
  );
}

/** Resolves once the fetched row has replaced the loading skeleton. */
const awaitLoaded = () => screen.findByText("Ana Santos");

/** Resolves once the lazily-imported form has taken over the dialog body. */
const awaitForm = () => screen.findByText("learner form stub");

beforeEach(() => {
  vi.clearAllMocks();
  formProps = null;
  getLearnerProfile.mockResolvedValue({ ok: true, data: makeLearner() });
  toggleAralLearner.mockResolvedValue({ ok: true });
  enrollRosterLearnersToAral.mockResolvedValue({
    ok: true,
    data: { enrolled: 1, redesignated: 0 },
  });
  // One plantilla teacher (this one, hence `selfId`) and one volunteer, because
  // the brief admits both as tutors.
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

describe("LearnerProfileModal — shell", () => {
  it("stays closed when no learner is selected", () => {
    renderModal({ learnerId: null });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getLearnerProfile).not.toHaveBeenCalled();
  });

  it("fetches the selected learner and titles the dialog", async () => {
    renderModal();
    await awaitLoaded();
    expect(getLearnerProfile).toHaveBeenCalledWith("learner-1");
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText("Student Profile")).not.toBeNull();
  });

  it("offers all five tabs from the comp", async () => {
    renderModal();
    await awaitLoaded();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Profile",
      "Attendance",
      "Reading Level",
      "Grades",
      "ARAL Progress",
    ]);
  });

  it("says plainly that grades live elsewhere", async () => {
    renderModal();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Grades" }));
    expect(screen.getByText("Grades aren't tracked in LITRACK")).not.toBeNull();
  });

  it("re-fetches and returns to the first tab for a different learner", async () => {
    const { rerender } = renderModal();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "ARAL Progress" }));
    expect(screen.getByRole("tab", { name: "ARAL Progress" })).toHaveProperty(
      "ariaSelected",
      "true"
    );

    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({ id: "learner-2", fullName: "Ben Cruz" }),
    });
    rerender(
      <LearnerProfileModal
        learnerId="learner-2"
        onClose={vi.fn()}
        isSuperAdmin={false}
      />
    );

    await screen.findByText("Ben Cruz");
    expect(getLearnerProfile).toHaveBeenLastCalledWith("learner-2");
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveProperty(
      "ariaSelected",
      "true"
    );
  });

  it("shows the action's message instead of an empty dialog on failure", async () => {
    getLearnerProfile.mockResolvedValue({ ok: false, error: "Not found" });
    renderModal();
    expect(await screen.findByText("Not found")).not.toBeNull();
    expect(screen.queryByText("Ana Santos")).toBeNull();
    // A row that never loaded leaves nothing to act on, so the footer collapses.
    expect(footerLabels()).toEqual(["Close"]);
  });
});

describe("LearnerProfileModal — view mode is read-only", () => {
  it("renders no editable control in any tab", async () => {
    renderModal();
    await awaitLoaded();

    // Every tab, no exceptions: the one control that used to live in one —
    // changing the ARAL tutor — is a footer action now.
    for (const tab of ["Profile", "Attendance", "Reading Level", "Grades", "ARAL Progress"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      const panel = within(screen.getByRole("tabpanel"));
      for (const role of ["textbox", "combobox", "checkbox", "radio", "spinbutton", "slider"] as const) {
        expect(panel.queryAllByRole(role), `${role} in ${tab}`).toHaveLength(0);
      }
      expect(panel.queryAllByRole("button")).toHaveLength(0);
      expect(
        screen.getByRole("dialog").querySelectorAll("input, textarea, select, form")
      ).toHaveLength(0);
    }
  });
});

describe("LearnerProfileModal — footer actions", () => {
  it("draws all three actions while the row is still loading", async () => {
    const settle = deferProfile();
    renderModal();

    // The skeleton is up and the footer is already its final shape — the lone
    // Close it used to show here made the footer change size mid-load.
    await waitFor(() => expect(footerLabels()).toHaveLength(3));
    expect(footerLabels()).toEqual([
      "Transfer studentSoon",
      "Enroll as ARAL",
      "Edit",
    ]);
    // Drawn, but not yet usable: there is no learner to act on.
    for (const button of footer().querySelectorAll("button")) {
      expect(button, button.textContent ?? "").toHaveProperty("disabled", true);
    }

    settle({ ok: true, data: makeLearner() });
    await awaitLoaded();

    // Same three controls, now live — nothing was swapped in or out.
    expect(footerLabels()).toEqual([
      "Transfer studentSoon",
      "Enroll as ARAL",
      "Edit",
    ]);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty(
      "disabled",
      false
    );
  });

  it("names the ARAL action from the roster's flag before the row lands", async () => {
    const settle = deferProfile();
    renderModal({ initialIsAralLearner: true });

    // An enrolled learner must not read "Enroll as ARAL" for a beat and flip.
    await waitFor(() => expect(aralActionLabel()).toBe("Remove from ARAL"));

    settle({ ok: true, data: makeLearner({ isAralLearner: true }) });
    await awaitLoaded();
    expect(aralActionLabel()).toBe("Remove from ARAL");
  });

  it("replaces Close with the three actions in one row", async () => {
    renderModal();
    await awaitLoaded();

    // "3 buttons in the same row", in the drawn order, sharing one footer.
    // The Soon badge abuts the label with no space, hence "studentSoon".
    expect(footerLabels()).toEqual([
      "Transfer studentSoon",
      "Enroll as ARAL",
      "Edit",
    ]);
    // The comp's single Close is gone from the footer. The header ✕ stays: it is
    // the only way to leave the dialog without acting.
    expect(within(footer()).queryByRole("button", { name: "Close" })).toBeNull();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" })
    ).not.toBeNull();
  });

  it("keeps Transfer disabled and says who owns it", async () => {
    renderModal();
    await awaitLoaded();
    const transfer = screen.getByRole("button", { name: /Transfer student/ });
    expect(transfer).toHaveProperty("disabled", true);
    expect(transfer.parentElement?.getAttribute("title")).toMatch(/School Head/);
  });

  it("edits in place instead of navigating to a page", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await awaitLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await awaitForm();

    // The old Edit closed the dialog and pushed to a route. Neither may happen.
    expect(onClose).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("asks who will tutor before it enrolls, instead of confirming blindly", async () => {
    renderModal();
    await awaitLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Enroll as ARAL" }));

    // Enrolment carries a decision — who tracks this learner's weekly progress —
    // so the footer opens the tutor picker rather than a confirm sheet, and
    // writes nothing until that picker is confirmed.
    const picker = await screen.findByRole("dialog", {
      name: "Enroll Ana Santos in ARAL",
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(listAralTutorOptions).toHaveBeenCalled();
    expect(enrollRosterLearnersToAral).not.toHaveBeenCalled();
    expect(toggleAralLearner).not.toHaveBeenCalled();

    // Defaulting to the teacher who pressed the button is the common case.
    const trigger = await waitFor(() => within(picker).getByRole("combobox"));
    expect(trigger.textContent).toContain("Myself");

    // The write re-reads the row, so the footer and the ARAL tab catch up in
    // place instead of waiting for the next visit.
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({
        isAralLearner: true,
        aralEnrolledAt: "2026-08-20",
        aralTutorName: "Marivic Reyes",
        aralTeacherId: "self",
      }),
    });
    fireEvent.click(within(picker).getByRole("button", { name: "Enroll" }));

    // Keeping the learner yourself sends no tutor at all — the action reads an
    // omitted designation as "whoever enrolled them".
    await waitFor(() =>
      expect(enrollRosterLearnersToAral).toHaveBeenCalledWith({
        learnerIds: ["learner-1"],
        aralTeacherId: undefined,
      })
    );
    await waitFor(() => expect(aralActionLabel()).toBe("Remove from ARAL"));
    expect(toastSuccess).toHaveBeenCalledWith("Enrolled 1 learner");
    expect(refresh).toHaveBeenCalled();
  });

  it("confirms a removal, then drops the tutor along with the enrolment", async () => {
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({
        isAralLearner: true,
        aralEnrolledAt: "2026-07-01",
        aralTutorName: "Grace Lim",
        aralTeacherId: "vol-9",
      }),
    });
    renderModal();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "ARAL Progress" }));
    expect(screen.getByText("Grace Lim")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove from ARAL" }));
    const alert = await screen.findByRole("alertdialog");
    // Confirming is what mutates — opening the sheet must not.
    expect(toggleAralLearner).not.toHaveBeenCalled();
    fireEvent.click(
      within(alert).getByRole("button", { name: "Remove from ARAL" })
    );

    await waitFor(() => expect(aralActionLabel()).toBe("Enroll as ARAL"));
    expect(toggleAralLearner).toHaveBeenCalledTimes(1);
    const fd = toggleAralLearner.mock.calls[0][0] as FormData;
    expect(fd.get("learnerId")).toBe("learner-1");
    expect(toastSuccess).toHaveBeenCalledWith("Removed from ARAL");
    expect(refresh).toHaveBeenCalled();
    // The action clears the designation on its way out, so the tab must not go
    // on printing a tutor for a learner who has left the program.
    expect(screen.queryByText("Grace Lim")).toBeNull();
  });

  it("offers removal, destructively, for a learner already in ARAL", async () => {
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({ isAralLearner: true, aralEnrolledAt: "2026-07-01" }),
    });
    renderModal();
    await awaitLoaded();
    expect(footerLabels()).toEqual([
      "Transfer studentSoon",
      "Transfer tutor",
      "Remove from ARAL",
      "Edit",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove from ARAL" }));

    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText("Remove Ana Santos from ARAL?")).not.toBeNull();
    expect(
      within(alert).getByRole("button", { name: "Remove from ARAL" })
    ).not.toBeNull();
    expect(within(alert).getByRole("button", { name: "Cancel" })).not.toBeNull();
  });

  it("surfaces a failed removal without claiming success", async () => {
    toggleAralLearner.mockResolvedValue({ ok: false, error: "Learner is archived" });
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({ isAralLearner: true, aralEnrolledAt: "2026-07-01" }),
    });
    renderModal();
    await awaitLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove from ARAL" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(alert).getByRole("button", { name: "Remove from ARAL" })
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Learner is archived")
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Nothing flipped, and the confirm sheet stays up for a retry.
    expect(aralActionLabel()).toBe("Remove from ARAL");
    expect(screen.getByRole("alertdialog")).not.toBeNull();
  });

  it("disables both writes for an archived learner", async () => {
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({ archivedAt: "2026-08-01" }),
    });
    renderModal();
    await awaitLoaded();

    expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByRole("button", { name: "Enroll as ARAL" })
    ).toHaveProperty("disabled", true);
  });

  it("gives Super Admin a read-only footer", async () => {
    const onClose = vi.fn();
    renderModal({ isSuperAdmin: true, onClose });
    await awaitLoaded();

    expect(footerLabels()).toEqual(["Close"]);
    fireEvent.click(within(footer()).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("LearnerProfileModal — Transfer tutor", () => {
  const enrolledUnder = (name: string | null, id: string | null) =>
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({
        isAralLearner: true,
        aralEnrolledAt: "2026-07-01",
        aralTutorName: name,
        aralTeacherId: id,
      }),
    });

  it("stands immediately right of Transfer student", async () => {
    enrolledUnder("Jun Dela Cruz", "vol-1");
    renderModal();
    await awaitLoaded();

    // The two belong together: both move a learner from one person's care to
    // another's, and a teacher hunting for either looks at the row of actions
    // rather than opening a tab.
    expect(footerLabels()).toEqual([
      "Transfer studentSoon",
      "Transfer tutor",
      "Remove from ARAL",
      "Edit",
    ]);
  });

  it("reassigns from the footer, starting on the current tutor", async () => {
    enrolledUnder("Jun Dela Cruz", "vol-1");
    renderModal();
    await awaitLoaded();

    fireEvent.click(
      within(footer()).getByRole("button", { name: "Transfer tutor" })
    );

    const picker = await screen.findByRole("dialog", {
      name: "Change Ana Santos's ARAL tutor",
    });
    // Not a second enrolment: the wording says so, and the picker opens on the
    // tutor the learner already has rather than resetting to the viewer.
    const trigger = await waitFor(() => within(picker).getByRole("combobox"));
    expect(trigger.textContent).toContain("Jun Dela Cruz");

    fireEvent.click(within(picker).getByRole("button", { name: "Save tutor" }));
    await waitFor(() =>
      expect(enrollRosterLearnersToAral).toHaveBeenCalledWith({
        learnerIds: ["learner-1"],
        aralTeacherId: "vol-1",
      })
    );
    // A completed change re-reads the row, the way the footer's writes do.
    await waitFor(() => expect(getLearnerProfile).toHaveBeenCalledTimes(2));
  });

  it("keeps the ARAL tab read-only, tutor included", async () => {
    enrolledUnder("Jun Dela Cruz", "vol-1");
    renderModal();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "ARAL Progress" }));

    // The tab still names the tutor — that is what it is for — but the control
    // that rewrites it left with the rest of the actions.
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Jun Dela Cruz")).not.toBeNull();
    expect(panel.queryAllByRole("button")).toHaveLength(0);
  });

  it("still offers the transfer when nobody holds the learner yet", async () => {
    enrolledUnder(null, null);
    renderModal();
    await awaitLoaded();

    // Enrolled but untutored is the row that needs this button most.
    fireEvent.click(
      within(footer()).getByRole("button", { name: "Transfer tutor" })
    );
    expect(
      await screen.findByRole("dialog", { name: "Change Ana Santos's ARAL tutor" })
    ).not.toBeNull();
  });

  it("offers nothing to transfer for a learner outside the program", async () => {
    renderModal();
    await awaitLoaded();

    // Enroll as ARAL already asks who will tutor, so a second control asking the
    // same question would be the same button twice.
    expect(screen.queryByRole("button", { name: "Transfer tutor" })).toBeNull();
  });

  it("gives Super Admin no way to change the tutor either", async () => {
    enrolledUnder("Jun Dela Cruz", "vol-1");
    renderModal({ isSuperAdmin: true });
    await awaitLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "ARAL Progress" }));

    // The tutor is still named — Super Admin reads the roster, and reading it is
    // the point — but the control that would rewrite it is not drawn.
    expect(screen.getByText("Jun Dela Cruz")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Transfer tutor" })).toBeNull();
  });

  it("disables the transfer for an archived learner", async () => {
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({
        isAralLearner: true,
        aralTutorName: "Jun Dela Cruz",
        aralTeacherId: "vol-1",
        archivedAt: "2026-08-01",
      }),
    });
    renderModal();
    await awaitLoaded();

    // Disabled rather than hidden, like every other write in this footer: the
    // action still belongs to this learner, it is the learner that is closed.
    expect(
      within(footer()).getByRole("button", { name: "Transfer tutor" })
    ).toHaveProperty("disabled", true);
  });
});

describe("LearnerProfileModal — edit mode", () => {
  it("swaps the tabs and the actions for the form, and renames the dialog", async () => {
    renderModal();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await awaitForm();

    // Nothing from the reading view survives into the form.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /Transfer student/ })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /ARAL/ })).toBeNull();
    // The heading has to say which mode this is, or the swap is silent.
    expect(screen.getByText("Edit learner")).not.toBeNull();
    expect(screen.queryByText("Student Profile")).toBeNull();
    expect(screen.getByText(/Update Ana Santos/)).not.toBeNull();
  });

  it("hands the form the learner's own values and their placement", async () => {
    renderModal();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await awaitForm();

    const props = formProps;
    expect(props).not.toBeNull();
    expect(props?.mode).toBe("edit");
    expect(props?.submitLabel).toBe("Save changes");
    expect(props?.gradeLevelId).toBe("grade-g3");
    expect(props?.gradeType).toBe("G3");
    // Where the learner sits is shown, not chosen — so the dialog owes the form
    // labels rather than the option lists it used to fetch.
    expect(props?.placement).toEqual({
      gradeLabel: "Grade 3",
      sectionName: "Sampaguita",
    });
    expect(props?.defaultValues?.id).toBe("learner-1");
    expect(props?.defaultValues?.firstName).toBe("Ana");
    expect(props?.defaultValues?.lastName).toBe("Santos");
    expect(props?.defaultValues?.parentEducation).toBe("COLLEGE_GRADUATE");
    // Placement is not a form field any more, so it must not arrive as one.
    expect(props?.defaultValues).not.toHaveProperty("sectionId");
  });

  it("returns to the profile on Cancel, without closing the dialog", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await awaitForm();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("tab", { name: "Profile" })).not.toBeNull();
    expect(screen.queryByText("learner form stub")).toBeNull();
    expect(footerLabels()).toEqual([
      "Transfer studentSoon",
      "Enroll as ARAL",
      "Edit",
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-reads the row after a save and lands back on the profile", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await awaitForm();

    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({ fullName: "Ana Cruz", lastName: "Cruz" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // `updateLearner` derives fullName and reconciles the enrollment pointers, so
    // the dialog re-reads rather than patching its own copy from the form.
    expect(await screen.findByText("Ana Cruz")).not.toBeNull();
    expect(getLearnerProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("tab", { name: "Profile" })).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reads nothing extra when Edit is pressed, however often", async () => {
    renderModal();
    await awaitLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await awaitForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("tab", { name: "Profile" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await awaitForm();

    // Edit used to fetch a section list before the form could draw. The profile
    // read carries the placement now, so pressing Edit is a mode flip and the
    // one read on open stays the only read.
    expect(getLearnerProfile).toHaveBeenCalledTimes(1);
  });
});

describe("LearnerProfileModal — edit-only host", () => {
  it("opens straight into the form, skipping the tabs", async () => {
    renderModal({ initialMode: "edit" });
    await awaitForm();

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("Edit learner")).not.toBeNull();
    expect(formProps?.placement?.sectionName).toBe("Sampaguita");
  });

  it("closes on Cancel, because there is no profile to fall back to", async () => {
    const onClose = vi.fn();
    renderModal({ initialMode: "edit", onClose });
    await awaitForm();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a completed save", async () => {
    const onClose = vi.fn();
    renderModal({ initialMode: "edit", onClose });
    await awaitForm();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The host page is already refreshed by the form; no second read here.
    expect(getLearnerProfile).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed profile read instead of waiting forever", async () => {
    getLearnerProfile.mockResolvedValue({ ok: false, error: "Not found" });
    renderModal({ initialMode: "edit" });

    // The profile read supplies every default, so its failure stops edit mode —
    // and must say so rather than leave the skeleton up.
    expect(await screen.findByText("Not found")).not.toBeNull();
    expect(screen.queryByText("learner form stub")).toBeNull();
    expect(
      within(footer()).getByRole("button", { name: "Close" })
    ).not.toBeNull();
  });
});
