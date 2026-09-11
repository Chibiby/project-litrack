import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The action wrapper.
 *
 * The case that matters most is the one that looks like an edge case: Next's
 * `redirect()` and `notFound()` work by THROWING, and `requireUser` uses both.
 * A wrapper that caught them would turn every successful sign-in into a silent
 * failure, and no other test in this repo would notice.
 */

const reportError = vi.fn(() => "E-TESTREF1");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

import { notFound, redirect } from "next/navigation";
import { action } from "@/lib/errors/action";
import { AppError, fieldError } from "@/lib/errors/app-error";
import { currentErrorScope } from "@/lib/errors/context";

beforeEach(() => {
  vi.clearAllMocks();
  reportError.mockReturnValue("E-TESTREF1");
});

describe("action()", () => {
  it("returns what the body returns when nothing goes wrong", async () => {
    const run = action("ok", async (n: number) => ({ ok: true as const, data: n * 2 }));
    await expect(run(21)).resolves.toEqual({ ok: true, data: 42 });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("turns an AppError into the house failure shape", async () => {
    const run = action("wrong", async () => {
      throw new AppError("AUTH_INCORRECT_PASSWORD");
    });
    await expect(run()).resolves.toEqual({
      ok: false,
      code: "AUTH_INCORRECT_PASSWORD",
      error: "Incorrect password. Check it and try again.",
    });
  });

  it("does not record an expected mistake", async () => {
    const run = action("invalid", async () => {
      throw fieldError("email", "Email is required");
    });
    const res = await run();
    expect(res).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      fieldErrors: { email: "Email is required" },
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("records a refusal but gives the person no reference", async () => {
    const run = action("denied", async () => {
      throw new AppError("AUTH_FORBIDDEN");
    });
    const res = await run();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(res).not.toHaveProperty("ref");
  });

  it("records an unexpected failure and hands back a reference", async () => {
    const run = action(
      "boom",
      async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'id')");
      },
      { verb: "save the section" }
    );
    const res = await run();
    expect(res).toMatchObject({ ok: false, code: "INTERNAL_ERROR", ref: "E-TESTREF1" });
    expect((res as { error: string }).error).toContain("Reference: E-TESTREF1");
    expect((res as { error: string }).error).not.toContain("undefined");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("uses the verb for database failures", async () => {
    const run = action(
      "db",
      async () => {
        throw Object.assign(new Error("pool timeout"), {
          name: "PrismaClientKnownRequestError",
          code: "P2024",
        });
      },
      { verb: "save the section" }
    );
    const res = await run();
    expect((res as { error: string }).error).toMatch(
      /^Couldn't save the section: the database didn't respond/
    );
  });

  it("lets Next's redirect through untouched", async () => {
    const run = action("redirects", async () => {
      redirect("/teacher");
    });
    await expect(run()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("lets Next's notFound() through untouched", async () => {
    const run = action("missing", async () => {
      notFound();
    });
    await expect(run()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK"),
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("opens a scope named after the action", async () => {
    let seen: string | undefined;
    const run = action("namedAction", async () => {
      seen = currentErrorScope()?.route;
      return { ok: true as const };
    });
    await run();
    expect(seen).toBe("namedAction");
  });
});
