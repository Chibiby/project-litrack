import { afterEach, describe, expect, it, vi } from "vitest";

import { createPrismaClient, createPrismaProxy } from "@/lib/prisma";

describe("Prisma Worker runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructs Prisma with a JavaScript driver adapter instead of the native query engine", async () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "cloudflare");
    const client = createPrismaClient(
      "postgresql://postgres:password@localhost:5432/litrack",
    );

    const engineConfig = client as unknown as {
      _engineConfig: {
        adapter?: { provider?: string; config?: { maxUses?: number } };
      };
    };

    expect(engineConfig._engineConfig.adapter).toBeDefined();
    expect(engineConfig._engineConfig.adapter?.provider).toBe("postgres");
    expect(engineConfig._engineConfig.adapter?.config?.maxUses).toBe(1);

    await client.$disconnect();
  });

  it("keeps pooled connections off Cloudflare, where the client is a process singleton", async () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "local");
    const client = createPrismaClient(
      "postgresql://postgres:password@localhost:5432/litrack",
    );
    const engineConfig = client as unknown as {
      _engineConfig: { adapter?: { config?: { maxUses?: number } } };
    };
    expect(engineConfig._engineConfig.adapter).toBeDefined();
    expect(engineConfig._engineConfig.adapter?.config?.maxUses).toBeUndefined();
    await client.$disconnect();
  });

  it("bounds every database wait so a stuck socket cannot hang a request forever", async () => {
    const client = createPrismaClient(
      "postgresql://postgres:password@localhost:5432/litrack",
    );
    const config = (
      client as unknown as {
        _engineConfig: {
          adapter?: {
            config?: { connectionTimeoutMillis?: number; query_timeout?: number };
          };
        };
      }
    )._engineConfig.adapter?.config;

    // pg defaults both to 0 (wait forever). A hung server action blocks the
    // browser's whole action queue, so every later click spins until reload.
    expect(config?.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config?.query_timeout).toBeGreaterThan(0);

    await client.$disconnect();
  });

  it("does not create a Worker client until a query delegate is requested", () => {
    const school = { findMany: () => [] };
    let creations = 0;
    const lazyClient = createPrismaProxy(() => {
      creations += 1;
      return { school } as never;
    });

    expect(creations).toBe(0);
    expect(lazyClient.school).toBe(school);
    expect(creations).toBe(1);
  });
});
