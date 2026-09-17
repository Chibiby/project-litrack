/**
 * Avatar moderation authorization: one pure function, so the action layer
 * (`src/lib/actions/avatar.ts`) and its tests share exactly one policy.
 * Every refusal collapses to the same generic `not_found` so existence in
 * another tenant never leaks — only `crossTenant` (for the audit record)
 * says whether it actually was cross-tenant. Pure, no `server-only`.
 */

import type { UserRole } from "@prisma/client";

export type AvatarModerationActor = {
  id: string;
  role: UserRole;
  schoolId: string | null;
};

export type AvatarModerationTarget = {
  id: string;
  role: UserRole;
  schoolId: string | null;
  deletedAt: Date | null;
  avatarPath: string | null;
};

export type AvatarModerationBasis = "self" | "school_head" | "super_admin";

export type AvatarModerationDecision =
  | { kind: "remove"; path: string; basis: AvatarModerationBasis }
  | { kind: "nothing_to_remove" }
  | { kind: "not_found"; crossTenant: boolean };

export function decideAvatarModeration(
  actor: AvatarModerationActor,
  target: AvatarModerationTarget | null
): AvatarModerationDecision {
  if (!target) return { kind: "not_found", crossTenant: false };

  let basis: AvatarModerationBasis;

  if (actor.id === target.id) {
    // A soft-deleted account is not_found for everyone except a Super Admin,
    // who may still remove a photo from a soft-deleted row.
    if (target.deletedAt !== null && actor.role !== "SUPER_ADMIN") {
      return { kind: "not_found", crossTenant: false };
    }
    basis = "self";
  } else if (actor.role === "SUPER_ADMIN") {
    // Any target, including soft-deleted ones.
    basis = "super_admin";
  } else if (actor.role === "SCHOOL_HEAD") {
    if (!target.schoolId) return { kind: "not_found", crossTenant: false };
    if (target.schoolId !== actor.schoolId) {
      return { kind: "not_found", crossTenant: true };
    }
    if (target.role !== "TEACHER" || target.deletedAt !== null) {
      return { kind: "not_found", crossTenant: false };
    }
    basis = "school_head";
  } else {
    // TEACHER (or any other role) acting on someone else: always refused.
    const crossTenant = Boolean(target.schoolId) && target.schoolId !== actor.schoolId;
    return { kind: "not_found", crossTenant };
  }

  if (!target.avatarPath) return { kind: "nothing_to_remove" };
  return { kind: "remove", path: target.avatarPath, basis };
}
