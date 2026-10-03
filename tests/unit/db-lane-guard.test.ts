import { describe, expect, it, vi } from "vitest";

const OK = "postgresql://postgres@127.0.0.1:54329/litrack_test";

async function loadGuard() {
  // helpers.ts builds its (lazy, non-connecting) client at import time, so the
  // process env must satisfy the guard first.
  vi.stubEnv("DATABASE_URL", OK);
  vi.stubEnv("LITRACK_TEST_DB_LANE", "1");
  const mod = await import("../db/helpers");
  vi.unstubAllEnvs();
  return mod.localDatabaseUrl;
}

describe("DB lane URL guard", () => {
  it("accepts only the throwaway cluster with the lane marker", async () => {
    const guard = await loadGuard();
    expect(guard({ DATABASE_URL: OK, LITRACK_TEST_DB_LANE: "1" })).toBe(OK);
  });

  it("refuses without the marker", async () => {
    const guard = await loadGuard();
    expect(() => guard({ DATABASE_URL: OK })).toThrow(/LITRACK_TEST_DB_LANE/);
  });

  it.each([
    "postgresql://postgres@127.0.0.1:5432/litrack_test",
    "postgresql://postgres@localhost:5432/postgres",
    "postgresql://postgres@127.0.0.1:54329/postgres",
    "postgresql://postgres@127.0.0.1/litrack_test",
    "postgresql://postgres@db.example.com:54329/litrack_test",
  ])("refuses %s", async (url) => {
    const guard = await loadGuard();
    expect(() => guard({ DATABASE_URL: url, LITRACK_TEST_DB_LANE: "1" })).toThrow(/Refusing/);
  });
});
