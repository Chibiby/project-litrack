"use client";

import { usePathname } from "next/navigation";

const ADMIN_LOGIN_PATH = "/admin/login";

/**
 * Keeps the admin sidebar and header off `/admin/login`.
 *
 * `/admin/login` shares `app/admin/layout.tsx` with every admin page, and a
 * layout cannot see the pathname. So the layout's "signed in → shell" decision
 * leaked onto the login page whenever a session existed while it rendered — for
 * example mid sign-in, once the session cookie is set but before the redirect
 * lands, or on a client navigation that reuses the already-mounted layout. The
 * pathname is checked here, on every render, instead.
 */
export function AdminShellGate({
  shell,
  children,
}: {
  shell: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return pathname === ADMIN_LOGIN_PATH ? children : shell;
}
