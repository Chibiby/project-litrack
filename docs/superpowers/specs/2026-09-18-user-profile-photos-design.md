# User profile photos — design

Status: approved by owner 2026-09-18. Base: `origin/main` 5085704 (2.4.1). Target release: 2.5.0.

## Owner decisions

- All three roles (TEACHER, SCHOOL_HEAD, SUPER_ADMIN) can upload, change, and remove their own photo.
- Storage: Supabase Storage on the production project `rnrumiejofmajgahphvt` (Free plan: 1 GB, no image transformations, no Smart CDN). Public bucket `avatars`, unguessable object keys, no client access.
- Crop and zoom dialog before upload.
- Placements: header, sidebar, and account menu avatar; School Head teachers list; Super Admin accounts table and account profile dialog; each role's Settings → Profile page.
- Moderation: a School Head can remove the photo of a non-deleted TEACHER in their own school. A Super Admin can remove anyone's photo.
- Impersonation ("Sign in as" a real account): upload is refused, removal is allowed.
- `cacheControl` for stored objects: `86400` (1 day). The Free plan cannot purge the CDN quickly, so a moderated photo must not linger for a year.
- Moderation deletes the object permanently. Only the audit row remains.
- When someone other than the owner removes a photo, the owner receives an in-app notification (for example "Your profile photo was removed by your School Head."). No notification is sent when the target has no `schoolId` (a Super Admin target), because `Notification.schoolId` is required.

## Design summary

1. Schema: `User.avatarPath String?`. NULL means no photo. A SQL-only CHECK pins the shape.
2. Bucket `avatars` is created by `prisma/storage-avatars.sql`, which a human applies. It is not a Prisma migration, because the shadow database has no `storage` schema. The file adds one RESTRICTIVE policy denying `anon` and `authenticated` all operations on this bucket. Only the service role in `src/lib/supabase/avatar-storage.ts` writes.
3. Object keys: `<userId>/<uuid>.<ext>` plus the thumbnail `<userId>/<uuid>_128.<ext>`. No `schoolId` in the key, so Super Admins work.
4. Upload path: client → server action (FormData `photo` + `thumb`) → server validation → service-role upload.
5. Client: lazy-loaded crop dialog (`react-easy-crop`). The browser applies EXIF orientation at decode. The canvas re-encode strips metadata. Output 512×512 and 128×128 WebP q0.8. If `blob.type` is not WebP, re-encode as JPEG q0.85 over a white fill. Reject a raw source file over 5 MB before decoding. Downscale to at most 2048 px on the long edge before cropping.
6. Server validation: sniff magic bytes (webp/jpeg/png only), full ≤ 1 MiB, thumb ≤ 64 KiB, square, full 128–1024 px, thumb 32–256 px, reject EXIF/XMP/animation, both files the same type. Do not trust the client MIME type.
7. Write order: upload new objects (`upsert: false`) → compare-and-swap `updateMany where { id, avatarPath: previous }` → best-effort delete of the previous objects → audit → notification (moderation only) → revalidate. When the CAS count is 0, remove the new objects and throw `AVATAR_CHANGED`.
8. Display: plain `<img>` in one `UserAvatar` component: a fixed box, initials underneath, fade in on load, remove on error. Lists and the shell use the 128 px thumbnail. Profile pages use the 512 px image. `next/image` is not used, because OpenNext has no `IMAGES` binding here.
9. Moderation authorization is one pure function, `decideAvatarModeration`. Every refusal returns the same generic NOT_FOUND. A missing photo is checked only after authorization.
10. Shell data: `getCurrentUser` already loads the full `User` row. Layouts pass `user.avatarPath` into `RoleShell`. Lists add the field to their existing selects.
11. Orphans: a hard purge of an archived user removes the user's objects after the delete commits. A soft delete keeps the photo. An orphan sweep script is deferred.

## Contracts

`src/lib/avatars/` (pure modules, no `server-only`):

- `limits.ts`: `AVATAR_BUCKET = "avatars"`, `AVATAR_SOURCE_MAX_BYTES = 5 * 1024 * 1024`, `AVATAR_FULL_MAX_BYTES = 1024 * 1024`, `AVATAR_THUMB_MAX_BYTES = 64 * 1024`, `AVATAR_FULL_SIZE = 512`, `AVATAR_THUMB_SIZE = 128`, the dimension bounds, `AVATAR_CACHE_CONTROL_SECONDS = 86400`, and the upload rate limit (10 per hour).
- `paths.ts`:
  - `buildAvatarPaths(userId, objectId, ext)`
  - `thumbPathFor(path)`
  - `isValidAvatarPath(path, userId?)`
  - `avatarPublicUrl(path, variant: "full" | "thumb", base = process.env.NEXT_PUBLIC_SUPABASE_URL)`: returns `string | null`. Write the env var literally so Next inlines it. Return null when base is missing or the path is invalid. This is the only place `/storage/v1/object/public` appears under `src/`.
