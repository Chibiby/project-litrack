import { describe, it, expect } from "vitest";
import { isAuthRateLimitError, AUTH_RATE_LIMITED_MESSAGE } from "@/lib/auth/auth-errors";

/**
 * These cases are the shapes Supabase actually returned during the Salimama /
 * Kawas investigation, plus the shapes supabase-js is documented to produce.
 * The whole point of the helper is that a 429 must never be reported as a wrong
 * password, so the negative cases matter as much as the positive ones.
 */
describe("isAuthRateLimitError", () => {
  it("matches the HTTP 429 status supabase-js puts on AuthApiError", () => {
    expect(isAuthRateLimitError({ status: 429, message: "Request rate limit reached" })).toBe(true);
  });

  it("matches the machine-readable error code", () => {
    expect(isAuthRateLimitError({ code: "over_request_rate_limit" })).toBe(true);
    expect(isAuthRateLimitError({ error_code: "over_email_send_rate_limit" })).toBe(true);
  });

  it("matches the human message when neither status nor code is present", () => {
    expect(isAuthRateLimitError({ message: "Request rate limit reached" })).toBe(true);
    expect(isAuthRateLimitError({ message: "Too many requests" })).toBe(true);
  });

  it("does not match a genuinely wrong password", () => {
    expect(isAuthRateLimitError({ status: 400, message: "Invalid login credentials" })).toBe(false);
  });

  it("does not match other auth failures", () => {
    expect(isAuthRateLimitError({ status: 400, message: "Email not confirmed" })).toBe(false);
    expect(isAuthRateLimitError({ status: 403, message: "User banned" })).toBe(false);
  });

  it("tolerates the absent and non-object cases", () => {
    expect(isAuthRateLimitError(null)).toBe(false);
    expect(isAuthRateLimitError(undefined)).toBe(false);
    expect(isAuthRateLimitError("rate limit")).toBe(false);
    expect(isAuthRateLimitError({})).toBe(false);
  });

  it("tells the person their password is not the problem", () => {
    // The sentence is the fix for the reported symptom — admins reset passwords
    // for hours because the message pointed at the credential.
    expect(AUTH_RATE_LIMITED_MESSAGE).toMatch(/no need to reset/i);
  });
});
