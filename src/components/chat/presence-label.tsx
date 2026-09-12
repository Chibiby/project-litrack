"use client";

import { useEffect, useState } from "react";
import { getPresenceStatus } from "@/lib/presence/status";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;

export function PresenceLabel({ lastOnlineAt }: { lastOnlineAt: Date | null }) {
  const [, setClock] = useState(0);
  const status = getPresenceStatus(lastOnlineAt ? new Date(lastOnlineAt) : null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          status.online ? "bg-emerald-500" : "bg-muted-foreground/45"
        )}
        aria-hidden
      />
      {status.label}
    </p>
  );
}
