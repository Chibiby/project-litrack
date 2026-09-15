import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  AralTutorCombobox,
  type AralTutorOption,
} from "@/components/aral/aral-tutor-combobox";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const SELF_ID = "self-1";

const TUTORS: AralTutorOption[] = [
  {
    id: "t1",
    name: "Maria Bañas",
    advisoryLabel: "Grade 5 · Narra",
    employmentType: "DEPED_PLANTILLA",
  },
  {
    id: "t2",
    name: "Jose Cruz",
    advisoryLabel: null,
    employmentType: "NON_DEPED",
  },
];

function open() {
  fireEvent.click(screen.getByRole("combobox"));
}

describe("AralTutorCombobox", () => {
  it("lists Myself first, followed by other tutors", () => {
    render(
      <AralTutorCombobox
        tutors={TUTORS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={() => {}}
      />
    );
    open();
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("Myself");
    expect(options[1].textContent).toContain("Maria Bañas");
    expect(options[2].textContent).toContain("Jose Cruz");
  });

  it("filters by name and sublabel, diacritic-insensitively, and keeps Myself", () => {
    render(
      <AralTutorCombobox
        tutors={TUTORS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={() => {}}
      />
    );
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "banas" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Myself");
    expect(options[1].textContent).toContain("Maria Bañas");
  });

  it("filters by advisory sublabel", () => {
    render(
      <AralTutorCombobox
        tutors={TUTORS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={() => {}}
      />
    );
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "narra" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1].textContent).toContain("Maria Bañas");
  });

  it("shows an empty state when nothing matches, but still keeps Myself", () => {
    render(
      <AralTutorCombobox
        tutors={TUTORS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={() => {}}
      />
    );
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzz" } });
    expect(screen.getByText("No tutor found")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Myself");
  });

  it("selects a tutor on click and updates the trigger label", () => {
    const onValueChange = vi.fn();
    render(
      <AralTutorCombobox
        tutors={TUTORS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={onValueChange}
      />
    );
    open();
    fireEvent.click(screen.getByText("Jose Cruz"));
    expect(onValueChange).toHaveBeenCalledWith("t2");
  });

  it("is keyboard accessible: arrow down then Enter selects", () => {
    const onValueChange = vi.fn();
    render(
      <AralTutorCombobox
        tutors={TUTORS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={onValueChange}
      />
    );
    open();
    const search = screen.getByRole("textbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("t1");
  });
});
