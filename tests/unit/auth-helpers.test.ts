import { describe, expect, it, vi } from "vitest";
import {
  generateActivationCredential,
  generateReadableCredential,
  hashToken,
  isStrongPasswordShape,
} from "@/lib/auth/credentials";
import {
  schoolHeadSyntheticEmail,
  teacherUsername,
  teacherSyntheticEmail,
  usernameFromTeacherEmail,
  isSyntheticEmail,
  TEACHER_EMAIL_DOMAIN,
} from "@/lib/auth/synthetic-email";
import {
  parseAppMetadataRole,
  roleHomePath,
  enforceRolePrefix,
  authedLoginRedirect,
} from "@/lib/auth/roles";
import {
  DECLINED_REGISTRATION_MESSAGE,
  DEACTIVATED_TEACHER_MESSAGE,
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictCode,
  registerConflictError,
} from "@/lib/auth/teacher-registration-helpers";

// Only `requireUser` (the signed-out redirect test at the bottom) reaches these.
// Every other helper in this file is pure and imports none of them.
const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }), signOut: vi.fn() },
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));
vi.mock("@/lib/auth/impersonation", () => ({ clearImpersonationCookie: vi.fn() }));

describe("generateActivationCredential", () => {
  it("returns ~14 char base64url without padding", () => {
    const cred = generateActivationCredential();
    expect(cred.length).toBeGreaterThanOrEqual(13);
    expect(cred.length).toBeLessThanOrEqual(16);
    expect(cred).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cred.includes("=")).toBe(false);
  });

  it("produces unique values", () => {
    const a = generateActivationCredential();
    const b = generateActivationCredential();
    expect(a).not.toBe(b);
  });
});

describe("generateReadableCredential", () => {
  it("is 16 characters from the unambiguous alphabet, grouped xxxx-xxxx-xxxx-xxxx", () => {
    for (let i = 0; i < 200; i++) {
      const cred = generateReadableCredential();
      expect(cred).toMatch(/^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/);
      expect(cred.replace(/-/g, "")).toHaveLength(16);
    }
  });

  it("never holds a character that reads as another (0 o 1 l i, or upper case)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateReadableCredential()).not.toMatch(/[01oliA-Z]/);
    }
  });

  it("always holds a letter and a digit, so it passes isStrongPasswordShape", () => {
    for (let i = 0; i < 500; i++) {
      const cred = generateReadableCredential();
      expect(cred).toMatch(/[a-z]/);
      expect(cred).toMatch(/[0-9]/);
      expect(isStrongPasswordShape(cred)).toBe(true);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateReadableCredential()));
    expect(seen.size).toBe(200);
  });
});

describe("hashToken", () => {
  it("returns stable sha256 hex", () => {
    const a = hashToken("secret");
    const b = hashToken("secret");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken("other")).not.toBe(a);
  });
});

describe("synthetic emails", () => {
  it("builds school head and teacher emails", () => {
    expect(schoolHeadSyntheticEmail("ABC_12")).toMatch(/^sh@abc-12\./);
    expect(teacherUsername("O'Brien", "a1b2")).toBe("teacher.obrien.a1b2");
    expect(teacherSyntheticEmail("teacher.smith.a1b2")).toBe(
      `teacher.smith.a1b2@${TEACHER_EMAIL_DOMAIN}`
    );
    expect(usernameFromTeacherEmail(`teacher.smith.a1b2@${TEACHER_EMAIL_DOMAIN}`)).toBe(
      "teacher.smith.a1b2"
    );
  });

  it("detects synthetic emails", () => {
    expect(isSyntheticEmail(`teacher.x.abcd@${TEACHER_EMAIL_DOMAIN}`)).toBe(true);
    expect(isSyntheticEmail("person@gmail.com")).toBe(false);
  });
});

describe("password shape helper", () => {
  it("mirrors strong password rules", () => {
    expect(isStrongPasswordShape("password1")).toBe(true);
    expect(isStrongPasswordShape("password")).toBe(false);
  });
});

