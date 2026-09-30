import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIpFrom } from "@/lib/request-ip";

const from = (h: Record<string, string>) => clientIpFrom(new Headers(h));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIpFrom on Cloudflare", () => {
  it("prefers cf-connecting-ip over a client-suppliable x-forwarded-for", () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "cloudflare");
    expect(from({ "cf-connecting-ip": "192.0.2.44", "x-forwarded-for": "6.6.6.6, 10.0.0.1" })).toBe(
      "192.0.2.44"
    );
  });

  it("ignores a blank cf-connecting-ip", () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "cloudflare");
    expect(from({ "cf-connecting-ip": "  ", "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
  });
});

describe("clientIpFrom off Cloudflare", () => {
  it.each([undefined, "vercel"])(
    "ignores a client-sent cf-connecting-ip (target %s)",
    (target) => {
      if (target) vi.stubEnv("LITRACK_DEPLOY_TARGET", target);
      else vi.stubEnv("LITRACK_DEPLOY_TARGET", "");
      expect(from({ "cf-connecting-ip": "192.0.2.44", "x-forwarded-for": "203.0.113.9" })).toBe(
        "203.0.113.9"
      );
    }
  );

  it("uses the first x-forwarded-for entry, then x-real-ip, then unknown", () => {
    expect(from({ "x-forwarded-for": "203.0.113.9, 70.41.3.18", "x-real-ip": "1.1.1.1" })).toBe(
      "203.0.113.9"
    );
    expect(from({ "x-real-ip": " 1.1.1.1 " })).toBe("1.1.1.1");
    expect(from({ "cf-connecting-ip": "192.0.2.44" })).toBe("unknown");
    expect(from({})).toBe("unknown");
  });
});
