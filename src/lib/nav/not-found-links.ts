import type { UserRole } from "@prisma/client";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Where to offer to go from a page that does not exist.
 *
 * Deliberately three links, not the whole sidebar: a 404 is a wrong turn, and a
 * menu of twelve options is no more helpful than the two or three places the
 * person actually meant. Signed-out visitors get the one thing they can do.
 */
export function notFoundLinksFor(role: UserRole | null): Array<{ href: string; label: string }> {
  switch (role) {
    case "TEACHER":
      return [
        { href: "/teacher", label: "Dashboard" },
        { href: "/teacher/aral", label: "ARAL classes" },
        { href: "/teacher/learners", label: "Learners" },
      ];
    case "SCHOOL_HEAD":
      return [
        { href: SCHOOL_HEAD_ROUTES.dashboard, label: "Dashboard" },
        { href: SCHOOL_HEAD_ROUTES.teachers, label: "Teachers" },
        { href: SCHOOL_HEAD_ROUTES.reports, label: "Reports" },
      ];
    case "SUPER_ADMIN":
      return [
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/schools", label: "Schools" },
        { href: "/admin/audit", label: "Audit" },
      ];
    default:
      return [{ href: "/login", label: "Sign in" }];
  }
}