describe("roles + middleware gate", () => {
  it("maps roles to homes", () => {
    expect(roleHomePath("SUPER_ADMIN")).toBe("/admin");
    expect(roleHomePath("SCHOOL_HEAD")).toBe("/school-head");
    expect(roleHomePath("TEACHER")).toBe("/teacher");
    expect(roleHomePath("DISTRICT_ADMIN")).toBe("/district");
  });

  it("parses app metadata roles", () => {
    expect(parseAppMetadataRole("TEACHER")).toBe("TEACHER");
    expect(parseAppMetadataRole("DISTRICT_ADMIN")).toBe("DISTRICT_ADMIN");
    expect(parseAppMetadataRole("nope")).toBeNull();
  });

  it("sends a district admin home from every other role's area (T15)", () => {
    for (const path of ["/admin/x", "/admin", "/school-head", "/school-head/learners", "/teacher"]) {
      expect(enforceRolePrefix(path, "DISTRICT_ADMIN")).toEqual({
        ok: false,
        redirectTo: "/district",
      });
    }
  });

  it("keeps everyone but district admins and Super Admins out of /district (T15)", () => {
    expect(enforceRolePrefix("/district", "TEACHER")).toEqual({ ok: false, redirectTo: "/teacher" });
    expect(enforceRolePrefix("/district/schools", "SCHOOL_HEAD")).toEqual({
      ok: false,
      redirectTo: "/school-head",
    });
    expect(enforceRolePrefix("/district", "DISTRICT_ADMIN").ok).toBe(true);
    expect(enforceRolePrefix("/district/summary/learners", "DISTRICT_ADMIN").ok).toBe(true);
    expect(enforceRolePrefix("/district", "SUPER_ADMIN").ok).toBe(true);
    expect(enforceRolePrefix("/account/set-password", "DISTRICT_ADMIN").ok).toBe(true);
  });

  it("matches /district as a whole segment, not /districtfoo (T15)", () => {
    expect(enforceRolePrefix("/districtfoo", "TEACHER").ok).toBe(true);
    expect(enforceRolePrefix("/district-news", "SCHOOL_HEAD").ok).toBe(true);
  });

  it("bounces a signed-in district admin off the login pages to /district", () => {
    expect(authedLoginRedirect("GET", "/admin/login", "DISTRICT_ADMIN")).toBe("/district");
    expect(authedLoginRedirect("GET", "/login", "DISTRICT_ADMIN")).toBe("/district");
  });

  it("enforces path prefixes; legacy null role passes", () => {
    expect(enforceRolePrefix("/admin/schools", null).ok).toBe(true);
    expect(enforceRolePrefix("/admin/schools", "TEACHER").ok).toBe(false);
    expect(enforceRolePrefix("/school-head", "SCHOOL_HEAD").ok).toBe(true);
    expect(enforceRolePrefix("/school-head", "TEACHER").ok).toBe(false);
    expect(enforceRolePrefix("/teacher", "SUPER_ADMIN").ok).toBe(true);
    expect(enforceRolePrefix("/account/password", "TEACHER").ok).toBe(true);
    // Pending teacher self-register success page must not be role-blocked.
    expect(enforceRolePrefix("/account/created", "TEACHER").ok).toBe(true);
    expect(enforceRolePrefix("/account/created", null).ok).toBe(true);
  });

  it("bounces a signed-in visitor who loads a login page to their home", () => {
    expect(authedLoginRedirect("GET", "/login", "SCHOOL_HEAD")).toBe("/school-head");
    expect(authedLoginRedirect("HEAD", "/login", "TEACHER")).toBe("/teacher");
    expect(authedLoginRedirect("GET", "/admin/login", "SUPER_ADMIN")).toBe("/admin");
  });

  it("never redirects a POST to a login page — that is a Server Action mid-sign-in", () => {
    // The browser has just stored the session; finishSchoolHeadLogin /
    // finishTeacherLogin then POST to /login. Redirecting that request sends
    // the action to /school-head, where Next cannot find it, and the sign-in
    // Supabase already accepted is thrown away.
    expect(authedLoginRedirect("POST", "/login", "SCHOOL_HEAD")).toBeNull();
    expect(authedLoginRedirect("POST", "/login", "TEACHER")).toBeNull();
    expect(authedLoginRedirect("POST", "/admin/login", "SUPER_ADMIN")).toBeNull();
  });

  it("leaves legacy role-less sessions and other paths alone", () => {
    expect(authedLoginRedirect("GET", "/login", null)).toBeNull();
    expect(authedLoginRedirect("GET", "/school-head", "SCHOOL_HEAD")).toBeNull();
    expect(authedLoginRedirect("GET", "/forgot-password", "TEACHER")).toBeNull();
  });
});

