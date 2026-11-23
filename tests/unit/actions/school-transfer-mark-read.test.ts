import { beforeEach, describe, expect, it, vi } from "vitest";

/** The client-side "Transfer page opened" mark-read action. */

const session = vi.hoisted(() => ({ user: { id: "sh-a", role: "SCHOOL_HEAD", schoolId: "a" } as Record<string, unknown> }));
const mark = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({ requireSchoolUser: vi.fn(async () => session.user) }));
vi.mock("@/lib/transfers/notify", () => ({ markSchoolTransferNoticesRead: mark, notifySchoolTransfer: vi.fn() }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(async () => undefined) }));

import { markMyTransferNoticesRead } from "@/lib/actions/school-transfer";

beforeEach(() => mark.mockClear());

describe("markMyTransferNoticesRead", () => {
  it("clears the signed-in School Head's own transfer notices for their school", async () => {
    session.user = { id: "sh-a", role: "SCHOOL_HEAD", schoolId: "a" };
    await expect(markMyTransferNoticesRead()).resolves.toEqual({ ok: true });
    expect(mark).toHaveBeenCalledWith({ recipientId: "sh-a", schoolId: "a" });
  });

  it("leaves a Super Admin's look alone", async () => {
    session.user = { id: "admin", role: "SUPER_ADMIN", schoolId: "a" };
    await expect(markMyTransferNoticesRead()).resolves.toEqual({ ok: true });
    expect(mark).not.toHaveBeenCalled();
  });
});
