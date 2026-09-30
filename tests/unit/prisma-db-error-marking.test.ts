import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { createPrismaClient, markTransactionFailures, withDbErrorMarking } from "@/lib/prisma";
import { isMarkedDbError } from "@/lib/db-errors";
import { classifyError } from "@/lib/errors/classify";

/**
 * Every query failure leaving the app's Prisma client carries the provenance
 * mark, and an outage carries a `DBU-` digest — the only thing a production
 * page render passes to the browser. These run the real Prisma 6 runtime; only
 * the driver adapter underneath is faked (or pointed at a closed port).
 */

const DBU = /^DBU-[0-9A-HJKMNP-TV-Z]{8}$/;

/** What @prisma/adapter-pg throws for a SQLSTATE without a dedicated kind. */
function adminShutdown() {
  return Object.assign(new Error("terminating connection due to administrator command"), {
    name: "DriverAdapterError",
    cause: {
      kind: "postgres",
      code: "57P01",
      severity: "FATAL",
      message: "terminating connection due to administrator command",
      originalCode: "57P01",
      originalMessage: "terminating connection due to administrator command",
    },
  });
}

/** A driver adapter whose every SELECT fails like a database mid-shutdown. */
function shuttingDownAdapter() {
  const queryable = {
    provider: "postgres" as const,
    adapterName: "@prisma/adapter-pg",
    queryRaw: async () => {
      throw adminShutdown();
    },
    executeRaw: async () => 0,
  };
  const transaction = {
    ...queryable,
    options: { usePhantomQuery: false },
    commit: async () => {},
    rollback: async () => {},
  };
  return {
    provider: "postgres" as const,
    adapterName: "@prisma/adapter-pg",
    connect: async () => ({
      ...queryable,
      executeScript: async () => {},
      startTransaction: async () => transaction,
      getConnectionInfo: () => ({ supportsRelationJoins: true }),
      dispose: async () => {},
    }),
  };
}

function markedClient() {
  return withDbErrorMarking(new PrismaClient({ adapter: shuttingDownAdapter() as never }));
}

async function rejection(promise: PromiseLike<unknown>): Promise<Error & { digest?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as Error & { digest?: string };
  }
  throw new Error("expected the query to fail");
}

describe("withDbErrorMarking on the real Prisma runtime", () => {
  it("marks a model query that fails with a raw DriverAdapterError", async () => {
    const err = await rejection(markedClient().user.findFirst());
    expect(err.name).toBe("DriverAdapterError");
    expect(isMarkedDbError(err)).toBe(true);
    expect(err.digest).toMatch(DBU);
    expect(classifyError(err).code).toBe("DB_UNAVAILABLE");
  });

  it("marks a raw query (P2010) through the same hook", async () => {
    const err = await rejection(markedClient().$queryRaw`SELECT 1`);
    expect((err as { code?: string }).code).toBe("P2010");
    expect(isMarkedDbError(err)).toBe(true);
    expect(err.digest).toMatch(DBU);
  });

  it("marks a query inside an interactive transaction", async () => {
    const err = await rejection(markedClient().$transaction((tx) => tx.user.findFirst()));
    expect(isMarkedDbError(err)).toBe(true);
    expect(err.digest).toMatch(DBU);
  });

  it("marks a failing batch transaction", async () => {
    const client = markedClient();
    const err = await rejection(client.$transaction([client.user.findFirst()]));
    expect(isMarkedDbError(err)).toBe(true);
    expect(err.digest).toMatch(DBU);
  });

  it("keeps the exported client's adapter configuration reachable", async () => {
    const client = createPrismaClient("postgresql://postgres:password@localhost:5432/litrack");
    const engine = client as unknown as { _engineConfig: { adapter?: { config?: { maxUses?: number } } } };
    expect(engine._engineConfig.adapter?.config?.maxUses).toBe(1);
    await client.$disconnect();
  });

  it(
    "marks a connection refused by the real pg adapter (P1001)",
    async () => {
      const client = createPrismaClient("postgresql://nobody:nothing@127.0.0.1:1/none");
      const err = await rejection(client.user.findFirst());
      expect((err as { code?: string }).code).toBe("P1001");
      expect(err.digest).toMatch(DBU);
      await client.$disconnect();
    },
    30_000,
  );
});

describe("markTransactionFailures", () => {
  it("marks a failure to open or commit the transaction", async () => {
    const startFailure = new Error("timeout exceeded when trying to connect");
    const run = markTransactionFailures(async () => {
      throw startFailure;
    });
    const err = await rejection(run(async () => "never"));
    expect(err).toBe(startFailure);
    expect(isMarkedDbError(err)).toBe(true);
    expect(err.digest).toMatch(DBU);
  });

  it("leaves an error the callback threw untouched", async () => {
    const mine = new Error("Connection terminated unexpectedly");
    const run = markTransactionFailures(async (callback, _options) =>
      (callback as (tx: unknown) => Promise<unknown>)({})
    );
    const err = await rejection(run(async () => {
      throw mine;
    }));
    expect(err).toBe(mine);
    expect(isMarkedDbError(err)).toBe(false);
    expect(err.digest).toBeUndefined();
  });

  it("passes the callback's result and the options through", async () => {
    let seenOptions: unknown;
    const run = markTransactionFailures(async (callback, options) => {
      seenOptions = options;
      return (callback as (tx: unknown) => Promise<unknown>)("tx");
    });
    await expect(run(async (tx: unknown) => `got ${String(tx)}`, { timeout: 5 })).resolves.toBe("got tx");
    expect(seenOptions).toEqual({ timeout: 5 });
  });
});
