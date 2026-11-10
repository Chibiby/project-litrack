import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { withDbErrorMarking } from "@/lib/prisma";

/**
 * The retry wiring on the real Prisma 6 runtime; only the driver adapter is
 * faked. Each test counts how many times SQL reached the "database".
 */

function driverError(message: string) {
  return Object.assign(new Error(message), {
    name: "DriverAdapterError",
    cause: { kind: "GenericJs", id: 1, message, originalMessage: message },
  });
}

/** Fails the first `failures` SQL calls (and/or connects) with `message`. */
function flakyAdapter(opts: { queryFailures?: number; connectFailures?: number; message: string }) {
  const counts = { sql: 0, connects: 0 };
  let queryFailures = opts.queryFailures ?? 0;
  let connectFailures = opts.connectFailures ?? 0;
  const run = async () => {
    counts.sql += 1;
    if (queryFailures > 0) {
      queryFailures -= 1;
      throw driverError(opts.message);
    }
    return { columnNames: [], columnTypes: [], rows: [] };
  };
  const queryable = {
    provider: "postgres" as const,
    adapterName: "@prisma/adapter-pg",
    queryRaw: run,
    executeRaw: async (query: { sql: string }) => {
      // Prisma rolls a failed transaction back through here; not app SQL.
      if (/^s*(?:BEGIN|COMMIT|ROLLBACK)/i.test(query.sql)) return 1;
      await run();
      return 1;
    },
  };
  const transaction = {
    ...queryable,
    options: { usePhantomQuery: false },
    commit: async () => {},
    rollback: async () => {},
  };
  const adapter = {
    provider: "postgres" as const,
    adapterName: "@prisma/adapter-pg",
    connect: async () => ({
      ...queryable,
      executeScript: async () => {},
      startTransaction: async () => {
        counts.connects += 1;
        if (connectFailures > 0) {
          connectFailures -= 1;
          throw driverError("timeout exceeded when trying to connect");
        }
        return transaction;
      },
      getConnectionInfo: () => ({ supportsRelationJoins: true }),
      dispose: async () => {},
    }),
  };
  return { client: withDbErrorMarking(new PrismaClient({ adapter: adapter as never })), counts };
}

describe("database retries on the real Prisma runtime", () => {
  it("quietly retries a read whose connection stalled", async () => {
    const { client, counts } = flakyAdapter({ queryFailures: 1, message: "Query read timeout" });
    await expect(client.user.findFirst()).resolves.toBeNull();
    expect(counts.sql).toBe(2);
  });

  it("retries any query whose connection could not be opened", async () => {
    const { client, counts } = flakyAdapter({
      queryFailures: 1,
      message: "timeout exceeded when trying to connect",
    });
    await expect(client.user.deleteMany({ where: { id: "nope" } })).resolves.toBeDefined();
    expect(counts.sql).toBe(2);
  });

  it("never repeats a write that stalled", async () => {
    const { client, counts } = flakyAdapter({ queryFailures: 1, message: "Query read timeout" });
    await expect(client.user.deleteMany({ where: { id: "nope" } })).rejects.toThrow();
    expect(counts.sql).toBe(1);
  });

  it("never repeats a stalled read inside a transaction", async () => {
    const { client, counts } = flakyAdapter({ queryFailures: 1, message: "Query read timeout" });
    await expect(client.$transaction((tx) => tx.user.findFirst())).rejects.toThrow();
    expect(counts.sql).toBe(1);
  });

  it("retries a transaction that could not start", async () => {
    const { client, counts } = flakyAdapter({ connectFailures: 1, message: "unused" });
    await expect(client.$transaction((tx) => tx.user.findFirst())).resolves.toBeNull();
    expect(counts.connects).toBe(2);
  });
});
