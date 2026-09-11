import { describe, expect, it } from "vitest";
import { formatMessage } from "@/lib/errors/codes";
import { loginFailureReasonFor, mapSupabaseAuthError } from "@/lib/errors/supabase";

/**
 * What the login form says after the browser's own password grant fails.
 *
 * The component hands the error to `mapSupabaseAuthError(err, "browser")` and
 * shows the catalog message for the resulting code, so these cases pin the same
 * decision the form makes without rendering it.
 *
 * The browser is the only place that can tell a refusal from a request that
 * never arrived — the server sees nothing either way — which is why the offline
 * case below matters most.
 */

const WRONG_PASSWORD = {
  status: 400,
  code: "invalid_credentials",
  message: "Invalid login credentials",
};
const RATE_LIMITED = { status: 429, message: "Request rate limit reached" };
const OFFLINE = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };

describe("browser sign-in failures", () => {
  it("says the password is wrong only when it was actually checked", () => {
    const code = mapSupabaseAuthError(WRONG_PASSWORD, "browser");
    expect(code).toBe("AUTH_INCORRECT_PASSWORD");
    expect(formatMessage(code)).toBe("Incorrect password. Check it and try again.");
  });

  it("blames the connection when the request never arrived", () => {
    const code = mapSupabaseAuthError(OFFLINE, "browser");
    expect(code).toBe("AUTH_SERVICE_UNREACHABLE");
    expect(formatMessage(code)).toMatch(/internet connection/i);
    expect(formatMessage(code)).not.toMatch(/password/i);
  });

  it("tells someone rate-limited not to reset a password that is fine", () => {
    const code = mapSupabaseAuthError(RATE_LIMITED, "browser");
    expect(formatMessage(code)).toMatch(/no need to reset/i);
  });

  it("records each cause under its own audit reason", () => {
    expect(loginFailureReasonFor(mapSupabaseAuthError(WRONG_PASSWORD, "browser"))).toBe(
      "incorrect_credentials"
    );
    expect(loginFailureReasonFor(mapSupabaseAuthError(RATE_LIMITED, "browser"))).toBe(
      "rate_limited"
    );
    expect(loginFailureReasonFor(mapSupabaseAuthError(OFFLINE, "browser"))).toBe(
      "service_unreachable"
    );
  });
});
