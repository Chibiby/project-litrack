"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type SkeletonProps = ComponentProps<typeof Skeleton>;

/** Themed react-loading-skeleton using design tokens (--muted, --radius). */
export function ThemedSkeleton({ className, ...props }: SkeletonProps) {
  return (
    <Skeleton
      className={cn(className)}
      borderRadius="var(--radius)"
      {...props}
    />
  );
}

export function SkeletonThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SkeletonTheme
      baseColor="hsl(var(--muted))"
      highlightColor="hsl(var(--card))"
      borderRadius="var(--radius)"
    >
      {children}
    </SkeletonTheme>
  );
}
