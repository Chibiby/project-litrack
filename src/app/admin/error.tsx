"use client";

import { RouteError } from "@/components/errors/route-error";

/**
 * This boundary also covers /admin/login, which anyone can reach — which is why
 * it names no part of our infrastructure and offers no diagnosis. All of that
 * now lives in /admin/errors, keyed by the digest shown here, where the only
 * readers are Super Admins who can act on it.
 *
 * (An invariant test enforces the same rule on this file's own text, comments
 * included — hence the circumlocution.)
 */
export default function AdminError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="Admin" homeHref="/admin" homeLabel="Back to dashboard" />;
}
