import { beforeEach, describe, expect, it, vi } from "vitest";
import { thumbPathFor } from "@/lib/avatars/paths";
import { buildWebpVp8, textBytes } from "../avatars/fixtures";

/**
 * `src/lib/actions/avatar.ts` — upload/remove-your-own and moderation removal.
 *
 * Only leaf infrastructure is mocked: Prisma, `requireUser`, Test Lab,
 * impersonation, the rate limiter, audit, notifications, cache invalidation,
 * and the Supabase admin client (as a fake storage bucket, so the real
 * `putAvatarObjects`/`removeAvatarObjects` in `@/lib/supabase/avatar-storage`
 * run for real). `decideAvatarModeration`, `validateAvatarUpload`, `sniffImage`,
 * `buildAvatarPaths`/`thumbPathFor`, and the Zod schema all run for real —
 * they are the policy this file exists to prove, and each already has its own
 * unit tests (`tests/unit/avatars/*.test.ts`) this file does not duplicate.
 *
 * Every File fixture is a real, well-formed WebP (`buildWebpVp8` from
 * `tests/unit/avatars/fixtures.ts`) so `sniffImage`/`validateAvatarUpload`
 * genuinely accept it rather than being told to.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const IMPERSONATED_ID = "22222222-2222-4222-8222-222222222222";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";

const HEAD_ID = "head-1";
const ADMIN_ID = "admin-1";

const TEACHER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_SCHOOL_TEACHER_ID = "44444444-4444-4444-8444-444444444444";
const SCHOOL_HEAD_TARGET_ID = "55555555-5555-4555-8555-555555555555";
const DELETED_TEACHER_ID = "66666666-6666-4666-8666-666666666666";
const SUPER_ADMIN_TARGET_ID = "77777777-7777-4777-8777-777777777777";
const NONEXISTENT_ID = "88888888-8888-4888-8888-888888888888";
const ACTOR_TEACHER_ID = "99999999-9999-4999-8999-999999999999";

/** Cross-module call order, so "storage before Prisma before audit" is provable. */
let order: string[];

// ── prisma ───────────────────────────────────────────────────────────────

const updateMany = vi.fn();
const userFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get updateMany() {
        return updateMany;
      },
      get findUnique() {
        return userFindUnique;
      },
    },
  },
}));

// ── session / test lab / impersonation ──────────────────────────────────

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const readTestLabSession = vi.fn();
vi.mock("@/lib/auth/test-lab", () => ({
  readTestLabSession: (...args: unknown[]) => readTestLabSession(...args),
}));

const readImpersonationContext = vi.fn();
vi.mock("@/lib/auth/impersonation", () => ({
  readImpersonationContext: () => readImpersonationContext(),
}));

// ── rate limit ───────────────────────────────────────────────────────────

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

// ── audit / notifications / cache ───────────────────────────────────────

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: {
    USER_AVATAR_UPLOAD: "USER_AVATAR_UPLOAD",
    USER_AVATAR_REMOVE: "USER_AVATAR_REMOVE",
    USER_AVATAR_MODERATE_REMOVE: "USER_AVATAR_MODERATE_REMOVE",
  },
}));

const notifyProfilePhotoRemoved = vi.fn();
vi.mock("@/lib/notifications", () => ({
  notifyProfilePhotoRemoved: (...args: unknown[]) => notifyProfilePhotoRemoved(...args),
}));

const revalidateUserAvatar = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateUserAvatar: (...args: unknown[]) => revalidateUserAvatar(...args),
}));

// ── Supabase storage — fake bucket behind the real avatar-storage.ts ────
//
// Not mocking `@/lib/supabase/avatar-storage` itself: its `putAvatarObjects`/
// `removeAvatarObjects` are the code that decides `upsert`, `contentType` and
// `cacheControl`, and that decision is exactly what several tests below pin.
// Faking only the Supabase client one layer down keeps that logic real while
// still recording every call.

const bucketUpload = vi.fn();
const bucketRemove = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => bucketUpload(...args),
        remove: (...args: unknown[]) => bucketRemove(...args),
      }),
    },
  }),
}));

