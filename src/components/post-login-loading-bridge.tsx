"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { isPostLoginLoadingCover } from "@/lib/post-login-flag";

const CREAM = "#FDFBF5";

/**
 * Wraps role-home `loading.tsx` skeletons.
 *
 * Post-login hard navigations: paint a cream full-screen cover (no dashboard
 * skeleton flash) until `PostLoginSplash` takes over at z-9999.
 *
 * In-app soft navigations: `useLayoutEffect` clears the boot cover before
 * paint when the flag/latch is absent, so skeletons still show as usual.
 */
export function PostLoginLoadingBridge({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"boot" | "cover" | "skeleton">("boot");

  useLayoutEffect(() => {
    setMode(isPostLoginLoadingCover() ? "cover" : "skeleton");
  }, []);

  if (mode === "skeleton") {
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
