import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuthApiError } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors/app-error";
import { classifyError } from "@/lib/errors/classify";

/**
 * The classifier is what stands between a raw Prisma or Supabase failure and
 * the sentence a teacher reads, so the cases that matter are the ones where the
 * right *advice* differs: retrying clears a pool timeout and can never clear a
 * stale schema.
 */

function prismaKnown(
  code: string,
  message = `\nInvalid \`prisma.user.update()\` invocation:\n\n${code} failure`
) {
  return Object.assign(new Error(message), {
    name: "PrismaClientKnownRequestError",
    code,
    clientVersion: "5.22.0",
  });
}

describe("classifyError", () => {
  it("passes an AppError through untouched", () => {
    const err = new AppError("AUTH_FORBIDDEN");
    expect(classifyError(err)).toBe(err);
  });

  it("turns a thrown ZodError into VALIDATION_FAILED", () => {
    const parsed = z.object({ name: z.string().min(1, "Name is required") }).safeParse({ name: "" });
    if (parsed.success) throw new Error("expected failure");
    const out = classifyError(parsed.error);
    expect(out.code).toBe("VALIDATION_FAILED");
    expect(out.message).toBe("Name is required");
  });

  it("maps Prisma failures by what retrying can do", () => {
    expect(classifyError(prismaKnown("P2024"), { verb: "save the section" }).message).toMatch(
      /^Couldn't save the section: the database didn't respond/
    );
    expect(classifyError(prismaKnown("P2022")).code).toBe("DB_SCHEMA_OUT_OF_DATE");
    expect(classifyError(prismaKnown("P2002")).code).toBe("DB_CONFLICT");
    expect(classifyError(prismaKnown("P2025")).code).toBe("NOT_FOUND");
    expect(classifyError(prismaKnown("P2003")).code).toBe("DB_ERROR");
  });

  it("keeps the Prisma code for admins but not in the user message", () => {
    const out = classifyError(prismaKnown("P2024"));
    expect(out.context.prismaCode).toBe("P2024");
    expect(out.message).not.toContain("P2024");
    expect(out.detail).toContain("P2024");
  });

  it("reads a Prisma query-shape error as our bug", () => {
    const err = Object.assign(new Error("Unknown argument `nmae`"), {
      name: "PrismaClientValidationError",
    });
    expect(classifyError(err).code).toBe("INTERNAL_ERROR");
  });

  it("reads a missing DATABASE_URL as missing configuration", () => {
    const err = Object.assign(new Error("error: Environment variable not found: DATABASE_URL."), {
      name: "PrismaClientInitializationError",
    });
    expect(classifyError(err).code).toBe("CONFIG_MISSING");
  });

  it("maps Supabase auth errors thrown on the server", () => {
    expect(
      classifyError(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")).code
    ).toBe("AUTH_PROVIDER_RATE_LIMITED");
    expect(
      classifyError(
        new AuthApiError("New password should be different from the old password.", 422, "same_password")
      ).code
    ).toBe("AUTH_PASSWORD_SAME");
  });

  it("calls anything else an internal error and keeps the cause", () => {
    const boom = new TypeError("Cannot read properties of undefined (reading 'id')");
    const out = classifyError(boom);
    expect(out.code).toBe("INTERNAL_ERROR");
    expect(out.cause).toBe(boom);
    expect(out.message).not.toContain("undefined");
  });
});
