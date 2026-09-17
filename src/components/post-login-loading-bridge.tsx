"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { isPostLoginLoadingCover } from "@/lib/post-login-flag";

const CREAM = "#FDFBF5";

/** The flag/latch this reads never notifies of changes; nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

/** Server and first client paint must agree, so both default to covered. */
function getServerShowCover(): boolean {
  return true;
}

/**
 * Wraps role-home `loading.tsx` skeletons.
 *
 * Hard navigations — a login redirect, a reload, Ctrl+Shift+R: paint a cream
 * full-screen cover (no skeleton flash) until `PostLoginSplash` takes over at
 * z-9999. The cream matches the splash's own background, so the handover from
 * cover to splash is invisible.
 *
 * In-app soft navigations: `useSyncExternalStore` resolves the real
 * flag/latch state right after mount (before paint, same timing a layout
 * effect would give), clearing the boot cover so skeletons still show as
 * usual. The default above matches what the server rendered, so there is
 * nothing for server and client to disagree on at hydration time.
 */
export function PostLoginLoadingBridge({ children }: { children: ReactNode }) {
  const showCover = useSyncExternalStore(
    subscribeNever,
    isPostLoginLoadingCover,
    getServerShowCover
  );

  if (!showCover) {
    return <>{children}</>;
  }

  return (
    <div
      aria-hidden
      data-post-login-loading-bridge=""
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        width: "100vw",
        height: "100dvh",
        background: CREAM,
      }}
    />
  );
}

export default PostLoginLoadingBridge;
