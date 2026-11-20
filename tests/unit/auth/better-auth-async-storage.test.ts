import { describe, expect, it } from "vitest";
import {
  getCurrentAuthContextAsyncLocalStorage,
  getCurrentDBAdapterAsyncLocalStorage,
  getRequestStateAsyncLocalStorage,
} from "@better-auth/core/context";
import {
  BETTER_AUTH_GLOBAL_KEY,
  seedBetterAuthAsyncStorage,
} from "@/lib/auth/better-auth-async-storage";

type Shared = { context: Record<string, unknown> };

describe("seedBetterAuthAsyncStorage", () => {
  it("fills the slots Better Auth reads, so it never awaits its module-level import", async () => {
    seedBetterAuthAsyncStorage();
    const shared = (globalThis as unknown as Record<symbol, Shared>)[BETTER_AUTH_GLOBAL_KEY];

    // Better Auth returns the seeded storages instead of building its own:
    // if a slot name drifted in an upgrade, it would create a new one here.
    expect(await getCurrentAuthContextAsyncLocalStorage()).toBe(
      shared.context.endpointContextAsyncStorage
    );
    expect(await getRequestStateAsyncLocalStorage()).toBe(shared.context.requestStateAsyncStorage);
    expect(await getCurrentDBAdapterAsyncLocalStorage()).toBe(shared.context.adapterAsyncStorage);
  });

  it("keeps storages that already exist", () => {
    seedBetterAuthAsyncStorage();
    const shared = (globalThis as unknown as Record<symbol, Shared>)[BETTER_AUTH_GLOBAL_KEY];
    const before = shared.context.requestStateAsyncStorage;
    seedBetterAuthAsyncStorage();
    expect(shared.context.requestStateAsyncStorage).toBe(before);
  });
});
