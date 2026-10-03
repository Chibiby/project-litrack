// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BandSelect } from "@/components/forms/aral-monthly-reading-level-grid-form";

const options = [
  { value: "FRUSTRATION", code: "F", label: "Frustration", tone: "bg-red-50" },
  { value: "INSTRUCTIONAL", code: "I", label: "Instructional", tone: "bg-amber-50" },
];

describe("BandSelect accessibility", () => {
  it("keeps the 'needs update' name for a legacy value", () => {
    render(
      <BandSelect
        options={options}
        value="OLD"
        label="Reading level"
        onChange={vi.fn()}
        legacy={{ value: "OLD", code: "O", label: "Old band", tone: "bg-muted" }}
      />
    );
    expect(screen.getByRole("button", { name: "Reading level — needs update" })).toBeTruthy();
  });

  it("names a normal value '<label>: <level>' and toggles aria-expanded on open", () => {
    render(
      <BandSelect options={options} value="INSTRUCTIONAL" label="Reading level" onChange={vi.fn()} />
    );
    const trigger = screen.getByRole("button", { name: "Reading level: Instructional" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
