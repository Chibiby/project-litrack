import { describe, expect, it } from "vitest";
import { loginFailureReasonFor, mapSupabaseAuthError } from "@/lib/errors/supabase";

/**
 * Telling apart the three things a failed password grant can mean: the password
 * was wrong, the auth server refused to check it, or the request never arrived.
 * Collapsing the last two into "incorrect password" is what sent schools off
 * resetting passwords that were never wrong.
 */

describe("mapSupabaseAuthError", () => {
  it("reads a wrong password as a wrong password", () => {
    expect(
      mapSupabaseAuthError(
        { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
        "browser"
      )
    ).toBe("AUTH_INCORRECT_PASSWORD");
    expect(mapSupabaseAuthError({ status: 400, message: "Invalid login credentials" }, "server")).toBe(
      "AUTH_INCORRECT_PASSWORD"
    );
  });

  it("never reads a rate limit as a wrong password", () => {
    expect(mapSupabaseAuthError({ status: 429, message: "Request rate limit reached" }, "browser")).toBe(
      "AUTH_PROVIDER_RATE_LIMITED"
    );
  });

  it("separates a network failure from a wrong password", () => {
    const fetchFailure = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };
    expect(mapSupabaseAuthError(fetchFailure, "browser")).toBe("AUTH_SERVICE_UNREACHABLE");
    expect(mapSupabaseAuthError(fetchFailure, "server")).toBe("AUTH_PROVIDER_ERROR");
    expect(mapSupabaseAuthError({ status: 503, message: "upstream" }, "browser")).toBe(
      "AUTH_SERVICE_UNREACHABLE"
    );
  });

  it("names the password-policy refusals", () => {
    expect(mapSupabaseAuthError({ status: 422, code: "same_password" }, "server")).toBe(
      "AUTH_PASSWORD_SAME"
    );
    expect(mapSupabaseAuthError({ status: 422, code: "weak_password" }, "server")).toBe(
      "AUTH_PASSWORD_WEAK"
    );
  });

  it("names account and email refusals", () => {
    expect(mapSupabaseAuthError({ code: "signup_disabled" }, "server")).toBe("AUTH_SIGNUPS_DISABLED");
    expect(mapSupabaseAuthError({ code: "email_address_invalid" }, "server")).toBe(
      "AUTH_EMAIL_REJECTED"
    );
    expect(mapSupabaseAuthError({ code: "email_exists" }, "server")).toBe("AUTH_EMAIL_IN_USE");
    expect(
      mapSupabaseAuthError(
        { message: "A user with this email address has already been registered" },
        "server"
      )
    ).toBe("AUTH_EMAIL_IN_USE");
    expect(mapSupabaseAuthError({ message: "Error sending recovery email" }, "server")).toBe(
      "AUTH_EMAIL_SEND_FAILED"
    );
    expect(mapSupabaseAuthError({ code: "session_not_found" }, "server")).toBe("AUTH_SESSION_EXPIRED");
  });

  it("does not guess: an unrecognized failure is a provider error", () => {
    expect(
      mapSupabaseAuthError({ status: 400, message: "Something new happened after the upgrade" }, "server")
    ).toBe("AUTH_PROVIDER_ERROR");
    expect(mapSupabaseAuthError(null, "browser")).toBe("AUTH_PROVIDER_ERROR");
  });
});

describe("loginFailureReasonFor", () => {
  it("keeps the audit reason strings the diagnose script reads", () => {
    expect(loginFailureReasonFor("AUTH_INCORRECT_PASSWORD")).toBe("incorrect_credentials");
    expect(loginFailureReasonFor("AUTH_PROVIDER_RATE_LIMITED")).toBe("rate_limited");
    expect(loginFailureReasonFor("AUTH_SERVICE_UNREACHABLE")).toBe("service_unreachable");
    expect(loginFailureReasonFor("AUTH_PROVIDER_ERROR")).toBe("provider_error");
  });
});
