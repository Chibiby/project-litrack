"use client";

import { RouteError } from "@/components/errors/route-error";
import "./globals.css";

/**
 * The boundary for failures in the root layout itself.
 *
 * It replaces `<html>`, so it must render its own — and it cannot rely on
 * anything the layout provides, including the theme script, which is why the
 * ground is left to the browser default rather than a theme token. Without this
 * file such a failure falls through to Next's unstyled built-in page. The
 * layout's stylesheet import is repeated here because the layout is what this
 * file replaces; without it the card renders unstyled.
 */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong | LITRACK</title>
      </head>
      <body>
        <RouteError {...props} scope="App" homeHref="/" homeLabel="Back to home" />
      </body>
    </html>
  );
}