describe("requireUser while signed out (T15)", () => {
  async function landing(roles: Parameters<typeof import("@/lib/auth/session").requireUser>[0]) {
    const { requireUser } = await import("@/lib/auth/session");
    redirect.mockClear();
    await expect(requireUser(roles)).rejects.toThrow(/^NEXT_REDIRECT:/);
    return redirect.mock.calls[0]?.[0];
  }

  it("sends a district page's visitor to the admin login", async () => {
    expect(await landing(["DISTRICT_ADMIN"])).toBe("/admin/login");
    expect(await landing("DISTRICT_ADMIN")).toBe("/admin/login");
    expect(await landing(["SUPER_ADMIN", "DISTRICT_ADMIN"])).toBe("/admin/login");
  });

  it("still sends Super Admin pages to the admin login and school pages to /login", async () => {
    expect(await landing("SUPER_ADMIN")).toBe("/admin/login");
    expect(await landing("SCHOOL_HEAD")).toBe("/login");
    expect(await landing(["TEACHER"])).toBe("/login");
    expect(await landing(undefined)).toBe("/login");
  });
});

describe("teacher registration helpers", () => {
  const base = {
    role: "TEACHER" as const,
    schoolId: "school-1",
    approvalStatus: "PENDING" as const,
    deletedAt: null,
    isActive: false,
  };

  it("detects PENDING teacher at school for idempotent success", () => {
    const pending = {
      role: base.role,
      schoolId: base.schoolId,
      approvalStatus: base.approvalStatus,
      deletedAt: base.deletedAt,
    };
    expect(isPendingTeacherAtSchool(pending, "school-1")).toBe(true);
    expect(isPendingTeacherAtSchool(pending, "school-2")).toBe(false);
    expect(
      isPendingTeacherAtSchool({ ...pending, approvalStatus: "APPROVED" }, "school-1")
    ).toBe(false);
    expect(
      isPendingTeacherAtSchool({ ...pending, deletedAt: new Date() }, "school-1")
    ).toBe(false);
  });

  it("maps register conflicts to codes, and keeps the wording", () => {
    expect(registerConflictCode(base, "school-1")).toBe("AUTH_TEACHER_PENDING");
    expect(registerConflictCode({ ...base, approvalStatus: "REJECTED" }, "school-1")).toBe(
      "AUTH_REGISTRATION_DECLINED"
    );
    expect(
      registerConflictCode({ ...base, approvalStatus: "APPROVED", isActive: false }, "school-1")
    ).toBe("AUTH_ACCOUNT_DEACTIVATED");
    expect(
      registerConflictCode({ ...base, approvalStatus: "APPROVED", isActive: true }, "school-1")
    ).toBe("AUTH_ACCOUNT_EXISTS_SIGN_IN");
    // An account at ANOTHER school must never be described as one at this
    // school — that would tell a stranger where a colleague works.
    expect(registerConflictCode(base, "other-school")).toBe("AUTH_EMAIL_IN_USE");

    expect(registerConflictError(base, "school-1")).toBe(
      "Your request is pending School Head approval."
    );
    expect(registerConflictError({ ...base, approvalStatus: "REJECTED" }, "school-1")).toBe(
      DECLINED_REGISTRATION_MESSAGE
    );
    expect(registerConflictError(base, "other-school")).toBe(
      "That email is already used by another LITRACK account."
    );
  });

  it("detects deactivated approved teachers", () => {
    expect(
      isDeactivatedTeacher({
        role: "TEACHER",
        approvalStatus: "APPROVED",
        isActive: false,
        deletedAt: null,
      })
    ).toBe(true);
    expect(
      isDeactivatedTeacher({
        role: "TEACHER",
        approvalStatus: "APPROVED",
        isActive: true,
        deletedAt: null,
      })
    ).toBe(false);
    expect(
      isDeactivatedTeacher({
        role: "TEACHER",
        approvalStatus: "PENDING",
        isActive: false,
        deletedAt: null,
      })
    ).toBe(false);
  });
});
