import { describe, expect, it, vi } from "vitest";

import {
  BREAKER_COOLDOWN_MS,
  BREAKER_THRESHOLD,
  CircuitBreaker,
  MAX_CONNECT_RETRIES,
  RETRY_TIME_BUDGET_MS,
  failurePhase,
  withDbRetry,
} from "@/lib/db/retry";

const connectError = () => new Error("timeout exceeded when trying to connect");
const stallError = () => new Error("Query read timeout");

function deps(overrides: { now?: () => number } = {}) {
  return {
    breaker: new CircuitBreaker(overrides.now),
    sleep: vi.fn(async () => {}),
    random: () => 0.5,
    ...overrides,
  };
}

/** Fails `times` times with `make()`, then resolves "ok". */
function flaky(times: number, make: () => Error) {
  let calls = 0;
  const attempt = vi.fn(async () => {
    calls += 1;
    if (calls <= times) throw make();
    return "ok";
  });
  return attempt;
}

describe("failurePhase", () => {
  it("separates failures before SQL was sent from stalls mid-query", () => {
    expect(failurePhase(connectError())).toBe("connect");
    expect(failurePhase(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe("connect");
    expect(failurePhase(stallError())).toBe("stall");
    expect(failurePhase(new Error("Connection terminated unexpectedly"))).toBe("stall");
    expect(failurePhase(new Error("Unique constraint failed"))).toBeNull();
  });

  it("reads the driver error Prisma nests in meta", () => {
    const prismaError = Object.assign(new Error("Invalid `prisma.learner.findMany()`"), {
      meta: { driverAdapterError: { cause: { originalMessage: "Query read timeout" } } },
    });
    expect(failurePhase(prismaError)).toBe("stall");
  });
});

describe("withDbRetry", () => {
  it("recovers from a failed connection without the caller seeing it", async () => {
    const attempt = flaky(2, connectError);
    const d = deps();
    await expect(withDbRetry(attempt, { operation: "update", inTransaction: false }, d)).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("stops after the retry cap and rethrows the original error", async () => {
    const attempt = flaky(99, connectError);
    await expect(
      withDbRetry(attempt, { operation: "findMany", inTransaction: false }, deps()),
    ).rejects.toThrow("timeout exceeded when trying to connect");
    expect(attempt).toHaveBeenCalledTimes(MAX_CONNECT_RETRIES + 1);
  });

  it("retries a stalled read once", async () => {
    const attempt = flaky(1, stallError);
    await expect(
      withDbRetry(attempt, { operation: "findMany", inTransaction: false }, deps()),
    ).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("never repeats a write that stalled — it may already have saved", async () => {
    for (const operation of ["create", "update", "upsert", "delete", "$executeRaw", "$queryRaw"]) {
      const attempt = flaky(1, stallError);
      await expect(withDbRetry(attempt, { operation, inTransaction: false }, deps())).rejects.toThrow();
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });

  it("never repeats a stalled read inside a transaction", async () => {
    const attempt = flaky(1, stallError);
    await expect(
      withDbRetry(attempt, { operation: "findMany", inTransaction: true }, deps()),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does not retry ordinary errors", async () => {
    const attempt = flaky(1, () => new Error("Unique constraint failed on the fields: (`lrn`)"));
    await expect(
      withDbRetry(attempt, { operation: "findMany", inTransaction: false }, deps()),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("gives up once the time budget is spent", async () => {
    let t = 0;
    const attempt = vi.fn(async () => {
      t += RETRY_TIME_BUDGET_MS; // each attempt eats the whole budget
      throw connectError();
    });
    await expect(
      withDbRetry(attempt, { operation: "findMany", inTransaction: false }, deps({ now: () => t })),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("CircuitBreaker", () => {
  it("stops all retrying when failures pile up, then cools off", async () => {
    let t = 0;
    const d = deps({ now: () => t });
    for (let i = 0; i < BREAKER_THRESHOLD; i += 1) d.breaker.recordFailure();
    expect(d.breaker.allowsRetry()).toBe(false);

    const attempt = flaky(1, connectError);
    await expect(
      withDbRetry(attempt, { operation: "findMany", inTransaction: false }, d),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);

    t += BREAKER_COOLDOWN_MS;
    expect(d.breaker.allowsRetry()).toBe(true);
  });
});
