import { describe, expect, it } from "vitest";
import {
  authErrorCode,
  isAuthApiError,
  loginFailureReasonFor,
  mapAuthError,
} from "@/lib/errors/auth-provider";
import { ERRORS } from "@/lib/errors/codes";
import { classifyError } from "@/lib/errors/classify";

/**
 * Telling apart the things a failed sign-in can mean: the password was wrong,
 * the auth layer refused to check it, or something of ours broke. Collapsing
 * the last two into "incorrect password" is what sent schools off resetting
 * passwords that were never wrong.
 */

/** Shape of better-call's APIError: name, numeric statusCode, body.code. */
function apiError(statusCode: number, code?: string, message = "refused") {
  return Object.assign(new Error(message), { name: "APIError", statusCode, body: { code, message } });
}

describe("isAuthApiError / authErrorCode", () => {
  it("recognizes the structural APIError shape and nothing else", () => {
    expect(isAuthApiError(apiError(401, "X"))).toBe(true);
    expect(isAuthApiError(new Error("boom"))).toBe(false);
    expect(isAuthApiError({ name: "APIError" })).toBe(false);
    expect(isAuthApiError(null)).toBe(false);
    expect(isAuthApiError("APIError")).toBe(false);
  });

  it("reads the machine code, or null", () => {
    expect(authErrorCode(apiError(401, "INVALID_PASSWORD"))).toBe("INVALID_PASSWORD");
    expect(authErrorCode(apiError(401))).toBeNull();
    expect(authErrorCode(new Error("x"))).toBeNull();
  });
});

describe("mapAuthError", () => {
  it("reads a wrong email or password as a wrong password", () => {
    for (const code of ["INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "CREDENTIAL_ACCOUNT_NOT_FOUND"]) {
      expect(mapAuthError(apiError(401, code))).toBe("AUTH_INCORRECT_PASSWORD");
    }
  });

  it("never reads a rate limit as a wrong password", () => {
    expect(mapAuthError(apiError(429, undefined, "Too many requests"))).toBe(
      "AUTH_PROVIDER_RATE_LIMITED"
    );
  });

  it("names account and email refusals", () => {
    expect(mapAuthError(apiError(422, "USER_ALREADY_EXISTS"))).toBe("AUTH_EMAIL_IN_USE");
    expect(mapAuthError(apiError(400, "INVALID_EMAIL"))).toBe("AUTH_EMAIL_REJECTED");
    expect(mapAuthError(apiError(400, "PASSWORD_TOO_SHORT"))).toBe("AUTH_PASSWORD_WEAK");
    expect(mapAuthError(apiError(400, "EMAIL_PASSWORD_SIGN_UP_DISABLED"))).toBe("AUTH_SIGNUPS_DISABLED");
    expect(mapAuthError(apiError(403, "BANNED_USER"))).toBe("AUTH_ACCOUNT_DISABLED");
    expect(mapAuthError(apiError(403, "YOU_CANNOT_IMPERSONATE_ADMINS"))).toBe("AUTH_FORBIDDEN");
  });

  it("reads a bare 401 as an expired session", () => {
    expect(mapAuthError(apiError(401))).toBe("AUTH_SESSION_EXPIRED");
  });

  it("reads FAILED_TO_GET_SESSION 401 as an ended session, but 500 as our own failure", () => {
    // getSession answers 401 for a session that is gone, and 500 when reading
    // it crashed (database down). Only the first is the person's problem.
    expect(mapAuthError(apiError(401, "FAILED_TO_GET_SESSION"))).toBe("AUTH_SESSION_EXPIRED");
    const crash = mapAuthError(apiError(500, "FAILED_TO_GET_SESSION"));
    expect(crash).not.toBe("AUTH_SESSION_EXPIRED");
    expect(crash).toBe("AUTH_PROVIDER_ERROR");
    expect(ERRORS[crash].severity).not.toBe("user");
  });

  it("classifyError records a getSession crash (500) and does not blame the person's session", () => {
    const crash = classifyError(apiError(500, "FAILED_TO_GET_SESSION"));
    expect(crash.code).not.toBe("AUTH_SESSION_EXPIRED");
    expect(crash.severity).toBe("system");
    expect(crash.context).toMatchObject({ authCode: "FAILED_TO_GET_SESSION", authStatus: 500 });

    const gone = classifyError(apiError(401, "FAILED_TO_GET_SESSION"));
    expect(gone.code).toBe("AUTH_SESSION_EXPIRED");
    expect(gone.severity).toBe("user");
  });

  it("does not guess: an unrecognized failure is a provider error", () => {
    expect(mapAuthError(apiError(500, "SOMETHING_NEW"))).toBe("AUTH_PROVIDER_ERROR");
    expect(mapAuthError(apiError(400))).toBe("AUTH_PROVIDER_ERROR");
    expect(mapAuthError(new Error("socket hang up"))).toBe("AUTH_PROVIDER_ERROR");
    expect(mapAuthError(null)).toBe("AUTH_PROVIDER_ERROR");
  });

  it("does not let an inherited property name pass as a known code", () => {
    expect(mapAuthError(apiError(400, "constructor"))).toBe("AUTH_PROVIDER_ERROR");
    expect(mapAuthError(apiError(400, "__proto__"))).toBe("AUTH_PROVIDER_ERROR");
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
