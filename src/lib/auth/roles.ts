/**
 * Pure role helpers safe for Edge middleware (no Prisma / server-only).
 */

export type AppRole = "SUPER_ADMIN" | "SCHOOL_HEAD" | "TEACHER";

export function roleHomePath(role: AppRole): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "/admin";
    case "SCHOOL_HEAD":
      return "/school-head";
    case "TEACHER":
      return "/teacher";
  }
}

function roleBasePath(role: AppRole): string {
  return roleHomePath(role);
}

/** Settings index under the role segment (`/{role}/settings` → profile). */
export function roleSettingsPath(role: AppRole): string {
  return `${roleBasePath(role)}/settings`;
}

export function roleSettingsProfilePath(role: AppRole): string {
  return `${roleSettingsPath(role)}/profile`;
}

export function roleSecurityPath(role: AppRole): string {
  return `${roleSettingsPath(role)}/security`;
}

/**
 * Change-password / Security route under the role segment so RoleShell stays mounted.
 * Name kept for callers; destination is Settings → Security.
 */
export function rolePasswordPath(role: AppRole): string {
  return roleSecurityPath(role);
}

export function parseAppMetadataRole(value: unknown): AppRole | null {
  if (value === "SUPER_ADMIN" || value === "SCHOOL_HEAD" || value === "TEACHER") {
    return value;
  }
  return null;
}

/**
 * Where middleware should send an already-signed-in visitor off a login page,
 * or null to let the request through.
 *
 * Only a page load (GET/HEAD) is a visit. A POST to `/login` is a Server Action,
 * and the browser sign-in depends on one reaching it: the browser stores the new
 * session, then `finishSchoolHeadLogin` / `finishTeacherLogin` POST to `/login`
 * carrying those cookies. Redirecting that POST forwards the action to the role
 * home, where Next cannot find it — so every account whose JWT carries a role
 * had its correct password accepted by Supabase and then thrown away. Legacy
 * role-less accounts passed, which is why only a handful of heads got in.
 */
export function authedLoginRedirect(
  method: string,
  pathname: string,
  role: AppRole | null
): string | null {
  if (!role) return null;
  if (pathname !== "/login" && pathname !== "/admin/login") return null;
  if (method !== "GET" && method !== "HEAD") return null;
  return roleHomePath(role);
}

/**
 * Defense-in-depth path prefix checks using JWT app_metadata.role.
 * Legacy accounts without app_metadata.role pass through (requireUser is authoritative).
 */
export function enforceRolePrefix(
  pathname: string,
  role: AppRole | null
): { ok: true } | { ok: false; redirectTo: string } {
  const needsAdmin = pathname.startsWith("/admin");
  const needsSchoolHead = pathname.startsWith("/school-head");
  const needsTeacher = pathname.startsWith("/teacher");
  const needsAccount = pathname.startsWith("/account");

  if (!needsAdmin && !needsSchoolHead && !needsTeacher && !needsAccount) {
    return { ok: true };
  }

  if (needsAccount) {
    return { ok: true };
  }

  if (!role) {
    return { ok: true };
  }

  if (needsAdmin && role !== "SUPER_ADMIN") {
    return { ok: false, redirectTo: roleHomePath(role) };
  }
  if (needsSchoolHead && role !== "SCHOOL_HEAD" && role !== "SUPER_ADMIN") {
    return { ok: false, redirectTo: roleHomePath(role) };
  }
  if (needsTeacher && role !== "TEACHER" && role !== "SUPER_ADMIN") {
    return { ok: false, redirectTo: roleHomePath(role) };
  }

  return { ok: true };
}
