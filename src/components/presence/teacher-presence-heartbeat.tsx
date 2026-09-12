"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordTeacherPresence } from "@/lib/actions/presence";

const HEARTBEAT_MS = 60_000;

/** Best-effort active-app signal for a real teacher session. */
export function TeacherPresenceHeartbeat({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname();
  const lastAttemptAt = useRef<number | null>(null);

  const pulse = useCallback(() => {
    if (disabled || document.visibilityState !== "visible") return;
    const now = Date.now();
    if (lastAttemptAt.current !== null && now - lastAttemptAt.current < HEARTBEAT_MS) {
      return;
    }
    lastAttemptAt.current = now;
    void recordTeacherPresence().catch(() => undefined);
  }, [disabled]);

  useEffect(() => {
    pulse();
  }, [pathname, pulse]);

  useEffect(() => {
    if (disabled) return;

    const onVisibilityChange = () => pulse();
    document.addEventListener("pointerdown", pulse, { passive: true });
    document.addEventListener("keydown", pulse);
    document.addEventListener("touchstart", pulse, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", pulse);

    return () => {
      document.removeEventListener("pointerdown", pulse);
      document.removeEventListener("keydown", pulse);
      document.removeEventListener("touchstart", pulse);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", pulse);
    };
  }, [disabled, pulse]);

  return null;
}
