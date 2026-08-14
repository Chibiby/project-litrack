import { describe, it, expect } from "vitest";
import { CACHE_TTL, resolveRevalidate } from "@/lib/cache/profiles";

describe("CACHE_TTL", () => {
  it("orders profiles from longest-lived to shortest", () => {
    expect(CACHE_TTL.static).toBeGreaterThan(CACHE_TTL.reference);
    expect(CACHE_TTL.reference).toBeGreaterThan(CACHE_TTL.aggregate);
    expect(CACHE_TTL.aggregate).toBeGreaterThan(CACHE_TTL.volatile);
  });

  it("keeps every profile bounded so a missed tag self-heals", () => {
    for (const ttl of Object.values(CACHE_TTL)) {
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);
    }
  });
});

describe("resolveRevalidate", () => {
  it("resolves a named profile", () => {
    expect(resolveRevalidate({ profile: "reference" })).toBe(CACHE_TTL.reference);
  });

  it("lets an explicit number win over a profile", () => {
    expect(resolveRevalidate({ profile: "static", revalidate: 15 })).toBe(15);
  });

  it("defaults to the aggregate profile", () => {
    expect(resolveRevalidate({})).toBe(CACHE_TTL.aggregate);
  });
});
