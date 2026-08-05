import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppBaseUrl } from "./url";

describe("getAppBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers NEXT_PUBLIC_APP_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    vi.stubEnv("VERCEL_URL", "ignored.vercel.app");
    expect(getAppBaseUrl()).toEqual({ ok: true, url: "https://app.example.com" });
  });

  it("falls back to https://VERCEL_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "my-app.vercel.app");
    expect(getAppBaseUrl()).toEqual({ ok: true, url: "https://my-app.vercel.app" });
  });

  it("fails in production without a base URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    const result = getAppBaseUrl();
    expect(result.ok).toBe(false);
  });
});