const { uploadOwnAvatar, removeOwnAvatar, removeUserAvatar } = await import(
  "@/lib/actions/avatar"
);

// ── fixtures ─────────────────────────────────────────────────────────────

function fileFrom(bytes: Uint8Array, name: string, type = "image/webp"): File {
  // `Uint8Array<ArrayBufferLike>` (Node's lib) isn't assignable to DOM's
  // `BlobPart` in strict mode; every fixture here is a fresh, exactly-sized
  // buffer, so handing `File` the raw `ArrayBuffer` is exact and type-safe.
  return new File([bytes.buffer as ArrayBuffer], name, { type });
}

function validFullFile(): File {
  return fileFrom(buildWebpVp8({ width: 512, height: 512 }), "photo.webp");
}

function validThumbFile(): File {
  return fileFrom(buildWebpVp8({ width: 128, height: 128 }), "thumb.webp");
}

function oversizedFile(byteLength: number, name: string): File {
  return fileFrom(new Uint8Array(byteLength), name);
}

function invalidImageFile(): File {
  return fileFrom(textBytes("this is plainly not an image"), "photo.webp");
}

function uploadForm(photo: File | null, thumb: File | null): FormData {
  const form = new FormData();
  if (photo) form.set("photo", photo);
  if (thumb) form.set("thumb", thumb);
  return form;
}

function removalForm(userId: string): FormData {
  const form = new FormData();
  form.set("userId", userId);
  return form;
}

