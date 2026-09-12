import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const updateMany = vi.fn();
const createSupabaseServerClient = vi.fn();
const readBoundImpersonationSession = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { updateMany: (...args: unknown[]) => updateMany(...args) } },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));

vi.mock("@/lib/auth/impersonation", () => ({
  readBoundImpersonationSession: (...args: unknown[]) =>
    readBoundImpersonationSession(...args),
}));

import { recordTeacherPresence } from "@/lib/actions/presence";

const TEACHER = {
  id: "teacher-1",
  role: "TEACHER",
  isActive: true,
  deletedAt: null,
};

describe("recordTeacherPresence", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    requireUser.mockResolvedValue(TEACHER);
    updateMany.mockResolvedValue({ count: 1 });
    createSupabaseServerClient.mockResolvedValue({ auth: { getSession: vi.fn() } });
    readBoundImpersonationSession.mockResolvedValue(null);
  });

  it("updates only the authenticated active teacher using server time and an atomic one-minute cutoff", async () => {
    const now = new Date("2026-09-12T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await expect(recordTeacherPresence()).resolves.toEqual({ ok: true });

    expect(requireUser).toHaveBeenCalledWith("TEACHER", false);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: TEACHER.id,
        role: "TEACHER",
        deletedAt: null,
        isActive: true,
        OR: [
          { lastOnlineAt: null },
          { lastOnlineAt: { lt: new Date("2026-09-12T09:59:00.000Z") } },
        ],
      },
      data: { lastOnlineAt: now },
    });
  });

  it("does not write presence for a bound Super Admin impersonation session", async () => {
    readBoundImpersonationSession.mockResolvedValue({
      ticket: { targetUserId: TEACHER.id },
      expired: false,
    });

    await expect(recordTeacherPresence()).resolves.toEqual({ ok: true });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("fails closed before a write when the session is not a teacher", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(recordTeacherPresence()).rejects.toThrow("NEXT_REDIRECT");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps presence failure from interrupting teacher work", async () => {
    updateMany.mockRejectedValue(new Error("pool unavailable"));

    await expect(recordTeacherPresence()).resolves.toEqual({
      ok: false,
      error: "Presence could not be updated",
    });
  });
});
