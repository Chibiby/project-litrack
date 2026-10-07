import { describe, expect, it } from "vitest";
import { formatMessage } from "@/lib/errors/codes";
import { loginFailureReasonFor, mapAuthError } from "@/lib/errors/auth-provider";

/**
 * What the login form says after the server's Better Auth password check fails.
 *
 * The server action hands the Better Auth error to `mapAuthError` and returns
 * the catalog message for the resulting code, so these cases pin the same
 * decision without rendering anything.
 *
 * Better Auth only answers with a refusal when it actually checked (or
 * refused to check) the password; anything that is not one of its APIErrors is
 * our infrastructure, never "wrong password". A request that never arrived is
 * the browser's NETWORK_OFFLINE / SERVER_UNREACHABLE, covered in
 * login-form-failures.test.tsx.
 */

/** Shape of better-call's APIError: name, numeric statusCode, body.code. */
function apiError(statusCode: number, code?: string, message = "refused") {
  return Object.assign(new Error(message), { name: "APIError", statusCode, body: { code, message } });
}

const WRONG_PASSWORD = apiError(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password");
const RATE_LIMITED = apiError(429, undefined, "Too many requests. Please try again later.");
const CRASHED = new TypeError("fetch failed");

describe("sign-in failures", () => {
  it("says the password is wrong only when it was actually checked", () => {
    const code = mapAuthError(WRONG_PASSWORD);
    expect(code).toBe("AUTH_INCORRECT_PASSWORD");
    expect(formatMessage(code)).toBe("Incorrect password. Check it and try again.");
  });

  it("never blames the password for something that is not a Better Auth refusal", () => {
    const code = mapAuthError(CRASHED);
    expect(code).toBe("AUTH_PROVIDER_ERROR");
    expect(formatMessage(code)).not.toMatch(/incorrect password/i);
  });

  it("blames the connection, not the password, when the sign-in service cannot be reached", () => {
    const message = formatMessage("AUTH_SERVICE_UNREACHABLE");
    expect(message).toMatch(/internet connection/i);
    expect(message).not.toMatch(/password/i);
  });

  it("tells someone rate-limited not to reset a password that is fine", () => {
    const code = mapAuthError(RATE_LIMITED);
    expect(code).toBe("AUTH_PROVIDER_RATE_LIMITED");
    expect(formatMessage(code)).toMatch(/no need to reset/i);
  });

  it("records each cause under its own audit reason", () => {
    expect(loginFailureReasonFor(mapAuthError(WRONG_PASSWORD))).toBe("incorrect_credentials");
    expect(loginFailureReasonFor(mapAuthError(RATE_LIMITED))).toBe("rate_limited");
    expect(loginFailureReasonFor("AUTH_SERVICE_UNREACHABLE")).toBe("service_unreachable");
    expect(loginFailureReasonFor(mapAuthError(CRASHED))).toBe("provider_error");
  });
});
