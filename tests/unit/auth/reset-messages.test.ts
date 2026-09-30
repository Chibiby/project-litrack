import { describe, expect, it } from "vitest";
import {
  RESET_LINK_INVALID_MESSAGE,
  resetErrorMessage,
} from "@/lib/auth/reset-messages";

describe("resetErrorMessage", () => {
  it("returns null when the URL carries no error", () => {
    expect(resetErrorMessage({})).toBeNull();
    expect(resetErrorMessage({ error: "", error_description: "  " })).toBeNull();
  });

  it("maps an expired one-time code to the expired sentence", () => {
    expect(resetErrorMessage({ error: "access_denied", error_code: "otp_expired" })).toMatch(
      /expired or was already used/i
    );
  });

  it("gives the generic sentence for access_denied and the verify route's text", () => {
    expect(resetErrorMessage({ error: "access_denied" })).toBe(RESET_LINK_INVALID_MESSAGE);
    expect(resetErrorMessage({ error: RESET_LINK_INVALID_MESSAGE })).toBe(
      RESET_LINK_INVALID_MESSAGE
    );
  });

  it("never reflects URL text, whatever it says", () => {
    const attack = "<script>alert(1)</script> Call 0917 000 0000 to verify";
    for (const params of [
      { error: attack },
      { error_description: attack },
      { error: attack, error_code: attack, error_description: attack },
      { error_description: [attack, "b"] },
    ]) {
      const out = resetErrorMessage(params);
      expect(out).toBe(RESET_LINK_INVALID_MESSAGE);
      expect(out).not.toContain("script");
      expect(out).not.toContain("0917");
    }
  });
});
