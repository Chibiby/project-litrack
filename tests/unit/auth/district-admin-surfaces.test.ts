import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Surfaces a district admin must NOT get more of than the spec grants
 * (`docs/specs/district-admin.md`, T12):
 *
 * - `globalSearch` gives a district admin only in-scope schools, and never
 *   runs a learner or teacher query at all (non-goal: "No learner-level lists
 *   … in the district portal").
 * - `askAssistant` answers NO_SCHOOL — the assistant reads from one school's
 *   data and a district admin's `schoolId` is always null.
 * - Chat reads answer empty or "Not found" — `ADMIN_DIRECT` stays a line to
 *   the division team, not to district admins (non-goal: "No chat").
 * - `requireUser(["SCHOOL_HEAD"])` and `requireSchoolUser()` redirect a
 *   district admin to `/district` rather than admitting them.
 *
 * These are read-only checks of code owned by other modules
 * (`src/lib/auth/session.ts`, `src/lib/actions/chat.ts`,
 * `src/lib/actions/assistant.ts`) plus this agent's own
 * `src/lib/actions/global-search.ts`. Each `describe` block mocks only the
 * module boundary it needs and resets the module registry first, because two
 * blocks below need `@/lib/auth/session` mocked and one needs it real.
 */

const DISTRICT_ADMIN = { id: "da-1", schoolId: null, role: "DISTRICT_ADMIN" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@/lib/prisma");
  vi.doUnmock("@/lib/auth/session");
  vi.doUnmock("@/lib/auth/district-scope");
  vi.doUnmock("@/lib/teachers/scope");
  vi.doUnmock("@/lib/assistant/gemini");
  vi.doUnmock("@/lib/rate-limit");
  vi.doUnmock("next/navigation");
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("@/lib/db/read-mode");
  vi.doUnmock("@/lib/auth/impersonation");
});

describe("globalSearch — DISTRICT_ADMIN branch", () => {
  const schoolFindMany = vi.fn();
  const learnerFindMany = vi.fn();
  const teacherFindMany = vi.fn();
  const sectionFindMany = vi.fn();
  const requireUser = vi.fn();
  const requireAdminScope = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    schoolFindMany.mockReset().mockResolvedValue([
      { id: "school-1", name: "Alabel Central ES", district: "Alabel 1" },
    ]);
    learnerFindMany.mockReset();
    teacherFindMany.mockReset();
    sectionFindMany.mockReset();
    requireUser.mockReset().mockResolvedValue(DISTRICT_ADMIN);
    requireAdminScope.mockReset().mockResolvedValue({
      user: DISTRICT_ADMIN,
      scope: { kind: "districts", districts: ["Alabel 1"] },
    });

    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        school: { findMany: schoolFindMany },
        learner: { findMany: learnerFindMany },
        user: { findMany: teacherFindMany },
        section: { findMany: sectionFindMany },
      },
    }));
    vi.doMock("@/lib/auth/session", () => ({
      requireUser: (...a: unknown[]) => requireUser(...a),
    }));
    vi.doMock("@/lib/auth/district-scope", () => ({
      requireAdminScope: () => requireAdminScope(),
    }));
  });

  it("returns only in-scope schools, and runs no learner or teacher query", async () => {
    const { globalSearch } = await import("@/lib/actions/global-search");

    const result = await globalSearch({ q: "Alabel" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      {
        id: "school-1",
        kind: "school",
        title: "Alabel Central ES",
        subtitle: "Alabel 1",
        href: "/district/schools/school-1",
      },
    ]);

    // The non-goal this branch exists to guarantee: no learner or teacher
    // query runs for a district admin, at all, even though the query text
    // could plausibly match a learner or a teacher's name too.
    expect(learnerFindMany).not.toHaveBeenCalled();
    expect(teacherFindMany).not.toHaveBeenCalled();
    expect(sectionFindMany).not.toHaveBeenCalled();
  });

  it("puts the caller's own scope in the school query's where", async () => {
    const { globalSearch } = await import("@/lib/actions/global-search");
    const { schoolWhereForScope } = await import("@/lib/auth/admin-scope");
    const scope = { kind: "districts" as const, districts: ["Alabel 1"] };

    await globalSearch({ q: "Alabel" });

    expect(schoolFindMany.mock.calls[0]?.[0]?.where).toMatchObject(schoolWhereForScope(scope));
  });

  it("returns nothing below the minimum query length, without calling requireAdminScope", async () => {
    const { globalSearch } = await import("@/lib/actions/global-search");

    const result = await globalSearch({ q: "a" });

    expect(result).toEqual({ ok: true, data: [] });
    expect(requireAdminScope).not.toHaveBeenCalled();
  });
});

