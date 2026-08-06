import { describe, expect, it } from "vitest";
import {
  generateActivationCredential,
  hashToken,
  generateInviteTokenForUser,
  parseInviteTokenUserId,
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
import { parseAppMetadataRole, roleHomePath, enforceRolePrefix } from "@/lib/auth/roles";

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

describe("invite token embedding", () => {
  it("embeds and parses user id", () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    const { token, tokenHash, expiresAt } = generateInviteTokenForUser(userId);
    expect(parseInviteTokenUserId(token)).toBe(userId);
    expect(hashToken(token)).toBe(tokenHash);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for malformed tokens", () => {
    expect(parseInviteTokenUserId("nodot")).toBeNull();
    expect(parseInviteTokenUserId(".onlysuffix")).toBeNull();
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
  });

  it("parses app metadata roles", () => {
    expect(parseAppMetadataRole("TEACHER")).toBe("TEACHER");
    expect(parseAppMetadataRole("nope")).toBeNull();
  });

  it("enforces path prefixes; legacy null role passes", () => {
    expect(enforceRolePrefix("/admin/schools", null).ok).toBe(true);
    expect(enforceRolePrefix("/admin/schools", "TEACHER").ok).toBe(false);
    expect(enforceRolePrefix("/school-head", "SCHOOL_HEAD").ok).toBe(true);
    expect(enforceRolePrefix("/school-head", "TEACHER").ok).toBe(false);
    expect(enforceRolePrefix("/teacher", "SUPER_ADMIN").ok).toBe(true);
    expect(enforceRolePrefix("/account/password", "TEACHER").ok).toBe(true);
  });
});
