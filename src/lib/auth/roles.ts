import type { User, UserRole } from "@prisma/client";

export function isSuperAdmin(user: User): boolean {
  return user.role === "SUPER_ADMIN";
}

export function roleHomePath(role: UserRole): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "/admin";
    case "SCHOOL_HEAD":
      return "/school-head";
    case "TEACHER":
      return "/teacher";
  }
}
