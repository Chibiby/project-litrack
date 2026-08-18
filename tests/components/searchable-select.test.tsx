import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const OPTIONS: SearchableOption[] = [
  { value: "a", label: "Alabel Central ES", hint: "Alabel 1" },
  { value: "b", label: "Banlibato Integrated School", hint: "Alabel 1" },
  { value: "c", label: "Glan Central ES", hint: "Glan 1" },
];

function open() {
  fireEvent.click(screen.getByRole("combobox"));
}

describe("SearchableSelect", () => {
  it("exposes combobox semantics on the trigger", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} placeholder="Select your school" />);
    const trigger = screen.getByRole("combobox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.textContent).toContain("Select your school");
  });

  it("shows the selected label instead of the placeholder", () => {
    render(<SearchableSelect options={OPTIONS} value="c" onValueChange={() => {}} placeholder="Select your school" />);
    expect(screen.getByRole("combobox").textContent).toContain("Glan Central ES");
  });

  it("filters as the user types", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} />);
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "glan" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("Glan Central ES");
  });

  it("tracks the active option with aria-activedescendant rather than DOM focus", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} id="school" />);
    open();
    const search = screen.getByRole("textbox");
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-0");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-1");
    expect(document.activeElement).toBe(search);
  });

  it("does not move past the last option", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} id="school" />);
    open();
    const search = screen.getByRole("textbox");
    for (let i = 0; i < 8; i++) fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-2");
    fireEvent.keyDown(search, { key: "Home" });
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-0");
  });

  it("selects the active option on Enter", () => {
    const onValueChange = vi.fn();
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={onValueChange} />);
    open();
    const search = screen.getByRole("textbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("selects on click", () => {
    const onValueChange = vi.fn();
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={onValueChange} />);
    open();
    fireEvent.click(screen.getByText("Glan Central ES"));
    expect(onValueChange).toHaveBeenCalledWith("c");
  });

  it("shows the empty message when nothing matches", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} emptyMessage="No schools found." />);
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzz" } });
    expect(screen.getByText("No schools found.")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("marks the selected option with aria-selected", () => {
    render(<SearchableSelect options={OPTIONS} value="a" onValueChange={() => {}} />);
    open();
    const options = screen.getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
  });
});
