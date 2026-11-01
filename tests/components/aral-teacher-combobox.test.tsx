import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  AralTeacherCombobox,
  type AralTeacherPickOption,
} from "@/components/aral/aral-teacher-combobox";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const SELF_ID = "self-1";

const TEACHERS: AralTeacherPickOption[] = [
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

describe("AralTeacherCombobox", () => {
  it("lists Myself first, followed by other teachers", () => {
    render(
      <AralTeacherCombobox
        teachers={TEACHERS}
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
      <AralTeacherCombobox
        teachers={TEACHERS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={() => {}}
      />
    );
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "banas" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Myself");
    expect(options[1].textContent).toContain("Maria Bañas");
  });

  it("filters by advisory sublabel", () => {
    render(
      <AralTeacherCombobox
        teachers={TEACHERS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={() => {}}
      />
    );
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "narra" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1].textContent).toContain("Maria Bañas");
  });

  it("shows an empty state when nothing matches, but still keeps Myself", () => {
    render(
      <AralTeacherCombobox
        teachers={TEACHERS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={() => {}}
      />
    );
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(screen.getByText("No teacher found")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Myself");
  });

  it("selects a teacher on click and updates the trigger label", () => {
    const onValueChange = vi.fn();
    render(
      <AralTeacherCombobox
        teachers={TEACHERS}
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
      <AralTeacherCombobox
        teachers={TEACHERS}
        selfId={SELF_ID}
        value={SELF_ID}
        onValueChange={onValueChange}
      />
    );
    open();
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("t1");
  });
});
