import { beforeEach, describe, expect, it, vi } from "vitest";

/** `settingKey` is an allow-listed context key; anything not on the list is dropped. */

const errorEventCreate = vi.fn();
const deferred: Promise<unknown>[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    errorEvent: {
      get create() {
        return errorEventCreate;
      },
    },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => {
    deferred.push(task());
  },
}));
vi.mock("@/lib/errors/alert", () => ({ sendErrorAlert: vi.fn(async () => undefined) }));

import { AppError } from "@/lib/errors/app-error";
import { ERROR_CONTEXT_KEYS, reportError } from "@/lib/errors/report";

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  errorEventCreate.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reportError context filtering — settingKey", () => {
  it("keeps settingKey and still drops an unknown key", async () => {
    reportError(
      new AppError("INTERNAL_ERROR", {
        context: { settingKey: "x", notAllowListed: "leak" },
      })
    );
    await Promise.all(deferred.splice(0));
    const ctx = errorEventCreate.mock.calls[0][0].data.context;
    expect(ctx.settingKey).toBe("x");
    expect(ctx).not.toHaveProperty("notAllowListed");
    expect(ERROR_CONTEXT_KEYS.has("settingKey")).toBe(true);
    expect(ERROR_CONTEXT_KEYS.has("notAllowListed")).toBe(false);
  });
});
