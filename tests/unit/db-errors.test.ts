import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyDbFailure, describeDbFailure } from "@/lib/db-errors";

/**
 * What is under contract here is the *advice*, not the wording.
 *
 * A database whose schema is behind the committed migrations rejects the same
 * write forever, so telling that teacher to try again sends them into a loop
 * that cannot succeed. A pool timeout is the opposite — retrying is the only
 * thing that helps. These tests pin that the two never get each other's advice,
 * and that neither ever carries raw Postgres text into production output.
 */

afterEach(() => {
  // `devDetail` reads NODE_ENV at call time, so tests that flip it must put it back.
  vi.unstubAllEnvs();
});

/** Prisma-shaped error: a code on the object, message alongside. */
function prismaError(code: string, message = "boom") {
  return Object.assign(new Error(message), { code });
}

describe("classifyDbFailure", () => {
  it("reads a missing table, column, or un-relaxed NOT NULL as a stale schema", () => {
    for (const code of ["P2021", "P2022", "P2011"]) {
      expect(classifyDbFailure(prismaError(code))).toBe("SCHEMA_OUT_OF_DATE");
    }
  });

  it("reads connection and pool failures as temporary", () => {
    for (const code of ["P2024", "P1001", "P1002", "P1008", "P1017"]) {
      expect(classifyDbFailure(prismaError(code))).toBe("UNAVAILABLE");
    }
  });

  it("recognizes the Postgres SQLSTATEs Prisma only reports inside the message", () => {
    // The exact failure that broke first-time profiling: an enum value the
    // deployed type does not have yet because its migration was never applied.
    expect(
      classifyDbFailure(new Error('invalid input value for enum "Specialization": "NA"')),
    ).toBe("SCHEMA_OUT_OF_DATE");

    expect(
      classifyDbFailure(
        new Error('null value in column "mostSubjectHandled" violates not-null constraint'),
      ),
    ).toBe("SCHEMA_OUT_OF_DATE");

    expect(classifyDbFailure(new Error('column "employmentType" does not exist'))).toBe(
      "SCHEMA_OUT_OF_DATE",
    );

    expect(classifyDbFailure(new Error('relation "Notification" does not exist'))).toBe(
      "SCHEMA_OUT_OF_DATE",
    );

    // Bare SQLSTATE, which is sometimes all that survives.
    expect(classifyDbFailure(new Error("db error: 42P01"))).toBe("SCHEMA_OUT_OF_DATE");
  });

  it("does not guess at failures it has no signature for", () => {
    expect(classifyDbFailure(prismaError("P2002", "Unique constraint failed"))).toBe(
      "UNKNOWN",
    );
    expect(classifyDbFailure(new Error('prepared statement "s3" already exists'))).toBe(
      "UNKNOWN",
    );
    expect(classifyDbFailure(undefined)).toBe("UNKNOWN");
    expect(classifyDbFailure("a bare string")).toBe("UNKNOWN");
    expect(classifyDbFailure({ code: 42 })).toBe("UNKNOWN");
  });
});

describe("describeDbFailure", () => {
  it("tells the teacher retrying will NOT help when the schema is behind", () => {
    vi.stubEnv("NODE_ENV", "production");
    const message = describeDbFailure(prismaError("P2022"), {
      action: "save your profile",
    });

    expect(message).toContain("save your profile");
    expect(message).toMatch(/won't help/i);
    expect(message).toContain("DB-SCHEMA");
    // The advice the other branches give, which this branch must never give.
    expect(message).not.toMatch(/wait a few seconds/i);
  });

  it("tells the teacher retrying IS the fix when the database is merely busy", () => {
    vi.stubEnv("NODE_ENV", "production");
    const message = describeDbFailure(prismaError("P2024"), {
      action: "save your profile",
    });

    expect(message).toMatch(/try again/i);
    expect(message).toContain("DB-BUSY");
    expect(message).not.toMatch(/won't help/i);
  });

  it("reassures and offers a reference for a failure it cannot classify", () => {
    vi.stubEnv("NODE_ENV", "production");
    const message = describeDbFailure(prismaError("P2002"), {
      action: "save your profile",
    });

    expect(message).toMatch(/try again/i);
    expect(message).toContain("DB-UNKNOWN");
    expect(message).toMatch(/nothing you typed has been lost/i);
  });

  it("never carries raw database text into a production message", () => {
    vi.stubEnv("NODE_ENV", "production");
    const message = describeDbFailure(
      Object.assign(
        new Error(
          'column "TeacherProfile.employmentType" does not exist at Section.id = deadbeef',
        ),
        { code: "P2022" },
      ),
      { action: "save your profile" },
    );

    expect(message).not.toContain("employmentType");
    expect(message).not.toContain("deadbeef");
    expect(message).not.toContain("P2022");
  });

  it("appends the raw detail outside production, where the reader is the developer", () => {
    vi.stubEnv("NODE_ENV", "development");
    const message = describeDbFailure(
      Object.assign(new Error('column "employmentType" does not exist'), {
        code: "P2022",
      }),
      { action: "save your profile" },
    );

    expect(message).toContain("[dev:");
    expect(message).toContain("P2022");
    expect(message).toContain("employmentType");
    // The actionable half is still there — the detail is an addition, not a swap.
    expect(message).toMatch(/won't help/i);
  });

  it("keeps the dev detail to one line and a bounded length", () => {
    vi.stubEnv("NODE_ENV", "development");
    const message = describeDbFailure(
      new Error(`first line: ${"x".repeat(500)}\nsecond line should not appear`),
      { action: "save your profile" },
    );

    expect(message).not.toContain("second line");
    const detail = message.slice(message.indexOf("[dev:"));
    expect(detail.length).toBeLessThan(320);
  });
});
