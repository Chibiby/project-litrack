import { describe, expect, it } from "vitest";
import {
  decideAvatarModeration,
  type AvatarModerationActor,
  type AvatarModerationTarget,
} from "@/lib/avatars/authorize";

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

function actor(over: Partial<AvatarModerationActor> = {}): AvatarModerationActor {
  return { id: "user-1", role: "TEACHER", schoolId: SCHOOL_A, ...over };
}

function target(over: Partial<AvatarModerationTarget> = {}): AvatarModerationTarget {
  return {
    id: "user-2",
    role: "TEACHER",
    schoolId: SCHOOL_A,
    deletedAt: null,
    avatarPath: "user-2/0b8f4f2e-1c3a-4d5e-9a6b-7c8d9e0f1a2b.webp",
    ...over,
  };
}

describe("decideAvatarModeration", () => {
  it("returns not_found (not cross-tenant) when the target does not exist", () => {
    expect(decideAvatarModeration(actor(), null)).toEqual({
      kind: "not_found",
      crossTenant: false,
    });
  });

  describe("self", () => {
    it("removes the actor's own photo", () => {
      const self = actor({ id: "user-1" });
      const own = target({ id: "user-1", schoolId: SCHOOL_A });
      expect(decideAvatarModeration(self, own)).toEqual({
        kind: "remove",
        path: own.avatarPath,
        basis: "self",
      });
    });

    it("reports nothing_to_remove when the actor already has no photo", () => {
      const self = actor({ id: "user-1" });
      const own = target({ id: "user-1", avatarPath: null });
      expect(decideAvatarModeration(self, own)).toEqual({ kind: "nothing_to_remove" });
    });

    it("refuses a soft-deleted self row for a non-Super-Admin actor", () => {
      const self = actor({ id: "user-1", role: "TEACHER" });
      const own = target({ id: "user-1", deletedAt: new Date() });
      expect(decideAvatarModeration(self, own)).toEqual({
        kind: "not_found",
        crossTenant: false,
      });
    });
  });

  describe("Super Admin", () => {
    it("removes any target's photo, regardless of role", () => {
      const admin = actor({ id: "admin-1", role: "SUPER_ADMIN", schoolId: null });
      const teacher = target({ role: "TEACHER", schoolId: SCHOOL_B });
      const schoolHead = target({ id: "user-3", role: "SCHOOL_HEAD", schoolId: SCHOOL_B });
      expect(decideAvatarModeration(admin, teacher)).toMatchObject({
        kind: "remove",
        basis: "super_admin",
      });
      expect(decideAvatarModeration(admin, schoolHead)).toMatchObject({
        kind: "remove",
        basis: "super_admin",
      });
    });

    it("removes another Super Admin's photo", () => {
      const admin = actor({ id: "admin-1", role: "SUPER_ADMIN", schoolId: null });
      const otherAdmin = target({ id: "admin-2", role: "SUPER_ADMIN", schoolId: null });
      expect(decideAvatarModeration(admin, otherAdmin)).toEqual({
        kind: "remove",
        path: otherAdmin.avatarPath,
        basis: "super_admin",
      });
    });

    it("still acts on a soft-deleted target", () => {
      const admin = actor({ id: "admin-1", role: "SUPER_ADMIN", schoolId: null });
      const deleted = target({ deletedAt: new Date() });
      expect(decideAvatarModeration(admin, deleted)).toMatchObject({
        kind: "remove",
        basis: "super_admin",
      });
    });

    it("reports nothing_to_remove for a Super Admin target with no photo", () => {
      const admin = actor({ id: "admin-1", role: "SUPER_ADMIN", schoolId: null });
      const noPhoto = target({ role: "SUPER_ADMIN", schoolId: null, avatarPath: null });
      expect(decideAvatarModeration(admin, noPhoto)).toEqual({ kind: "nothing_to_remove" });
    });
  });

  describe("School Head", () => {
    it("removes a same-school, non-deleted teacher's photo", () => {
      const head = actor({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      const teacher = target({ schoolId: SCHOOL_A });
      expect(decideAvatarModeration(head, teacher)).toEqual({
        kind: "remove",
        path: teacher.avatarPath,
        basis: "school_head",
      });
    });

    it("reports nothing_to_remove for a same-school teacher with no photo", () => {
      const head = actor({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      const teacher = target({ schoolId: SCHOOL_A, avatarPath: null });
      expect(decideAvatarModeration(head, teacher)).toEqual({ kind: "nothing_to_remove" });
    });

    it("refuses a cross-tenant teacher with crossTenant: true", () => {
      const head = actor({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      const teacher = target({ schoolId: SCHOOL_B });
      expect(decideAvatarModeration(head, teacher)).toEqual({
        kind: "not_found",
        crossTenant: true,
      });
    });

    it("never reports nothing_to_remove for a cross-tenant target, even with no photo", () => {
      const head = actor({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      const teacher = target({ schoolId: SCHOOL_B, avatarPath: null });
      expect(decideAvatarModeration(head, teacher)).toEqual({
        kind: "not_found",
        crossTenant: true,
      });
    });

    it("refuses a same-school non-teacher with crossTenant: false", () => {
      const head = actor({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      const otherHead = target({ role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      expect(decideAvatarModeration(head, otherHead)).toEqual({
        kind: "not_found",
        crossTenant: false,
      });
    });

    it("refuses a same-school soft-deleted teacher with crossTenant: false", () => {
      const head = actor({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      const teacher = target({ schoolId: SCHOOL_A, deletedAt: new Date() });
      expect(decideAvatarModeration(head, teacher)).toEqual({
        kind: "not_found",
        crossTenant: false,
      });
    });

    it("refuses a Super Admin target with crossTenant: false", () => {
      const head = actor({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });
      const admin = target({ role: "SUPER_ADMIN", schoolId: null });
      expect(decideAvatarModeration(head, admin)).toEqual({
        kind: "not_found",
        crossTenant: false,
      });
    });
  });

  describe("Teacher", () => {
    it("refuses to act on any other user in the same school", () => {
      const teacher = actor({ id: "user-1", role: "TEACHER", schoolId: SCHOOL_A });
      const other = target({ id: "user-2", schoolId: SCHOOL_A });
      expect(decideAvatarModeration(teacher, other)).toEqual({
        kind: "not_found",
        crossTenant: false,
      });
    });

    it("refuses cross-tenant with crossTenant: true", () => {
      const teacher = actor({ id: "user-1", role: "TEACHER", schoolId: SCHOOL_A });
      const other = target({ id: "user-2", schoolId: SCHOOL_B });
      expect(decideAvatarModeration(teacher, other)).toEqual({
        kind: "not_found",
        crossTenant: true,
      });
    });
  });
});
