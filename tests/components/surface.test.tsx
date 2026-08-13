import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";

afterEach(cleanup);

describe("Surface", () => {
  it("renders the shared card chrome from tokens only", () => {
    render(<Surface data-testid="s">content</Surface>);
    const el = screen.getByTestId("s");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("bg-card");
    expect(el.className).toContain("border-border/80");
    expect(el.className).toContain("rounded-xl");
    // Hardcoded colors would break dark mode.
    expect(el.className).not.toContain("bg-white");
  });

  it("renders as the requested element", () => {
    render(<Surface as="section" data-testid="s">x</Surface>);
    expect(screen.getByTestId("s").tagName).toBe("SECTION");
  });

  it("merges caller classes over defaults", () => {
    render(<Surface className="p-0" data-testid="s">x</Surface>);
    expect(screen.getByTestId("s").className).toContain("p-0");
  });

  it("renders header and body slots", () => {
    render(
      <Surface>
        <SurfaceHeader data-testid="h">Title</SurfaceHeader>
        <SurfaceBody data-testid="b">Body</SurfaceBody>
      </Surface>
    );
    expect(screen.getByTestId("h").className).toContain("border-b");
    expect(screen.getByTestId("b").className).toContain("p-5");
  });
});
