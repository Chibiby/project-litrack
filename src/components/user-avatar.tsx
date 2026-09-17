"use client";

import { useCallback, useState } from "react";
import { UserCircle } from "lucide-react";
import { avatarPublicUrl } from "@/lib/avatars/paths";
import { initialsOf } from "@/lib/avatars/initials";
import { cn } from "@/lib/utils";

interface AvatarImageProps {
  url: string;
  size: number;
  eager: boolean;
}

/**
 * Keyed by `url` from `UserAvatar` below, so a photo change remounts this
 * component and its `status` state starts over at "loading" rather than
 * carrying the previous photo's loaded/error state forward.
 */
function AvatarImage({ url, size, eager }: AvatarImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  // A ref callback, not an effect: it fires synchronously when the node is
  // attached, so an image the browser already cached before hydration
  // (complete + real pixels) is marked loaded immediately instead of sitting
  // invisible until a load event that has already happened and will not fire
  // again.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) {
      setStatus("loaded");
    }
  }, []);

  if (status === "error") return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- OpenNext has no IMAGES binding, so next/image would proxy without optimizing.
    <img
      ref={imgRef}
      src={url}
      alt=""
      width={size}
      height={size}
      decoding="async"
      loading={eager ? undefined : "lazy"}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")}
      className={cn(
        "absolute inset-0 h-full w-full rounded-full object-cover transition-opacity duration-200",
        status === "loaded" ? "opacity-100" : "opacity-0"
      )}
    />
  );
}

interface UserAvatarProps {
  name: string;
  avatarPath: string | null;
  size: number;
  variant?: "thumb" | "full";
  className?: string;
  /** Skips `loading="lazy"` for an avatar that is above the fold on mount. */
  eager?: boolean;
  /**
   * What shows while there is no photo (or it fails to load). `"initials"`
   * (default) is the violet-200 initials circle already used for the phone
   * top-bar avatar. `"icon"` reproduces the amber `UserCircle` circle used at
   * the sidebar trigger and the dropdown label — violet is reserved for the
   * ARAL accent, so those two spots keep their existing amber tone rather
   * than picking up violet just because this component's default does.
   */
  fallback?: "initials" | "icon";
}

/**
 * Fixed-size round avatar: a fallback underneath, a photo on top once it has
 * loaded. No `avatarPath`, no public URL, or a failed load all fall back to
 * the same box, so the box itself never causes layout shift.
 */
export function UserAvatar({
  name,
  avatarPath,
  size,
  variant = "thumb",
  className,
  eager = false,
  fallback = "initials",
}: UserAvatarProps) {
  const url = avatarPath ? avatarPublicUrl(avatarPath, variant) : null;

  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        fallback === "icon"
          ? "bg-amber-100 text-amber-700"
          : "bg-violet-200 text-sm font-semibold text-violet-800 dark:bg-violet-900/60 dark:text-violet-100",
        className
      )}
      style={{ width: size, height: size }}
    >
      {fallback === "icon" ? <UserCircle className="h-4 w-4" /> : initialsOf(name)}
      {url ? <AvatarImage key={url} url={url} size={size} eager={eager} /> : null}
    </span>
  );
}
