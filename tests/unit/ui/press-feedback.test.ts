// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PRESS_SCALE, rippleSize, showSaved, springValues } from "@/lib/ui/press-feedback";

describe("springValues", () => {
  const values = springValues(PRESS_SCALE, 1);

  it("starts at the pressed scale and ends exactly at rest", () => {
    expect(values[0]).toBeCloseTo(PRESS_SCALE, 5);
    expect(values.at(-1)).toBe(1);
  });

  it("springs past full size once, by a small amount, then settles", () => {
    const peak = Math.max(...values);
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.03);
    // The tail is calm: the last few frames sit within 0.3% of rest.
    for (const v of values.slice(-4)) expect(Math.abs(v - 1)).toBeLessThan(0.003);
  });
});

describe("rippleSize", () => {
  it("reaches the farthest corner from the press point", () => {
    expect(rippleSize({ width: 200, height: 40 }, 0, 0)).toBeCloseTo(2 * Math.hypot(200, 40));
    expect(rippleSize({ width: 200, height: 40 }, 100, 20)).toBeCloseTo(2 * Math.hypot(100, 20));
  });
});

describe("showSaved", () => {
  it("draws the ring and tick with a Saved label over the button, keeping its width", () => {
    const button = document.createElement("button");
    button.textContent = "Save changes";
    document.body.appendChild(button);

    const overlay = showSaved(button);

    expect(button.hasAttribute("data-press-saved-on")).toBe(true);
    expect(button.textContent).toContain("Save changes");
    expect(overlay.querySelector(".press-saved-ring")).not.toBeNull();
    expect(overlay.querySelector(".press-saved-tick")).not.toBeNull();
    expect(overlay.textContent).toBe("Saved");
  });

  it("replaces an earlier overlay instead of stacking", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    showSaved(button);
    showSaved(button);
    expect(button.querySelectorAll("[data-press-saved]")).toHaveLength(1);
  });
});