- `sniff.ts`: `sniffImage(bytes: Uint8Array) → { mime, width, height, hasMetadata, animated } | null`. It never throws on truncated input. It covers JPEG (SOF dimensions, APP1 Exif/XMP counts as metadata), PNG (IHDR dimensions, `eXIf`/`iTXt` XMP counts as metadata, `acTL` counts as animated), and WebP (VP8, VP8L, VP8X with EXIF/XMP/ANIM flags).
- `validate-upload.ts`: `validateAvatarUpload({ full: Uint8Array, thumb: Uint8Array }) → { ok: true, mime, ext } | { ok: false, reason }`.
- `authorize.ts`: `decideAvatarModeration(actor: { id, role, schoolId }, target: { id, role, schoolId, deletedAt, avatarPath } | null)` returns one of:
  - `{ kind: "remove", path, basis: "self" | "school_head" | "super_admin" }`
  - `{ kind: "nothing_to_remove" }`
  - `{ kind: "not_found", crossTenant: boolean }`
- `initials.ts`: `initialsOf`, moved out of `src/components/user-account-menu.tsx`.

`src/lib/actions/avatar.ts` (every action wrapped in `action()`):

- `uploadOwnAvatar(formData)` → `{ avatarPath } | { dryRun: true }`
  - Guard: `requireUser(["TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"])`.
  - Then: Test Lab check (`readTestLabSession` → dry run, zero writes), then the impersonation check (refuse with `AUTH_FORBIDDEN`), then the rate limit (`avatar:<userId>`), then validation, then the write order above.
- `removeOwnAvatar()`: guard, Test Lab check, CAS to NULL, delete objects, audit, revalidate. Allowed while impersonating.
- `removeUserAvatar(formData: userId)`
  - Guard: `requireUser("SCHOOL_HEAD")`. A Super Admin passes by default.
  - Load `{ id, role, schoolId, deletedAt, avatarPath }`, then call `decideAvatarModeration`.
  - Audit, notification, and revalidation use the target's `schoolId`. Cross-tenant and missing targets must produce the identical `error` string.
- `src/lib/supabase/avatar-storage.ts` (`server-only`):
  - `putAvatarObjects`: `contentType` = sniffed mime, `cacheControl: "86400"`, `upsert: false`. When the second upload fails, remove the first.
  - `removeAvatarObjects(paths)`: never throws. It logs a count only.
- `src/lib/cache/revalidate.ts` → `revalidateUserAvatar({ role, schoolId })`:
  - revalidate the role's settings profile path and `/admin/accounts`
  - for a TEACHER with a school, call `revalidateSchoolHeadTeachers(schoolId)`
  - the client also calls `router.refresh()`
- Error codes (`src/lib/errors/codes.ts`, no infrastructure names in messages):

  | Code | Status | Severity |
  |---|---|---|
  | `AVATAR_SOURCE_TOO_LARGE` | 413 | user |
  | `AVATAR_FILE_INVALID` | 422 | user |
  | `AVATAR_FILE_TOO_LARGE` | 413 | user |
  | `AVATAR_CHANGED` | 409 | user |
  | `AVATAR_STORAGE_FAILED` | 502 | system |

  The rate limit reuses `tooManyAttempts`.
- Audit actions: `USER_AVATAR_UPLOAD`, `USER_AVATAR_REMOVE`, `USER_AVATAR_MODERATE_REMOVE`, with `resource: "User"`. Metadata holds object paths, mime, and byte sizes only.
- Notification: new `NotificationType` value `PROFILE_PHOTO_REMOVED`, with `actorId` set. The sentence is composed at read time in `src/lib/notifications.ts`, following existing honorific conventions. Add the label to `src/lib/constants/enum-labels.ts`.

## Invariants

1. `avatarPath` is NULL or `<ownId>/<uuid>.(webp|jpg|png)`. Enforced by the DB CHECK and by `isValidAvatarPath`.
2. A user sets only their own photo. The upload action takes no target argument.
3. Moderation rules and a generic NOT_FOUND are enforced in `decideAvatarModeration` plus the action. Cross-tenant attempts are logged with `crossTenant`.
4. Stored bytes are validated on the server. The bucket limits are only a backstop.
5. No client role can list, write, or delete in the bucket. This is the RESTRICTIVE storage policy, verified manually on apply.
6. An old object is deleted only after this request's CAS succeeds.
7. No overwrite: `crypto.randomUUID()` plus `upsert: false`.
8. At most 10 uploads per hour per user.
9. Every upload, removal, and moderation removal is audited.
10. The public URL is built in exactly one function.
11. `UserAvatar` causes no layout shift. Initials show while loading and on error.
12. Test Lab sessions write nothing.
13. `avatarPath` is never read inside `cachedQuery`.
14. A hard purge removes the user's objects after commit. A soft delete keeps them.

## Apply order (human, before push)

1. Apply migration `20260918000001_user_avatar_path` to production from the branch that contains it.
2. Run `prisma/storage-avatars.sql` against `rnrumiejofmajgahphvt`, then run its verification queries.
3. Push main.

The regenerated client selects `avatarPath` in `getCurrentUser`, so pushing before step 1 fails every signed-in request with P2022.

## Deferred

`scripts/sweep-avatar-orphans.ts`: a dry-run-by-default sweep of unreferenced objects.

## Local testing warning

`.env.local` points at production. Manual upload tests write real rows and objects. Test only on the owner's own account, and remove the photo afterwards. There are no E2E tests for this feature.