function avatarPathPattern(userId: string): RegExp {
  return new RegExp(
    `^${userId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  order = [];

  requireUser.mockResolvedValue({
    id: USER_ID,
    role: "TEACHER",
    schoolId: SCHOOL_ID,
    avatarPath: null,
  });
  readTestLabSession.mockResolvedValue(false);
  readImpersonationContext.mockResolvedValue(null);
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  userFindUnique.mockResolvedValue(null);

  updateMany.mockImplementation(async () => {
    order.push("prisma.updateMany");
    return { count: 1 };
  });
  bucketUpload.mockImplementation(async () => {
    order.push("storage.upload");
    return { error: null };
  });
  bucketRemove.mockImplementation(async () => {
    order.push("storage.remove");
    return { error: null };
  });
  writeAudit.mockImplementation(async () => {
    order.push("writeAudit");
  });
  notifyProfilePhotoRemoved.mockImplementation(async () => {
    order.push("notifyProfilePhotoRemoved");
  });
  revalidateUserAvatar.mockImplementation(() => {
    order.push("revalidateUserAvatar");
  });

  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── uploadOwnAvatar ────────────────────────────────────────────────────────

describe("uploadOwnAvatar", () => {
  it("refuses a rate-limited caller with no storage call and no Prisma write", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 900_000 });

    const res = await uploadOwnAvatar(uploadForm(validFullFile(), validThumbFile()));

    expect(res).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(bucketUpload).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each<[string, File | null, File | null]>([
    ["missing photo", null, validThumbFile()],
    ["missing thumb", validFullFile(), null],
    ["missing both", null, null],
  ])("%s ⇒ AVATAR_FILE_INVALID, no storage call", async (_label, photo, thumb) => {
    const res = await uploadOwnAvatar(uploadForm(photo, thumb));

    expect(res).toMatchObject({ ok: false, code: "AVATAR_FILE_INVALID" });
    expect(bucketUpload).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuses a declared size over the ceiling before any buffering or storage call", async () => {
    const arrayBufferSpy = vi.spyOn(File.prototype, "arrayBuffer");
    const oversizedPhoto = oversizedFile(1024 * 1024 + 1, "photo.webp");

    const res = await uploadOwnAvatar(uploadForm(oversizedPhoto, validThumbFile()));

    expect(res).toMatchObject({ ok: false, code: "AVATAR_FILE_TOO_LARGE" });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(bucketUpload).not.toHaveBeenCalled();
    arrayBufferSpy.mockRestore();
  });

  it("refuses bytes that fail validateAvatarUpload, with no storage call", async () => {
    const res = await uploadOwnAvatar(uploadForm(invalidImageFile(), validThumbFile()));

    expect(res).toMatchObject({ ok: false, code: "AVATAR_FILE_INVALID" });
    expect(bucketUpload).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("happy path: storage upload → CAS updateMany → remove the PREVIOUS pair → audit → revalidate, in that order", async () => {
    const previous = `${USER_ID}/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.png`;
    requireUser.mockResolvedValue({
      id: USER_ID,
      role: "TEACHER",
      schoolId: SCHOOL_ID,
      avatarPath: previous,
    });

    const res = await uploadOwnAvatar(uploadForm(validFullFile(), validThumbFile()));

    expect(res).toMatchObject({ ok: true });
    const avatarPath = (res as { ok: true; avatarPath: string }).avatarPath;
    expect(avatarPath).toMatch(avatarPathPattern(USER_ID));

    expect(order).toEqual([
      "storage.upload", // full
      "storage.upload", // thumb
      "prisma.updateMany",
      "storage.remove",
      "writeAudit",
      "revalidateUserAvatar",
    ]);

    // The CAS is scoped to this user, reading the PREVIOUS path.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, avatarPath: previous },
      data: { avatarPath },
    });

    // Only the PREVIOUS pair is deleted — never the pair just uploaded.
    expect(bucketRemove).toHaveBeenCalledTimes(1);
    expect(bucketRemove).toHaveBeenCalledWith([previous, thumbPathFor(previous)]);
  });

  it("uploads with upsert: false, contentType from the sniffed mime, and cacheControl \"86400\"", async () => {
    await uploadOwnAvatar(uploadForm(validFullFile(), validThumbFile()));

    expect(bucketUpload).toHaveBeenCalledTimes(2);
    for (const call of bucketUpload.mock.calls) {
      const options = call[2] as Record<string, unknown>;
      expect(options).toEqual({
        contentType: "image/webp",
        cacheControl: "86400",
        upsert: false,
      });
    }
  });

  it("when the CAS loses the race: removes the NEW objects, leaves the PREVIOUS pair, and returns AVATAR_CHANGED", async () => {
    const previous = `${USER_ID}/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb.png`;
    requireUser.mockResolvedValue({
      id: USER_ID,
      role: "TEACHER",
      schoolId: SCHOOL_ID,
      avatarPath: previous,
    });
    updateMany.mockImplementation(async () => {
      order.push("prisma.updateMany");
      return { count: 0 };
    });

    const res = await uploadOwnAvatar(uploadForm(validFullFile(), validThumbFile()));

    expect(res).toMatchObject({ ok: false, code: "AVATAR_CHANGED" });

    const newFullPath = bucketUpload.mock.calls[0][0] as string;
    const newThumbPath = bucketUpload.mock.calls[1][0] as string;
    expect(newFullPath).toMatch(avatarPathPattern(USER_ID));

    expect(bucketRemove).toHaveBeenCalledTimes(1);
    expect(bucketRemove).toHaveBeenCalledWith([newFullPath, newThumbPath]);
    // The previous pair — still referenced by whatever won the race — is untouched.
    expect(bucketRemove).not.toHaveBeenCalledWith([previous, thumbPathFor(previous)]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a Super Admin impersonating the account, with no storage call; removeOwnAvatar in the same state is allowed", async () => {
    const previous = `${IMPERSONATED_ID}/cccccccc-3333-4333-8333-cccccccccccc.png`;
    requireUser.mockResolvedValue({
      id: IMPERSONATED_ID,
      role: "SCHOOL_HEAD",
      schoolId: SCHOOL_ID,
      avatarPath: previous,
    });
    readImpersonationContext.mockResolvedValue({
      ticket: { targetUserId: IMPERSONATED_ID },
      expired: false,
    });

    const uploadRes = await uploadOwnAvatar(uploadForm(validFullFile(), validThumbFile()));
    expect(uploadRes).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(bucketUpload).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();

    const removeRes = await removeOwnAvatar();
    expect(removeRes).toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: IMPERSONATED_ID, avatarPath: previous },
      data: { avatarPath: null },
    });
    expect(bucketRemove).toHaveBeenCalledWith([previous, thumbPathFor(previous)]);
  });

  it("a Test Lab session writes nothing: zero storage, Prisma, audit and notification calls", async () => {
    readTestLabSession.mockResolvedValue(true);

    const res = await uploadOwnAvatar(uploadForm(validFullFile(), validThumbFile()));

    expect(res).toEqual({ ok: true, dryRun: true });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(bucketUpload).not.toHaveBeenCalled();
    expect(bucketRemove).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(notifyProfilePhotoRemoved).not.toHaveBeenCalled();
  });
});

describe("removeOwnAvatar — Test Lab", () => {
  it("writes nothing in a Test Lab session", async () => {
    readTestLabSession.mockResolvedValue(true);
    requireUser.mockResolvedValue({
      id: USER_ID,
      role: "TEACHER",
      schoolId: SCHOOL_ID,
      avatarPath: `${USER_ID}/dddddddd-4444-4444-8444-dddddddddddd.png`,
    });

    const res = await removeOwnAvatar();

    expect(res).toEqual({ ok: true, dryRun: true });
    expect(updateMany).not.toHaveBeenCalled();
    expect(bucketRemove).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

// ── removeUserAvatar ─────────────────────────────────────────────────────

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: TEACHER_ID,
    role: "TEACHER",
    schoolId: SCHOOL_ID,
    deletedAt: null,
    avatarPath: `${TEACHER_ID}/eeeeeeee-5555-4555-8555-eeeeeeeeeeee.png`,
    ...overrides,
  };
}

describe("removeUserAvatar", () => {
  it("School Head removes a same-school teacher's photo: CAS on the TARGET id, audit/notification/revalidate use the TARGET", async () => {
    requireUser.mockResolvedValue({ id: HEAD_ID, role: "SCHOOL_HEAD", schoolId: SCHOOL_ID });
    const row = target();
    userFindUnique.mockResolvedValue(row);

    const res = await removeUserAvatar(removalForm(TEACHER_ID));

    expect(res).toEqual({ ok: true });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: TEACHER_ID, avatarPath: row.avatarPath },
      data: { avatarPath: null },
    });
    expect(bucketRemove).toHaveBeenCalledWith([row.avatarPath, thumbPathFor(row.avatarPath)]);

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HEAD_ID,
        schoolId: SCHOOL_ID, // the TARGET's schoolId, not the actor's
        action: "USER_AVATAR_MODERATE_REMOVE",
        resource: "User",
        resourceId: TEACHER_ID,
      })
    );

    expect(notifyProfilePhotoRemoved).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      recipientId: TEACHER_ID, // target
      actorId: HEAD_ID, // actor
    });

    expect(revalidateUserAvatar).toHaveBeenCalledWith({ role: "TEACHER", schoolId: SCHOOL_ID });
  });

  it("gives a School Head targeting another school's teacher the IDENTICAL error string as a non-existent id, and writes nothing either way", async () => {
    requireUser.mockResolvedValue({ id: HEAD_ID, role: "SCHOOL_HEAD", schoolId: SCHOOL_ID });

    userFindUnique.mockResolvedValue(
      target({ id: OTHER_SCHOOL_TEACHER_ID, schoolId: OTHER_SCHOOL_ID })
    );
    const crossTenantRes = await removeUserAvatar(removalForm(OTHER_SCHOOL_TEACHER_ID));
    expect(crossTenantRes).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(bucketRemove).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(notifyProfilePhotoRemoved).not.toHaveBeenCalled();

    userFindUnique.mockResolvedValue(null);
    const missingRes = await removeUserAvatar(removalForm(NONEXISTENT_ID));
    expect(missingRes).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(bucketRemove).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();

    // The tenancy invariant: existence in another tenant must not leak, so the
    // sentence the person reads has to be byte-identical either way.
    expect((crossTenantRes as { error: string }).error).toBe(
      (missingRes as { error: string }).error
    );
  });

  it("gives the same generic refusal for a SCHOOL_HEAD target or a soft-deleted teacher in the actor's own school", async () => {
    requireUser.mockResolvedValue({ id: HEAD_ID, role: "SCHOOL_HEAD", schoolId: SCHOOL_ID });

    userFindUnique.mockResolvedValue(
      target({ id: SCHOOL_HEAD_TARGET_ID, role: "SCHOOL_HEAD" })
    );
    const headTargetRes = await removeUserAvatar(removalForm(SCHOOL_HEAD_TARGET_ID));
    expect(headTargetRes).toMatchObject({ ok: false, code: "NOT_FOUND" });

    userFindUnique.mockResolvedValue(
      target({ id: DELETED_TEACHER_ID, deletedAt: new Date() })
    );
    const deletedRes = await removeUserAvatar(removalForm(DELETED_TEACHER_ID));
    expect(deletedRes).toMatchObject({ ok: false, code: "NOT_FOUND" });

    expect((headTargetRes as { error: string }).error).toBe(
      (deletedRes as { error: string }).error
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a teacher targeting another teacher", async () => {
    requireUser.mockResolvedValue({ id: ACTOR_TEACHER_ID, role: "TEACHER", schoolId: SCHOOL_ID });
    userFindUnique.mockResolvedValue(target());

    const res = await removeUserAvatar(removalForm(TEACHER_ID));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(bucketRemove).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("allows a Super Admin against any school, and against another Super Admin (schoolId null) with no notification and no crash", async () => {
    requireUser.mockResolvedValue({ id: ADMIN_ID, role: "SUPER_ADMIN", schoolId: null });

    userFindUnique.mockResolvedValue(
      target({ id: OTHER_SCHOOL_TEACHER_ID, schoolId: OTHER_SCHOOL_ID })
    );
    const crossSchoolRes = await removeUserAvatar(removalForm(OTHER_SCHOOL_TEACHER_ID));
    expect(crossSchoolRes).toEqual({ ok: true });
    expect(notifyProfilePhotoRemoved).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    bucketRemove.mockResolvedValue({ error: null });
    writeAudit.mockResolvedValue(undefined);
    requireUser.mockResolvedValue({ id: ADMIN_ID, role: "SUPER_ADMIN", schoolId: null });

    const superAdminTargetRow = target({
      id: SUPER_ADMIN_TARGET_ID,
      role: "SUPER_ADMIN",
      schoolId: null,
    });
    userFindUnique.mockResolvedValue(superAdminTargetRow);

    const superAdminRes = await removeUserAvatar(removalForm(SUPER_ADMIN_TARGET_ID));
    expect(superAdminRes).toEqual({ ok: true });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: SUPER_ADMIN_TARGET_ID, avatarPath: superAdminTargetRow.avatarPath },
      data: { avatarPath: null },
    });
    expect(bucketRemove).toHaveBeenCalledWith([
      superAdminTargetRow.avatarPath,
      thumbPathFor(superAdminTargetRow.avatarPath),
    ]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: null, resourceId: SUPER_ADMIN_TARGET_ID })
    );
    // `Notification.schoolId` is required and the target has none: skipped,
    // not invented, and nothing throws.
    expect(notifyProfilePhotoRemoved).not.toHaveBeenCalled();
    expect(revalidateUserAvatar).toHaveBeenCalledWith({ role: "SUPER_ADMIN", schoolId: null });
  });

  it("authorized but the target has no photo: no write, no audit, and the result is the same shape as a successful removal", async () => {
    requireUser.mockResolvedValue({ id: HEAD_ID, role: "SCHOOL_HEAD", schoolId: SCHOOL_ID });
    userFindUnique.mockResolvedValue(target({ avatarPath: null }));

    const res = await removeUserAvatar(removalForm(TEACHER_ID));

    expect(res).toEqual({ ok: true });
    expect(updateMany).not.toHaveBeenCalled();
    expect(bucketRemove).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(notifyProfilePhotoRemoved).not.toHaveBeenCalled();
  });

  it("a Test Lab session writes nothing", async () => {
    requireUser.mockResolvedValue({ id: HEAD_ID, role: "SCHOOL_HEAD", schoolId: SCHOOL_ID });
    readTestLabSession.mockResolvedValue(true);
    userFindUnique.mockResolvedValue(target());

    const res = await removeUserAvatar(removalForm(TEACHER_ID));

    expect(res).toEqual({ ok: true, dryRun: true });
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(bucketRemove).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(notifyProfilePhotoRemoved).not.toHaveBeenCalled();
  });
});
