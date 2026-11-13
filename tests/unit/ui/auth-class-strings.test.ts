import { describe, expect, it } from "vitest";
import * as authCard from "@/components/auth/auth-card";

/**
 * A missing space between two Tailwind classes silently drops both
 * ("bg-card/45[.login-glass_&…]:bg-none" is one unknown class), which once
 * turned the disabled glass Next button back to violet. Guard every exported
 * class string.
 */
const classStrings = Object.entries(authCard).filter(
  (entry): entry is [string, string] => typeof entry[1] === "string",
);

describe("auth-card class strings", () => {
  it("exports class strings to check", () => {
    expect(classStrings.length).toBeGreaterThan(3);
  });

  it.each(classStrings)("%s has no two classes fused together", (_name, value) => {
    for (const token of value.split(/\s+/)) {
      // A variant bracket may only open a class, never follow other text.
      expect(token, token).not.toMatch(/[\w/)\]]\[\./);
    }
  });
});
