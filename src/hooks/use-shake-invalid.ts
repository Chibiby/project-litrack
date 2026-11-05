"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shakeInvalidFields } from "@/lib/ui/shake-invalid";

/**
 * Call `shake()` whenever an attempt fails; once that render has committed
 * (so the new `aria-invalid` marks are in the DOM), every invalid field inside
 * `ref` shakes. Each call shakes again, even when the errors are unchanged.
 */
export function useShakeInvalid<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (attempt > 0) shakeInvalidFields(ref.current);
  }, [attempt]);

  const shake = useCallback(() => setAttempt((n) => n + 1), []);
  return { ref, shake };
}
