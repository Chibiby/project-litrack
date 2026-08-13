import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The single card/panel chrome for the app.
 *
 * Replaces the `rounded-xl border border-border/80 bg-card ... shadow-card`
 * string that was duplicated across ~24 files. Token-only so dark mode is a
 * CSS-variable swap, never a per-file edit.
 *
 * Server component on purpose — no `"use client"`. It ships zero JS.
 */
export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "section" | "article";
}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, as = "div", ...props }, ref) => {
    const Comp = as;
    return (
      <Comp
        ref={ref}
        className={cn(
          "rounded-xl border border-border/80 bg-card text-card-foreground shadow-card",
          className
        )}
        {...props}
      />
    );
  }
);
Surface.displayName = "Surface";

const SurfaceHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4",
      className
    )}
    {...props}
  />
));
SurfaceHeader.displayName = "SurfaceHeader";

const SurfaceBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5", className)} {...props} />
));
SurfaceBody.displayName = "SurfaceBody";

export { Surface, SurfaceHeader, SurfaceBody };
