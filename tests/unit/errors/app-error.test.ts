import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, fieldError, resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { toFailure } from "@/lib/errors/result";
import { parseInput, validationError } from "@/lib/errors/validation";

describe("AppError", () => {
  it("carries the catalog status and severity and a user-safe message", () => {
    const err = new AppError("DB_UNAVAILABLE", {
      detail: "P2024 pool timeout on User.findUnique",
    });
    expect(err.status).toBe(503);
    expect(err.severity).toBe("system");
    expect(err.message).not.toContain("P2024");
    expect(String(err)).not.toContain("pool timeout");
    expect(err.detail).toContain("P2024");
  });

  it("lets a throw override severity", () => {
    expect(new AppError("NOT_FOUND").severity).toBe("user");
    expect(new AppError("NOT_FOUND", { severity: "security" }).severity).toBe("security");
  });

  it("keeps the cause for admins", () => {
    const cause = new Error("boom");
    expect(new AppError("INTERNAL_ERROR", { cause }).cause).toBe(cause);
  });
});

describe("resourceNotFound", () => {
  it("gives a missing row and another school's row the same message", () => {
    const missing = resourceNotFound("Learner");
    const foreign = resourceNotFound("Learner", {
      crossTenant: true,
      detail: "belongs to school-b",
    });
    expect(missing.message).toBe(foreign.message);
    expect(missing.severity).toBe("user");
    expect(foreign.severity).toBe("security");
    expect(foreign.context.crossTenant).toBe(true);
  });
});

describe("tooManyAttempts", () => {
  it("states the wait and exposes Retry-After seconds", () => {
    const err = tooManyAttempts(3 * 60_000 + 1);
    expect(err.code).toBe("AUTH_TOO_MANY_ATTEMPTS");
    expect(err.message).toBe("Too many attempts. Try again in 4 minutes.");
    expect(err.context.retryAfterSeconds).toBe(181);
    expect(tooManyAttempts(1000, "RATE_LIMITED").code).toBe("RATE_LIMITED");
  });
});

describe("validation", () => {
  const schema = z.object({ email: z.string().min(1, "Email is required"), age: z.number() });

  it("uses the first issue as the message and maps each field", () => {
    const parsed = schema.safeParse({ email: "", age: "x" });
    if (parsed.success) throw new Error("expected failure");
    const err = validationError(parsed.error);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toBe("Email is required");
    expect(err.fieldErrors).toMatchObject({ email: "Email is required" });
    expect(Object.keys(err.fieldErrors ?? {})).toContain("age");
  });

  it("parseInput returns data or throws VALIDATION_FAILED", () => {
    expect(parseInput(schema, { email: "a", age: 1 })).toEqual({ email: "a", age: 1 });
    expect(() => parseInput(schema, {})).toThrow(AppError);
  });

  it("fieldError names one field", () => {
    const err = fieldError("schoolId", "Please select a school");
    expect(err.message).toBe("Please select a school");
    expect(err.fieldErrors).toEqual({ schoolId: "Please select a school" });
  });
});

describe("toFailure", () => {
  it("returns the house result shape", () => {
    expect(toFailure(new AppError("AUTH_INCORRECT_PASSWORD"))).toEqual({
      ok: false,
      code: "AUTH_INCORRECT_PASSWORD",
      error: "Incorrect password. Check it and try again.",
    });
  });

  it("puts the reference in both the message and its own field", () => {
    const f = toFailure(new AppError("INTERNAL_ERROR"), "E-7K2P9QXM");
    expect(f.ref).toBe("E-7K2P9QXM");
    expect(f.error.endsWith("Reference: E-7K2P9QXM")).toBe(true);
  });

  it("includes field errors for validation", () => {
    expect(toFailure(fieldError("email", "Email is required")).fieldErrors).toEqual({
      email: "Email is required",
    });
  });
});
