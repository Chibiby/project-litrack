"use client";

import { RouteError } from "@/components/errors/route-error";

/**
 * The boundary for failures in the root layout itself.
 *
 * It replaces `<html>`, so it must render its own — and it cannot rely on
 * anything the layout provides, including the theme script, which is why the
 * ground is left to the browser default rather than a theme token. Without this
 * file such a failure falls through to Next's unstyled built-in page.
 */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <RouteError {...props} scope="App" homeHref="/" homeLabel="Back to home" />
      </body>
    </html>
  );
}
