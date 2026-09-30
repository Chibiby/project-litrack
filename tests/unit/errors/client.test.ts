import { afterEach, describe, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import {
  classifyClientFailure,
  isActionFailure,
  isNextControlFlow,
} from "@/lib/errors/client";
import { newReference } from "@/lib/errors/reference";

function withDigest(digest: string, message = "boom"): Error {
  return Object.assign(new Error(message), { digest });
}

afterEach(() => vi.unstubAllGlobals());

describe("isNextControlFlow", () => {
  it("is true for redirect and http-access digests", () => {
    expect(isNextControlFlow(withDigest("NEXT_REDIRECT;push;/login;307;"))).toBe(true);
    expect(isNextControlFlow(withDigest("NEXT_REDIRECT;replace;/a;b;303;"))).toBe(true);
    expect(isNextControlFlow(withDigest("NEXT_HTTP_ERROR_FALLBACK;404"))).toBe(true);
    expect(isNextControlFlow(withDigest("NEXT_HTTP_ERROR_FALLBACK;403"))).toBe(true);
    expect(isNextControlFlow(withDigest("NEXT_HTTP_ERROR_FALLBACK;401"))).toBe(true);
  });

  it("is false for ordinary errors and other digests", () => {
    expect(isNextControlFlow(new Error("nope"))).toBe(false);
    expect(isNextControlFlow(withDigest("DBU-123"))).toBe(false);
    expect(isNextControlFlow(withDigest("NEXT_HTTP_ERROR_FALLBACK;500"))).toBe(false);
    expect(isNextControlFlow(null)).toBe(false);
    expect(isNextControlFlow("NEXT_REDIRECT")).toBe(false);
  });
});

describe("isActionFailure", () => {
  it("matches the failure shape, with or without a code", () => {
    expect(isActionFailure({ ok: false, error: "x" })).toBe(true);
    expect(isActionFailure({ ok: false, code: "NOT_FOUND", error: "x" })).toBe(true);
    expect(isActionFailure({ ok: true })).toBe(false);
    expect(isActionFailure({ ok: false })).toBe(false);
    expect(isActionFailure(undefined)).toBe(false);
  });
});

describe("classifyClientFailure", () => {
  it("reports offline first, even for an error that would match later branches", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(classifyClientFailure(new TypeError("Failed to fetch")).code).toBe("NETWORK_OFFLINE");
  });

  it("detects deploy skew from an unrecognized action", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const err = new UnrecognizedActionError('Server Action "abc" was not found on the server');
    expect(classifyClientFailure(err).code).toBe("APP_UPDATED");
  });

  it("detects deploy skew from chunk load failures", () => {
    const named = Object.assign(new Error("x"), { name: "ChunkLoadError" });
    expect(classifyClientFailure(named).code).toBe("APP_UPDATED");
    expect(classifyClientFailure(new Error("Loading chunk 42 failed.")).code).toBe("APP_UPDATED");
    expect(classifyClientFailure(new Error("Failed to load chunk /_next/a.js")).code).toBe(
      "APP_UPDATED"
    );
    expect(
      classifyClientFailure(new TypeError("Failed to fetch dynamically imported module: /a.js")).code
    ).toBe("APP_UPDATED");
    expect(
      classifyClientFailure(new Error("error loading dynamically imported module")).code
    ).toBe("APP_UPDATED");
  });

  it("maps a fetch TypeError to SERVER_UNREACHABLE when online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    for (const msg of ["Failed to fetch", "fetch failed", "NetworkError when attempting", "Load failed"]) {
      expect(classifyClientFailure(new TypeError(msg)).code, msg).toBe("SERVER_UNREACHABLE");
    }
    expect(classifyClientFailure(new Error("Failed to fetch")).code).toBe("INTERNAL_ERROR");
  });

  it("uses the digest as the reference for database and unknown failures", () => {
    const dbu = classifyClientFailure(withDigest("DBU-1234"));
    expect(dbu).toMatchObject({ ok: false, code: "DB_UNAVAILABLE", ref: "DBU-1234" });
    expect(dbu.error).toContain("Reference: DBU-1234");

    expect(classifyClientFailure(withDigest("DBS-77"))).toMatchObject({
      code: "DB_SCHEMA_OUT_OF_DATE",
      ref: "DBS-77",
    });
    expect(classifyClientFailure(withDigest("98765"))).toMatchObject({
      code: "INTERNAL_ERROR",
      ref: "98765",
    });
  });

  it("recognizes the body-size digest", () => {
    const res = classifyClientFailure(withDigest("abc@E394"));
    expect(res.code).toBe("REQUEST_TOO_LARGE");
    expect(res.error).not.toContain("abc@E394");
  });

  it("treats the opaque server response error as unreachable", () => {
    const err = new Error("An unexpected response was received from the server.");
    expect(classifyClientFailure(err).code).toBe("SERVER_UNREACHABLE");
  });

  it("never passes raw error text through", () => {
    const res = classifyClientFailure(new Error("secret table users"));
    expect(res.code).toBe("INTERNAL_ERROR");
    expect(res.ref).toBeUndefined();
    expect(res.error).not.toContain("secret");
    expect(classifyClientFailure("secret table users").error).not.toContain("secret");
  });
});

describe("newReference (browser-safe module)", () => {
  it("keeps its format", () => {
    expect(newReference()).toMatch(/^E-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});
