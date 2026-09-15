import { describe, it, expect } from "vitest";
import {
  resolveInitialTheme,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isAlwaysLightPath,
  shouldApplyDark,
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

describe("always-light sign-in screens", () => {
  it("matches the two sign-in pages, with or without a trailing slash", () => {
    expect(isAlwaysLightPath("/login")).toBe(true);
    expect(isAlwaysLightPath("/login/")).toBe(true);
    expect(isAlwaysLightPath("/admin/login")).toBe(true);
  });

  it("leaves every other page to the stored theme", () => {
    expect(isAlwaysLightPath("/")).toBe(false);
    expect(isAlwaysLightPath("/teacher")).toBe(false);
    expect(isAlwaysLightPath("/login-help")).toBe(false);
    expect(isAlwaysLightPath(null)).toBe(false);
  });

  it("applies dark only for a dark theme off the sign-in pages", () => {
    expect(shouldApplyDark("dark", "/teacher")).toBe(true);
    expect(shouldApplyDark("dark", "/login")).toBe(false);
    expect(shouldApplyDark("light", "/teacher")).toBe(false);
  });
});
