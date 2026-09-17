"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { readTestLabSession } from "@/lib/auth/test-lab";
import { readImpersonationContext } from "@/lib/auth/impersonation";
import { checkRateLimit } from "@/lib/rate-limit";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { notifyProfilePhotoRemoved } from "@/lib/notifications";
import { revalidateUserAvatar } from "@/lib/cache/revalidate";
import { putAvatarObjects, removeAvatarObjects } from "@/lib/supabase/avatar-storage";
import {
  AVATAR_FULL_MAX_BYTES,
  AVATAR_THUMB_MAX_BYTES,
  AVATAR_UPLOAD_RATE_LIMIT,
} from "@/lib/avatars/limits";
import { buildAvatarPaths, thumbPathFor } from "@/lib/avatars/paths";
import { validateAvatarUpload } from "@/lib/avatars/validate-upload";
import { decideAvatarModeration } from "@/lib/avatars/authorize";
import { avatarModerationSchema } from "@/lib/validators/avatar.schema";

/**
 * Profile photos: set your own, remove your own, take someone else's down.
 *
 * Every policy decision here is made by a pure module and every one of them is
 * made *before* anything is written:
 *
 * - `validateAvatarUpload` decides whether the bytes are a photo we will store.
 *   The client's claimed MIME type is never consulted; the magic bytes are.
 * - `decideAvatarModeration` decides who may remove whose. Every refusal it can
 *   return collapses to one generic NOT_FOUND, so a School Head probing another
 *   school's ids cannot tell a missing account from a real one.
 *
 * The write order for an upload is the one thing in this file that must not be
 * rearranged: upload the objects, THEN compare-and-swap `avatarPath`, THEN
 * delete the previous objects. Deleting before the swap would break a live
 * avatar if the swap then failed, and swapping before the upload would point
 * the column at bytes that do not exist yet. An object is deleted only after a
 * CAS this request won — that is the whole of invariant 6.
 *
 * `avatarPath` is never read inside `cachedQuery`; see `revalidateUserAvatar`.
 */

