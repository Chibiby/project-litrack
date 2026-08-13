import { describe, it, expect } from "vitest";
import {
  resolveInitialTheme,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("resolveInitialTheme", () => {
  it("defaults to light when nothing is stored, even on a dark-preferring OS", () => {
    expect(resolveInitialTheme(null)).toBe("light");
  });

  it("honours a stored dark choice", () => {
    expect(resolveInitialTheme("dark")).toBe("dark");
  });

  it("honours a stored light choice", () => {
    expect(resolveInitialTheme("light")).toBe("light");
  });

  it("falls back to the default on a corrupt value", () => {
    expect(resolveInitialTheme("solarized")).toBe("light");
    expect(resolveInitialTheme("")).toBe("light");
  });

  it("exposes stable constants", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(THEME_STORAGE_KEY).toBe("litrack.theme");
  });
});
