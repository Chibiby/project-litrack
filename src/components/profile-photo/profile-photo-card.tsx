"use client";

import { type ChangeEvent, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { ConfirmAction } from "@/components/confirm-action";
import { uploadOwnAvatar, removeOwnAvatar } from "@/lib/actions/avatar";
import { AVATAR_SOURCE_MAX_BYTES } from "@/lib/avatars/limits";
import type { CropDialogError } from "@/components/profile-photo/crop-dialog";
import type { ProcessedAvatarImage } from "@/components/profile-photo/process-image";

// `react-easy-crop` and the canvas pipeline it drives are heavy and only
// needed once someone actually picks a photo — dynamic + `ssr: false` keeps
// both chunks out of the settings pages' first-load bundle. Only mounted
// (see below) once a file is selected, so the chunk is not even fetched
// until then.
const CropDialog = dynamic(
  () => import("@/components/profile-photo/crop-dialog").then((m) => m.CropDialog),
  { ssr: false }
);

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

const SOURCE_TOO_LARGE_MESSAGE = "That picture file is too large. Pick one smaller than 5 MB.";
const DECODE_ERROR_MESSAGE =
  "That picture couldn't be opened. Try a JPG, PNG or WebP photo — a HEIC photo from an iPhone needs to be converted first.";

/**
 * Profile photo upload card: current photo, "Change photo" (opens the crop
 * dialog), and "Remove photo" (shown only once a photo exists). Placed on all
 * three roles' Settings → Profile pages — see
 * `docs/superpowers/specs/2026-09-18-user-profile-photos-design.md` (T8).
 */
export function ProfilePhotoCard({
  name,
  avatarPath,
}: {
  name: string;
  avatarPath: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, startUpload] = useTransition();

  function openPicker() {
    inputRef.current?.click();
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Allow picking the same file again after a Cancel/error.
    e.target.value = "";
    if (!file) return;
    if (file.size > AVATAR_SOURCE_MAX_BYTES) {
      toast.error(SOURCE_TOO_LARGE_MESSAGE);
      return;
    }
    setCropFile(file);
  }

  function handleCropped(result: ProcessedAvatarImage) {
    setCropFile(null);
    startUpload(async () => {
      const fd = new FormData();
      fd.set("photo", result.full);
      fd.set("thumb", result.thumb);
      const res = await uploadOwnAvatar(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // `UploadOwnAvatarResult`'s two `ok: true` shapes share no common tag
      // other than which of these two keys they carry.
      if ("dryRun" in res && res.dryRun) {
        toast("Test Lab — no photo was actually saved.");
        return;
      }
      toast.success("Profile photo updated");
      router.refresh();
    });
  }

  function handleCropError(kind: CropDialogError) {
    setCropFile(null);
    toast.error(kind === "too_large" ? SOURCE_TOO_LARGE_MESSAGE : DECODE_ERROR_MESSAGE);
  }

  async function handleRemove() {
    const res = await removeOwnAvatar();
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    if (res.dryRun) {
      toast("Test Lab — no photo was actually removed.");
      return;
    }
    toast.success("Profile photo removed");
    router.refresh();
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Profile photo</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
          <UserAvatar name={name} avatarPath={avatarPath} size={96} variant="full" eager />
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">JPG, PNG or WebP. Max 5 MB.</p>
            <div className="flex flex-wrap justify-center gap-2 pt-1 sm:justify-start">
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="sr-only"
                onChange={onFileChange}
                disabled={uploading}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openPicker}
                disabled={uploading}
                loading={uploading}
                loadingText="Uploading…"
              >
                <Camera aria-hidden />
                Change photo
              </Button>
              {avatarPath ? (
                <ConfirmAction
                  title="Remove profile photo?"
                  description="Your current photo will be deleted. You can upload a new one any time."
                  confirmLabel="Remove photo"
                  variant="destructive"
                  disabled={uploading}
                  trigger={
                    <Button type="button" variant="ghost" size="sm" disabled={uploading}>
                      <Trash2 aria-hidden />
                      Remove
                    </Button>
                  }
                  onConfirm={handleRemove}
                />
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>

      {cropFile ? (
        <CropDialog
          file={cropFile}
          open
          onOpenChange={(open) => {
            if (!open) setCropFile(null);
          }}
          onCropped={handleCropped}
          onError={handleCropError}
        />
      ) : null}
    </Card>
  );
}