/** The three roles that have a photo. All of them, i.e. everyone who can sign in. */
const PHOTO_ROLES = ["TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] as const;

export type UploadOwnAvatarResult =
  | { ok: true; dryRun: true }
  | { ok: true; avatarPath: string };

export type RemoveAvatarResult = { ok: true; dryRun?: true };

/**
 * A `photo`/`thumb` FormData entry, or null when the field is missing or the
 * client sent a plain string. `FormDataEntryValue` is `File | string`, so the
 * `typeof` is the whole of the narrowing.
 */
function uploadedFile(value: FormDataEntryValue | null): File | null {
  return value === null || typeof value === "string" ? null : value;
}

/** One message for every way the bytes can be unusable — see docs/errors.md. */
function invalidUpload(detail: string): AppError {
  return new AppError("AVATAR_FILE_INVALID", { detail });
}

/**
 * Set the signed-in person's own photo.
 *
 * No target argument, by design (invariant 2): there is no id here to get
 * wrong, so no path by which one account can set another's picture.
 *
 * The guard order is deliberate and is the order the spec fixes:
 *
 * 1. `requireUser` — nothing before the auth guard.
 * 2. Test Lab, which returns before every write, including the storage upload.
 * 3. Impersonation. It comes *after* Test Lab because a Test Lab session is
 *    itself an impersonation: a demo account trying its Settings page should
 *    see the dry-run preview, not a refusal. For a real account the refusal
 *    stands — an admin signed in as somebody else may take a photo down
 *    (`removeOwnAvatar`), but may never put one up in their name.
 * 4. The rate limit, so a refused upload is not charged against the quota of
 *    the person whose account it is.
 */
export const uploadOwnAvatar = action(
  "uploadOwnAvatar",
  async (formData: FormData): Promise<UploadOwnAvatarResult> => {
    const user = await requireUser([...PHOTO_ROLES]);

    if (await readTestLabSession(user)) return { ok: true, dryRun: true };

    // An expired-but-valid ticket counts, same conservative direction
    // `readTestLabSession` takes: for a check whose answer is "refuse", the
    // unproven case must keep the refusal.
    const impersonation = await readImpersonationContext();
    if (impersonation && impersonation.ticket.targetUserId === user.id) {
      throw new AppError("AUTH_FORBIDDEN", {
        params: { what: "uploading a photo for an account you are signed in as" },
        detail: `impersonated upload refused for user ${user.id}`,
        context: { userId: user.id },
      });
    }

    const rate = await checkRateLimit(`avatar:${user.id}`, AVATAR_UPLOAD_RATE_LIMIT);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const photoFile = uploadedFile(formData.get("photo"));
    const thumbFile = uploadedFile(formData.get("thumb"));
    if (!photoFile || !thumbFile) throw invalidUpload("photo or thumb missing from the form");

    // `size` first: refusing here means the oversized body is never copied into
    // this process's memory. `validateAvatarUpload` checks the same ceilings
    // against the real byte length afterwards, because `size` is the client's
    // word for it and the stored bytes are what the limit is actually about.
    if (photoFile.size > AVATAR_FULL_MAX_BYTES || thumbFile.size > AVATAR_THUMB_MAX_BYTES) {
      throw new AppError("AVATAR_FILE_TOO_LARGE", {
        detail: `declared sizes full=${photoFile.size} thumb=${thumbFile.size}`,
      });
    }

    const full = new Uint8Array(await photoFile.arrayBuffer());
    const thumb = new Uint8Array(await thumbFile.arrayBuffer());

    const validated = validateAvatarUpload({ full, thumb });
    if (!validated.ok) {
      if (validated.reason === "too_large") {
        throw new AppError("AVATAR_FILE_TOO_LARGE", {
          detail: `stored sizes full=${full.byteLength} thumb=${thumb.byteLength}`,
        });
      }
      throw invalidUpload("uploaded bytes failed avatar validation");
    }

    // A fresh id every time, with `upsert: false` in the storage helper: no
    // upload can overwrite an object, not even the same person's own.
    const objectId = randomUUID();
    const paths = buildAvatarPaths(user.id, objectId, validated.ext);

    await putAvatarObjects({
      userId: user.id,
      objectId,
      ext: validated.ext,
      mime: validated.mime,
      full,
      thumb,
    });

    const previous = user.avatarPath;
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, avatarPath: previous },
      data: { avatarPath: paths.full },
    });
    if (count === 0) {
      // Another request changed the photo between the read and this write. The
      // objects just uploaded are unreferenced and nothing else points at them,
      // so they go; the previous pair is left alone, because whatever won the
      // race may be using it.
      await removeAvatarObjects([paths.full, paths.thumb]);
      throw new AppError("AVATAR_CHANGED", {
        detail: `avatar CAS lost for user ${user.id}`,
      });
    }

    if (previous) {
      await removeAvatarObjects([previous, thumbPathFor(previous)]);
    }

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.USER_AVATAR_UPLOAD,
      resource: "User",
      resourceId: user.id,
      metadata: {
        path: paths.full,
        thumbPath: paths.thumb,
        previousPath: previous,
        mime: validated.mime,
        fullBytes: full.byteLength,
        thumbBytes: thumb.byteLength,
      },
    });

    revalidateUserAvatar({ role: user.role, schoolId: user.schoolId });

    return { ok: true, avatarPath: paths.full };
  },
  { verb: "save your profile photo" }
);

/**
 * Remove the signed-in person's own photo.
 *
 * Allowed while impersonating, unlike upload: an admin signed in as an account
 * whose photo has to come down should be able to take it down, and doing so
 * puts nothing of the admin's into the account.
 *
 * No photo at all is a no-op rather than an error — a second click, or a second
 * tab, has nothing to report.
 */
export const removeOwnAvatar = action(
  "removeOwnAvatar",
  async (): Promise<RemoveAvatarResult> => {
    const user = await requireUser([...PHOTO_ROLES]);

    if (await readTestLabSession(user)) return { ok: true, dryRun: true };

    const previous = user.avatarPath;
    if (!previous) return { ok: true };

    const { count } = await prisma.user.updateMany({
      where: { id: user.id, avatarPath: previous },
      data: { avatarPath: null },
    });
    if (count === 0) {
      // Lost the race. Whatever is on the account now was put there by another
      // request, and its objects are not this one's to delete.
      throw new AppError("AVATAR_CHANGED", {
        detail: `avatar removal CAS lost for user ${user.id}`,
      });
    }

    await removeAvatarObjects([previous, thumbPathFor(previous)]);

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.USER_AVATAR_REMOVE,
      resource: "User",
      resourceId: user.id,
      metadata: { path: previous, thumbPath: thumbPathFor(previous) },
    });

    revalidateUserAvatar({ role: user.role, schoolId: user.schoolId });

    return { ok: true };
  },
  { verb: "remove your profile photo" }
);

