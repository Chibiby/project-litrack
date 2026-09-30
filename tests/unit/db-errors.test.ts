import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDbFailure,
  describeDbFailure,
  isMarkedDbError,
  markDbError,
} from "@/lib/db-errors";
import { classifyError } from "@/lib/errors/classify";

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

/** `@prisma/driver-adapter-utils`' DriverAdapterError shape: no `.code`, details on `.cause`. */
function driverAdapterError(cause: Record<string, unknown>, message = "db error") {
  return Object.assign(new Error(message), { name: "DriverAdapterError", cause });
}

describe("classifyDbFailure — what the client engine actually surfaces", () => {
  it("reads the P-codes Prisma maps adapter outages to as temporary", () => {
    for (const code of ["P2037", "P1011"]) {
      expect(classifyDbFailure(prismaError(code))).toBe("UNAVAILABLE");
    }
  });

  it("reads a transaction timeout as temporary but a misused transaction as unknown", () => {
    expect(
      classifyDbFailure(prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time.")),
    ).toBe("UNAVAILABLE");
    expect(
      classifyDbFailure(
        prismaError("P2028", "Transaction API error: A query cannot be executed on an expired transaction."),
      ),
    ).toBe("UNAVAILABLE");
    expect(
      classifyDbFailure(prismaError("P2028", "Transaction API error: Transaction not found.")),
    ).toBe("UNKNOWN");
  });

  it("reads credential and target problems as configuration", () => {
    for (const code of ["P1000", "P1003", "P1010"]) {
      expect(classifyDbFailure(prismaError(code))).toBe("CONFIG");
    }
    expect(classifyDbFailure(driverAdapterError({ kind: "AuthenticationFailed" }))).toBe("CONFIG");
  });

  it("reads adapter kinds and SQLSTATEs on a raw DriverAdapterError", () => {
    for (const kind of ["DatabaseNotReachable", "ConnectionClosed", "SocketTimeout", "TooManyConnections", "TlsConnectionError"]) {
      expect(classifyDbFailure(driverAdapterError({ kind }))).toBe("UNAVAILABLE");
    }
    for (const sqlState of ["08006", "53300", "57P01", "57P02", "57P03", "57014"]) {
      expect(
        classifyDbFailure(driverAdapterError({ kind: "postgres", code: sqlState, originalCode: sqlState })),
      ).toBe("UNAVAILABLE");
    }
    for (const kind of ["TableDoesNotExist", "ColumnNotFound"]) {
      expect(classifyDbFailure(driverAdapterError({ kind }))).toBe("SCHEMA_OUT_OF_DATE");
    }
  });

  it("reads 22P02 as a stale schema only for an enum value, never for a bad uuid", () => {
    expect(
      classifyDbFailure(
        driverAdapterError({
          kind: "postgres",
          originalCode: "22P02",
          originalMessage: 'invalid input value for enum "Role": "X"',
        }),
      ),
    ).toBe("SCHEMA_OUT_OF_DATE");
    expect(
      classifyDbFailure(
        driverAdapterError({
          kind: "postgres",
          originalCode: "22P02",
          originalMessage: 'invalid input syntax for type uuid: "abc"',
        }),
      ),
    ).toBe("UNKNOWN");
  });

  it("does not let a uuid value that spells 'does not exist' pass as schema drift", () => {
    const text = 'invalid input syntax for type uuid: "does not exist"';
    const err = driverAdapterError(
      { kind: "postgres", originalCode: "22P02", originalMessage: text },
      text,
    );
    expect(classifyDbFailure(err)).toBe("UNKNOWN");
    expect(classifyError(err).code).not.toBe("DB_SCHEMA_OUT_OF_DATE");
    expect((markDbError(err) as { digest?: string }).digest).toBeUndefined();
  });

  it("reads the real cause of a failed raw query (P2010) from meta", () => {
    const rawFailure = Object.assign(prismaError("P2010", "Raw query failed. Code: `53300`."), {
      meta: {
        driverAdapterError: driverAdapterError({ kind: "TooManyConnections", cause: "sorry" }),
      },
    });
    expect(classifyDbFailure(rawFailure)).toBe("UNAVAILABLE");
  });

  it("reads pooler (XX000) overload text on a database error as temporary", () => {
    expect(
      classifyDbFailure(
        driverAdapterError(
          { kind: "postgres", originalCode: "XX000", originalMessage: "Max client connections reached" },
          "Max client connections reached",
        ),
      ),
    ).toBe("UNAVAILABLE");
  });

  it("matches outage text only on errors known to come from the database", () => {
    for (const text of [
      "Connection terminated unexpectedly",
      "timeout exceeded when trying to connect",
      "Network connection lost.",
    ]) {
      expect(classifyDbFailure(new Error(text))).toBe("UNKNOWN");
      expect(classifyDbFailure(markDbError(new Error(text)))).toBe("UNAVAILABLE");
    }
  });
});

describe("markDbError", () => {
  it("gives an outage a DBU- digest and a stale schema a DBS- digest", () => {
    const outage = markDbError(prismaError("P1017", "Server has closed the connection."));
    const schema = markDbError(prismaError("P2022", 'column "employmentType" does not exist'));

    expect((outage as { digest?: string }).digest).toMatch(/^DBU-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect((schema as { digest?: string }).digest).toMatch(/^DBS-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(isMarkedDbError(outage)).toBe(true);
  });

  it("stamps the digest once and never overwrites one already there", () => {
    const err = markDbError(prismaError("P1001", "Can't reach database server"));
    const first = (err as { digest?: string }).digest;
    markDbError(err);
    expect((err as { digest?: string }).digest).toBe(first);

    const nextOwned = Object.assign(prismaError("P1001"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    markDbError(nextOwned);
    expect(nextOwned.digest).toBe("NEXT_REDIRECT;replace;/login;307;");
  });

  it("marks but gives no digest to a failure that is neither an outage nor a stale schema", () => {
    const unique = markDbError(prismaError("P2002", "Unique constraint failed on the fields: (`email`)"));
    expect("digest" in unique).toBe(false);
    expect(isMarkedDbError(unique)).toBe(true);
  });

  it("keeps the mark non-enumerable and puts no error text in the digest", () => {
    const err = markDbError(
      new Error('Connection terminated unexpectedly while reading "Learner" deadbeef'),
    ) as Error & { digest?: string };
    expect(Object.keys(err)).toEqual(["digest"]);
    expect(err.digest).not.toMatch(/Learner|deadbeef|terminated/i);
  });

  it("returns the same object, and passes non-objects through", () => {
    const err = new Error("x");
    expect(markDbError(err)).toBe(err);
    expect(markDbError("text")).toBe("text");
    expect(markDbError(undefined)).toBeUndefined();
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
