"use client";

import { CheckCircle2, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import type { AutosaveStatus } from "@/lib/ui/use-autosave";
import { cn } from "@/lib/utils";

const COPY: Record<Exclude<AutosaveStatus, "idle">, string> = {
  waiting: "Changes will save automatically",
  saving: "Saving…",
  saved: "All changes saved",
  offline: "Offline. Your changes are kept on this device and will save when you are back online.",
  blocked: "Some entries are not valid yet, so nothing was saved. Fix them and they will save automatically.",
  error: "Couldn't save automatically. Your changes are kept on this device. Retrying, or press Save.",
};

/**
 * One line under a grid's toolbar saying where its autosave stands. Announced
 * politely, but not a `status` role: the grid's totals region already owns that.
 */
export function AutosaveStatusLine({
  status,
  className,
}: {
  status: AutosaveStatus;
  className?: string;
}) {
  if (status === "idle") return null;
  const Icon =
    status === "saving" || status === "waiting"
      ? Loader2
      : status === "saved"
        ? CheckCircle2
        : status === "offline"
          ? CloudOff
          : TriangleAlert;
  return (
    <p
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-xs",
        status === "error" || status === "offline" || status === "blocked"
          ? "text-warning-800 dark:text-warning-200"
          : "text-muted-foreground",
        className
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-3.5 shrink-0", status === "saving" && "animate-spin", status === "waiting" && "opacity-0")}
      />
      {COPY[status]}
    </p>
  );
}
