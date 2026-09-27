import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { School } from "lucide-react";
import { CompactPageHeader } from "@/components/shell/page-hero";

afterEach(cleanup);

describe("CompactPageHeader", () => {
  it("renders eyebrow, H1 and a one-line description with no illustration", () => {
    render(
      <CompactPageHeader
        eyebrow="Your schools"
        eyebrowIcon={School}
        title="Schools"
        subtitle="Open a school to edit its details."
        meta="Maitum 2 · 17 schools"
      />
    );
    expect(screen.getByText("Your schools")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Schools" })).toBeTruthy();
    expect(screen.getByText(/Open a school to edit its details\..*Maitum 2 · 17 schools/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("omits the eyebrow line when none is given", () => {
    render(<CompactPageHeader title="Settings" subtitle="Update your name and photo." />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
