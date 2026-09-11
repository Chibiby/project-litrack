import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The release channel's one server action.
 *
 * Since 1.6.0 the bell's release history is derived from the committed
 * `RELEASES` list, so the only write left is the acknowledgement stamp. Only
 * Prisma and the session are mocked; `APP_VERSION` is pinned to a fixed value so
 * these tests do not break every time a release is added.
 */

const mockUser = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => mockUser(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
  },
}));

vi.mock("@/lib/releases", () => ({
  APP_VERSION: "1.1.0",
}));

import { acknowledgeRelease } from "@/lib/actions/release";

const TEACHER = {
  id: "u1",
  schoolId: "s1",
  role: "TEACHER",
  lastSeenReleaseVersion: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(TEACHER);
  mockUserUpdate.mockResolvedValue({});
});

describe("acknowledgeRelease", () => {
  it("stamps the current version on the caller", async () => {
    expect((await acknowledgeRelease()).ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastSeenReleaseVersion: "1.1.0" },
    });
  });

  it("is idempotent — stamping twice ends in the same state as once", async () => {
    await acknowledgeRelease();
    await acknowledgeRelease();

    for (const call of mockUserUpdate.mock.calls) {
      expect(
        (call[0] as { data: { lastSeenReleaseVersion: string } }).data
          .lastSeenReleaseVersion
      ).toBe("1.1.0");
    }
  });

  it("stamps a Super Admin too — the modal needs no school", async () => {
    mockUser.mockResolvedValue({ ...TEACHER, role: "SUPER_ADMIN", schoolId: null });

    expect((await acknowledgeRelease()).ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports failure when the stamp cannot be written", async () => {
    mockUserUpdate.mockRejectedValue(new Error("pool timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Without the stamp the user is interrupted again on the next page, so
    // they must be told it did not stick.
    expect((await acknowledgeRelease()).ok).toBe(false);
  });
});
