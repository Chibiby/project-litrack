"use client";

import { toast } from "sonner";

export const COPY_FAILED_MESSAGE = "Couldn't copy. Select the text and copy it instead.";

/** True when the text reached the clipboard; otherwise the person has been told how to proceed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error(COPY_FAILED_MESSAGE);
    return false;
  }
}
