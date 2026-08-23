import { cn } from "@/lib/utils";

import styles from "./book-loader.module.css";

/** Books on the shelf. Must match the `nth-child` fill rules in the CSS module. */
const BOOK_COUNT = 5;

export type BookLoaderProps = {
  /**
   * `sm` for a content slot rendered beside an already-mounted RoleShell, `md`
   * for a full-page wait where the loader is the only thing on screen.
   */
  size?: "sm" | "md";
  /**
   * Render the shelf as decoration with no announcement. Set this when the
   * loader is layered over a skeleton that already owns the slot's live region —
   * two live regions over a single wait announce it twice.
   */
  decorative?: boolean;
  /** Announced text. Ignored when `decorative` is set. */
  label?: string;
  className?: string;
};

/**
 * The ARAL shelf, looping, as a page-loading indicator.
 *
 * Shares no code with `PostLoginSplash` on purpose — see the CSS module header.
 * This is a server component: the loop is entirely CSS, so nothing here needs
 * `"use client"` and it can render directly inside a `loading.tsx` boundary.
 */
export function BookLoader({
  size = "md",
  decorative = false,
  label = "Loading page",
  className,
}: BookLoaderProps) {
  return (
    <div
      className={cn("inline-flex flex-col items-center", className)}
      data-slot="book-loader"
      role={decorative ? undefined : "status"}
      aria-live={decorative ? undefined : "polite"}
      aria-hidden={decorative || undefined}
    >
      <div
        className={cn(styles.shelf, size === "sm" && styles.shelfSm)}
        data-slot="book-loader-shelf"
        aria-hidden="true"
      >
        {Array.from({ length: BOOK_COUNT }, (_, i) => (
          <div key={i} className={styles.book} />
        ))}
      </div>
      {decorative ? null : <span className="sr-only">{label}</span>}
    </div>
  );
}
