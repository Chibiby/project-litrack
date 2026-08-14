import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SegmentedBar,
  SegmentLegend,
  percentOf,
  type BarSegment,
} from "@/components/ui/segmented-bar";

afterEach(cleanup);

const segments: BarSegment[] = [
  { label: "Present", value: 18, className: "bg-emerald-500", dotClassName: "bg-emerald-500" },
  { label: "Absent", value: 6, className: "bg-amber-500", dotClassName: "bg-amber-500" },
  { label: "No Class", value: 0, className: "bg-muted", dotClassName: "bg-muted" },
];

describe("percentOf", () => {
  it("rounds to whole percent", () => {
    expect(percentOf(18, 24)).toBe(75);
    expect(percentOf(1, 3)).toBe(33);
  });

  it("returns 0 for an empty total instead of NaN", () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("SegmentedBar", () => {
  it("renders one sized segment per non-zero value and skips zeroes", () => {
    const { container } = render(<SegmentedBar segments={segments} />);
    const parts = container.querySelectorAll("[data-segment]");
    expect(parts).toHaveLength(2);
    expect((parts[0] as HTMLElement).style.width).toBe("75%");
    expect((parts[1] as HTMLElement).style.width).toBe("25%");
  });

  it("exposes a text summary for screen readers", () => {
    render(<SegmentedBar segments={segments} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Present 18 (75%), Absent 6 (25%), No Class 0 (0%)"
    );
  });

  it("renders an empty track when every value is zero", () => {
    const { container } = render(
      <SegmentedBar segments={segments.map((s) => ({ ...s, value: 0 }))} />
    );
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(0);
  });
});

describe("SegmentLegend", () => {
  it("shows label, count and percent for every segment including zeroes", () => {
    render(<SegmentLegend segments={segments} total={24} />);
    expect(screen.getByText("Present")).not.toBeNull();
    expect(screen.getByText("18 (75%)")).not.toBeNull();
    expect(screen.getByText("0 (0%)")).not.toBeNull();
  });
});
