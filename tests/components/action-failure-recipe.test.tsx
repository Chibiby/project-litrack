import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMessage } from "@/lib/errors/codes";
import type { SheetGroup } from "@/lib/terms/sheet-data";

/**
 * A server action that rejects instead of returning (dropped connection): the
 * form keeps what was typed, one clear message replaces the loading toast, and
 * the button becomes usable again.
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
  unstable_isUnrecognizedActionError: () => false,
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: { children: React.ReactNode; href: string; prefetch?: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  }),
}));

vi.mock("@/components/nav-prefetcher", () => ({ invalidateNavWarm: vi.fn() }));

const createLearner = vi.fn();
vi.mock("@/lib/actions/learner", () => ({
  createLearner: (fd: FormData) => createLearner(fd),
  updateLearner: vi.fn(),
}));

const saveTermGrades = vi.fn();
vi.mock("@/lib/actions/term-grades", () => ({
  saveTermGrades: (input: unknown) => saveTermGrades(input),
  exportTermGrades: vi.fn(),
}));

import { LearnerForm } from "@/components/forms/learner-form";
import { TermsReportPanel } from "@/components/terms/terms-report-panel";

const UNREACHABLE = formatMessage("SERVER_UNREACHABLE");

function failedFetch(): TypeError {
  return new TypeError("Failed to fetch");
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("LearnerForm create when the request never returns a result", () => {
  it("replaces the loading toast, keeps the typed name, and re-enables Save", async () => {
    createLearner.mockRejectedValue(failedFetch());
    const { container } = render(<LearnerForm gradeLevelId="g1" gradeType="G4" />);

    const first = container.querySelector<HTMLInputElement>('input[name="firstName"]')!;
    fireEvent.change(first, { target: { value: "Juan" } });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[name="lastName"]')!, {
      target: { value: "Cruz" },
    });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[name="age"]')!, {
      target: { value: "9" },
    });
    for (const name of [
      "gender",
      "nutritionalStatus",
      "englishReadingProfile",
      "filipinoReadingProfile",
      "parentEducation",
    ]) {
      fireEvent.click(container.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"]`)!);
    }

    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => expect(createLearner).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        UNREACHABLE,
        expect.objectContaining({ id: "toast-id" })
      )
    );
    expect(container.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe("Juan");
    await waitFor(() => expect(submit.disabled).toBe(false));
  });
});

describe("TermsReportPanel save when the request never returns a result", () => {
  it("shows the message once in place of the loading toast and lets the teacher retry", async () => {
    saveTermGrades.mockRejectedValue(failedFetch());
    const groups: SheetGroup[] = [
      {
        key: "atis",
        gradeLevelId: "g3",
        gradeType: "G3",
        sectionId: "atis",
        label: "Grade 3 - Atis",
        subjects: [{ id: "g3-math", name: "Mathematics" }],
        learners: [{ id: "ana", fullName: "Ana Abad", sectionLabel: "3 - Atis" }],
        initialGrades: [],
        indexOffset: 0,
      },
    ];
    render(
      <TermsReportPanel
        basePath="/teacher/terms-reports"
        state={{ advisory: null, section: "all", term: "FIRST", q: "", pageSize: 10 }}
        sections={[{ id: "atis", name: "Atis" }]}
        groups={groups}
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
    const [table] = screen.getAllByRole("table");
    fireEvent.change(within(table).getByLabelText("Ana Abad — Mathematics grade"), {
      target: { value: "90" },
    });
    const save = screen.getAllByRole("button", { name: /save/i })[0] as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(UNREACHABLE, expect.objectContaining({ id: "toast-id" }))
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(
      (within(table).getByLabelText("Ana Abad — Mathematics grade") as HTMLInputElement).value
    ).toBe("90");
  });
});
