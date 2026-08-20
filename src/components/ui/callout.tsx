import * as React from "react";
import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Inline page-level notice.
 *
 * Replaces four hand-rolled amber banners that had drifted to three different
 * radius/border combinations and, more importantly, carried zero `dark:`
 * coverage — `bg-amber-50` renders as a near-white slab against a dark page.
 *
 * `warning` and `aral` spell out their dark variants because there is no
 * `--warning` token; that follows `MetricCard`'s violet tone rather than
 * inventing a new theme variable for one component. `info` is token-only, so it
 * themes for free.
 *
 * `aral` is violet because violet is the reserved ARAL accent (see
 * `tailwind.config.ts`). Use it only on ARAL surfaces.
 *
 * Server component on purpose — no `"use client"`. It ships zero JS.
 *
 * Deliberately no ARIA role: these describe page state at render time, not live
 * events, so `role="alert"` would interrupt a screen reader with something that
 * is simply part of the page.
 */
const calloutVariants = cva(
  "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        warning:
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
        info: "border-border/80 bg-muted/40 text-muted-foreground",
        aral: "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200",
      },
    },
    defaultVariants: { variant: "warning" },
  }
);

type CalloutTone = "warning" | "info" | "aral";

/** Matches `NavItem["icon"]` — the icon contract already used across the app. */
type CalloutIcon = React.ComponentType<{ className?: string }>;

const DEFAULT_ICONS: Record<CalloutTone, CalloutIcon> = {
  warning: AlertTriangle,
  info: Info,
  aral: Sparkles,
};

export type CalloutProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof calloutVariants> & {
    /** Overrides the per-variant default. `null` renders no icon. */
    icon?: CalloutIcon | null;
    /** Bolded lead line above the body. */
    title?: string;
  };

export function Callout({
  className,
  variant,
  icon,
  title,
  children,
  ...props
}: CalloutProps) {
  const tone: CalloutTone = variant ?? "warning";
  const Icon = icon === null ? null : (icon ?? DEFAULT_ICONS[tone]);

  return (
    <div className={cn(calloutVariants({ variant: tone }), className)} {...props}>
      {Icon ? (
        <span aria-hidden className="mt-0.5 shrink-0">
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={cn(title ? "mt-1" : undefined)}>{children}</div>
      </div>
    </div>
  );
}
