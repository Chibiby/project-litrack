import { afterEach, describe, expect, it, vi } from "vitest";
import { callAction } from "@/lib/ui/call-action";

const redirectError = () =>
  Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;push;/login;307;",
  });

describe("callAction", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes the action result through", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const res = await callAction(async () => ({ ok: true as const }));
    expect(res).toEqual({ ok: true });
  });

  it("returns NETWORK_OFFLINE without calling the action when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const run = vi.fn(async () => ({ ok: true as const }));
    const res = await callAction(run);
    expect(run).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, code: "NETWORK_OFFLINE" });
  });

  it("classifies a dropped connection as SERVER_UNREACHABLE", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const res = await callAction(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(res).toMatchObject({ ok: false, code: "SERVER_UNREACHABLE" });
  });

  it("rethrows a redirect untouched", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const err = redirectError();
    await expect(
      callAction(async () => {
        throw err;
      })
    ).rejects.toBe(err);
  });
});
