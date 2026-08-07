import * as React from "react";
import { cn } from "@/lib/utils";

/** Server-safe shimmer skeleton — CSS-only, no client JS. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton-shimmer rounded-[var(--radius)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
