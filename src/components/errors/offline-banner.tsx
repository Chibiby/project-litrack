"use client";

import * as React from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getSnapshot = () => navigator.onLine;
// The server cannot know; assuming online keeps hydration markup empty.
const getServerSnapshot = () => true;

/**
 * Persistent notice while the browser reports no connection. Pinned to the
 * bottom edge so it never sits over the app header or its controls.
 *
 * `navigator.onLine === true` only means a network interface exists, so this
 * covers the clear offline case; a connection that drops mid-request is handled
 * by the action failure path instead.
 */
export function OfflineBanner() {
  const online = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const wasShown = React.useRef(false);

  React.useEffect(() => {
    if (!online) {
      wasShown.current = true;
    } else if (wasShown.current) {
      wasShown.current = false;
      toast.success("You're back online.");
    }
  }, [online]);

  // The live region stays mounted so screen readers announce both changes.
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {online ? null : (
        <p className="pointer-events-auto flex min-h-11 w-full max-w-xl items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 shadow-md dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-200">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>You&apos;re offline. Changes won&apos;t save until your connection is back.</span>
        </p>
      )}
    </div>
  );
}
