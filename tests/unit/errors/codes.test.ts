import { describe, expect, it } from "vitest";
import {
  ERRORS,
  formatMessage,
  formatWait,
  isErrorCode,
  withReference,
  type ErrorCode,
} from "@/lib/errors/codes";

/**
 * The catalog is the only place a user-facing sentence is allowed to live, so
 * these are repo invariants rather than examples: every code must be complete,
 * every placeholder must resolve, and no message may name our infrastructure.
 */

const CODES = Object.keys(ERRORS) as ErrorCode[];
const INTERNAL_WORDS =
  /prisma|supabase|postgres|\bsql\b|vercel|database_url|env var|stack|undefined|null\b|\.tsx?\b/i;

describe("error catalog", () => {
  it("gives every code a status, a severity and a message", () => {
    for (const code of CODES) {
      const def = ERRORS[code];
      expect(def.status, code).toBeGreaterThanOrEqual(400);
      expect(["user", "security", "system"], code).toContain(def.severity);
      // Measured after substitution: VALIDATION_FAILED's template is the bare
      // passthrough "{message}", and what matters is the sentence a person reads.
      expect(formatMessage(code).length, code).toBeGreaterThan(10);
    }
  });

  it("fills every placeholder even when no params are passed", () => {
    for (const code of CODES) {
      const text = formatMessage(code);
      expect(text, code).not.toMatch(/[{}]/);
      expect(text.trim(), code).toBe(text);
    }
  });

  it("never names internals in a message a person reads", () => {
    for (const code of CODES) {
      expect(ERRORS[code].message, code).not.toMatch(INTERNAL_WORDS);
    }
  });

  it("uses AREA_REASON upper snake case for every code", () => {
    for (const code of CODES) expect(code).toMatch(/^[A-Z]+(?:_[A-Z]+)+$/);
  });

  it("substitutes params", () => {
    expect(formatMessage("NOT_FOUND", { resource: "Learner" })).toBe(
      "Learner not found. It may have been deleted or moved."
    );
    expect(formatMessage("AUTH_TOO_MANY_ATTEMPTS", { wait: "4 minutes" })).toBe(
      "Too many attempts. Try again in 4 minutes."
    );
  });

  it("keeps the wording existing callers and tests rely on", () => {
    expect(formatMessage("AUTH_REGISTRATION_DECLINED")).toBe(
      "Your registration was declined. Contact your School Head."
    );
    expect(formatMessage("AUTH_ACCOUNT_DEACTIVATED")).toBe(
      "Your account has been deactivated. Contact your School Head."
    );
    expect(formatMessage("AUTH_TEACHER_PENDING")).toBe(
      "Your request is pending School Head approval."
    );
    expect(formatMessage("AUTH_PROVIDER_RATE_LIMITED")).toMatch(/no need to reset/i);
  });

  it("appends a reference only when there is one", () => {
    expect(withReference("Couldn't save.", "E-ABCD1234")).toBe(
      "Couldn't save. Reference: E-ABCD1234"
    );
    expect(withReference("Couldn't save.", undefined)).toBe("Couldn't save.");
  });

  it("says how long to wait in whole minutes, never zero", () => {
    expect(formatWait(0)).toBe("1 minute");
    expect(formatWait(59_000)).toBe("1 minute");
    expect(formatWait(61_000)).toBe("2 minutes");
    expect(formatWait(4 * 60_000)).toBe("4 minutes");
  });

  it("recognizes only real codes", () => {
    expect(isErrorCode("NOT_FOUND")).toBe(true);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode("__proto__")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});