/**
 * Take another account's photo down.
 *
 * `requireUser("SCHOOL_HEAD")` admits a Super Admin too, as it does everywhere
 * — so the role is NOT assumed from the guard. The actor's real role is handed
 * to `decideAvatarModeration`, which is the only thing that decides whether
 * this removal happens and on what basis.
 *
 * The tenant story: the target row is loaded by id with no school filter,
 * because a Super Admin is division-wide and has no school to filter by. That
 * is safe precisely because nothing is done with the row until
 * `decideAvatarModeration` has answered — a School Head gets `not_found` for
 * any target outside their own school, for any target that is not a live
 * TEACHER, and the two are worded identically. Only the refusal's admin-side
 * record says `crossTenant`; the person sees the same sentence either way.
 *
 * Everything after the decision uses the TARGET's `schoolId` and role — the
 * audit row, the notification, the cache bust — never the actor's, which for a
 * Super Admin is null.
 */
export const removeUserAvatar = action(
  "removeUserAvatar",
  async (formData: FormData): Promise<RemoveAvatarResult> => {
    const actor = await requireUser("SCHOOL_HEAD");
    const { userId } = parseInput(avatarModerationSchema, { userId: formData.get("userId") });

    if (await readTestLabSession(actor)) return { ok: true, dryRun: true };

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, schoolId: true, deletedAt: true, avatarPath: true },
    });

    const decision = decideAvatarModeration(
      { id: actor.id, role: actor.role, schoolId: actor.schoolId },
      target
    );

    if (decision.kind === "not_found") {
      // `crossTenant` upgrades this to `security`, which is what puts it in
      // ErrorEvent with the flag attached. The sentence the person reads is
      // byte-identical to the one a genuinely missing account produces.
      throw resourceNotFound("Account", {
        crossTenant: decision.crossTenant,
        detail: `avatar moderation refused: actor ${actor.id} (${actor.role}) -> ${userId}`,
      });
    }

    // Authorized, but there is no photo. Nothing to write, nothing to audit,
    // nobody to notify — checked after authorization on purpose, so "no photo"
    // and "not yours to touch" cannot be told apart by an outsider.
    if (decision.kind === "nothing_to_remove") return { ok: true };

    // `target` is non-null on this branch: only a loaded row can produce
    // `remove`.
    const removed = target as NonNullable<typeof target>;
    const isSelf = removed.id === actor.id;

    const { count } = await prisma.user.updateMany({
      where: { id: removed.id, avatarPath: decision.path },
      data: { avatarPath: null },
    });
    if (count === 0) {
      throw new AppError("AVATAR_CHANGED", {
        detail: `avatar moderation CAS lost for user ${removed.id}`,
      });
    }

    await removeAvatarObjects([decision.path, thumbPathFor(decision.path)]);

    await writeAudit({
      userId: actor.id,
      schoolId: removed.schoolId,
      action: isSelf
        ? AUDIT_ACTIONS.USER_AVATAR_REMOVE
        : AUDIT_ACTIONS.USER_AVATAR_MODERATE_REMOVE,
      resource: "User",
      resourceId: removed.id,
      metadata: {
        path: decision.path,
        thumbPath: thumbPathFor(decision.path),
        basis: decision.basis,
        crossTenant: false,
        targetRole: removed.role,
      },
    });

    // Only when somebody else did it, and only when there is a school to hang
    // the row on: `Notification.schoolId` is required, and a Super Admin target
    // has none. No placeholder is invented for that case — the removal simply
    // goes unannounced, which is what the spec decided.
    if (!isSelf && removed.schoolId) {
      await notifyProfilePhotoRemoved({
        schoolId: removed.schoolId,
        recipientId: removed.id,
        actorId: actor.id,
      });
    }

    revalidateUserAvatar({ role: removed.role, schoolId: removed.schoolId });

    return { ok: true };
  },
  { verb: "remove the profile photo" }
);
