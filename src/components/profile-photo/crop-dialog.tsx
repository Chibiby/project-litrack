"use client";

import { useEffect, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AvatarSourceTooLargeError,
  processAvatarImage,
  type ProcessedAvatarImage,
} from "@/components/profile-photo/process-image";

export type CropDialogError = "too_large" | "decode";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.01;

/**
 * `react-easy-crop` in a Dialog: drag to move, slider to zoom, round mask
 * matching the round avatar it produces. Loaded only via `next/dynamic(...,
 * { ssr: false })` from `profile-photo-card.tsx` — this file (and everything
 * it imports, including `process-image.ts`) must stay out of the settings
 * pages' first-load bundle.
 */
export function CropDialog({
  file,
  open,
  onOpenChange,
  onCropped,
  onError,
}: {
  file: File;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCropped: (result: ProcessedAvatarImage) => void;
  onError: (kind: CropDialogError) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Synchronizing with an external system (a `Blob`-backed object URL,
    // which only exists outside React): this effect runs once per `file`,
    // recreating the URL to match it and resetting the crop state a new
    // photo starts from. Cleanup revokes it on the next file or on unmount.
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is created by this effect (`URL.createObjectURL`), not derivable during render; see the comment above.
    setImageUrl(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleUsePhoto() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const result = await processAvatarImage(file, croppedAreaPixels);
      onCropped(result);
    } catch (err) {
      onError(err instanceof AvatarSourceTooLargeError ? "too_large" : "decode");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Crop your photo</DialogTitle>
          <DialogDescription>Drag to reposition, and use the slider to zoom.</DialogDescription>
        </DialogHeader>

        <div className="relative h-72 w-full overflow-hidden rounded-lg bg-muted">
          {imageUrl ? (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              zoomSpeed={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_croppedArea, pixels) => setCroppedAreaPixels(pixels)}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            value={zoom}
            disabled={busy}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!croppedAreaPixels || busy}
            loading={busy}
            loadingText="Processing…"
            onClick={() => void handleUsePhoto()}
          >
            Use photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
