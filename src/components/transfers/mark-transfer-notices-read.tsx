"use client";

import { useEffect } from "react";
import { markMyTransferNoticesRead } from "@/lib/actions/school-transfer";
import { callAction } from "@/lib/ui/call-action";

/**
 * Clears the School Head's transfer notices once the Transfer page is really
 * open in the browser. The server render cannot do it: a hover or focus
 * prefetch of a Transfer link runs that render, and the bell would clear
 * before the School Head saw it. A failure is harmless (the notice stays), so
 * it is not shown.
 */
export function MarkTransferNoticesRead() {
  useEffect(() => {
    void callAction(() => markMyTransferNoticesRead()).catch(() => {});
  }, []);
  return null;
}