describe("askAssistant — DISTRICT_ADMIN has no school", () => {
  const requireUser = vi.fn();
  const geminiConfigured = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    requireUser.mockReset().mockResolvedValue(DISTRICT_ADMIN);
    geminiConfigured.mockReset().mockReturnValue(true);

    vi.doMock("@/lib/auth/session", () => ({
      requireUser: (...a: unknown[]) => requireUser(...a),
    }));
    vi.doMock("@/lib/assistant/gemini", () => ({
      geminiConfigured: () => geminiConfigured(),
      askGemini: vi.fn(),
    }));
  });

  it("answers NO_SCHOOL rather than reaching the model", async () => {
    const { askAssistant } = await import("@/lib/actions/assistant");

    const result = await askAssistant({ question: "How do I mark attendance?" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("this admin account is not attached to one");
  });
});

describe("chat — a school-less non-admin gets empty or forbidden", () => {
  const requireUser = vi.fn();
  const chatChannelFindUnique = vi.fn();
  const chatChannelFindMany = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    requireUser.mockReset().mockResolvedValue(DISTRICT_ADMIN);
    chatChannelFindUnique.mockReset();
    chatChannelFindMany.mockReset();

    vi.doMock("@/lib/auth/session", () => ({
      requireUser: (...a: unknown[]) => requireUser(...a),
    }));
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        chatChannel: { findUnique: chatChannelFindUnique, findMany: chatChannelFindMany },
      },
    }));
  });

  it("getMyChatUnread answers empty for a school-less caller, without querying a channel", async () => {
    const { getMyChatUnread } = await import("@/lib/actions/chat");

    const result = await getMyChatUnread();

    expect(result).toEqual({ ok: true, data: { school: false, admin: false } });
    expect(chatChannelFindMany).not.toHaveBeenCalled();
  });

  it("readChannel answers 'Not found' for a channel in a school the caller has none of", async () => {
    const channelId = "44444444-4444-4444-8444-444444444444";
    chatChannelFindUnique.mockResolvedValue({
      id: channelId,
      kind: "SCHOOL",
      schoolId: "school-1",
      memberId: null,
      school: { name: "Alabel Central ES" },
    });

    const { readChannel } = await import("@/lib/actions/chat");

    const result = await readChannel({ channelId });

    expect(result).toEqual({ ok: false, error: "Not found" });
  });
});

describe("requireUser / requireSchoolUser — a signed-in DISTRICT_ADMIN redirects to /district", () => {
  const redirect = vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
  const userFindUnique = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    redirect.mockClear();
    userFindUnique.mockReset().mockResolvedValue({
      id: "da-1",
      authId: "auth-da-1",
      role: "DISTRICT_ADMIN",
      schoolId: null,
      deletedAt: null,
      isActive: true,
      mustChangePassword: false,
      approvalStatus: null,
    });

    vi.doMock("next/navigation", () => ({
      redirect: (path: string) => redirect(path),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: "auth-da-1" } } }),
          signOut: vi.fn(),
        },
      }),
    }));
    vi.doMock("@/lib/prisma", () => ({
      prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } },
    }));
    vi.doMock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));
    vi.doMock("@/lib/auth/impersonation", () => ({ clearImpersonationCookie: vi.fn() }));
  });

  it("requireUser([\"SCHOOL_HEAD\"]) redirects a DISTRICT_ADMIN to /district", async () => {
    const { requireUser } = await import("@/lib/auth/session");

    await expect(requireUser(["SCHOOL_HEAD"])).rejects.toThrow(
      "NEXT_REDIRECT:/district"
    );
  });

  it("requireSchoolUser() redirects a DISTRICT_ADMIN to /district (no schoolId to guarantee)", async () => {
    const { requireSchoolUser } = await import("@/lib/auth/session");

    await expect(requireSchoolUser()).rejects.toThrow("NEXT_REDIRECT:/district");
  });
});
