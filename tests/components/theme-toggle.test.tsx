import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(cleanup);

function setup() {
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
  return screen.getByRole("button", { name: /switch to (dark|light) mode/i });
}

describe("ThemeToggle", () => {
  it("offers dark mode while light is active", () => {
    const btn = setup();
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark mode");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to dark on click and relabels itself", () => {
    const btn = setup();
    act(() => btn.click());
    expect(btn.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("switches back to light", () => {
    const btn = setup();
    act(() => btn.click());
    act(() => btn.click());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
