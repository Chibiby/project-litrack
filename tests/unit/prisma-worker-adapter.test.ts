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
