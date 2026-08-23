import { BookLoader } from "./book-loader";

/**
 * Minimal page-slot busy state for settings/password/simple form routes.
 *
 * Use under nested `loading.tsx` so soft-nav to light pages does not flash
 * a fuller role dashboard skeleton. RoleShell stays mounted.
 *
 * These ten routes have no shape worth mirroring — a password form, an audit
 * table, an import wizard — so there is no skeleton to lay the book over and it
 * simply *is* the wait. It replaces a 1px pulsing bar that was easy to miss on a
 * light background and said nothing about which product you were waiting on.
 *
 * `min-h` rather than a fixed height: the slot sits inside a mounted RoleShell,
 * so it only needs to hold enough vertical space that the book lands near the
 * optical centre of the content area instead of hugging the header. Capped at
 * `28rem` so a short viewport does not scroll to reveal a loader.
 */
export function ContentRouteLoading() {
  return (
    <div
      className="flex w-full items-center justify-center px-4 py-6 min-h-[min(60vh,28rem)] lg:px-8"
      aria-busy="true"
    >
      {/*
        `aria-busy` above, the announcement here. BookLoader carries its own
        `role="status"` and `sr-only` label, so this container deliberately does
        NOT repeat `aria-live` — two live regions over one wait announce it twice.
      */}
      <BookLoader size="sm" />
    </div>
  );
}
