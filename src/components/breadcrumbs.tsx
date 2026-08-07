"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleHomePath } from "@/lib/auth/roles";

interface BreadcrumbsProps {
  className?: string;
}

// Map paths to readable labels
const pathLabels: Record<string, string> = {
  admin: "Admin",
  "admin/schools": "Schools",
  "admin/schools/new": "New School",
  "admin/transfers": "Transfers",
  "admin/school-years": "School years",
  "admin/audit": "Audit",
  "admin/profile": "Profile",
  "admin/password": "Change password",
  "school-head": "Dashboard",
  "school-head/grade-levels": "Grade Levels",
  "school-head/teachers": "Teachers",
  "school-head/profiling": "Profile",
  "school-head/profile": "Profile",
  "school-head/password": "Change password",
  teacher: "Dashboard",
  "teacher/profiling": "Profile",
  "teacher/profile": "Profile",
  "teacher/password": "Change password",
};

function roleHomeFromPath(pathname: string): string {
  const root = pathname.split("/").filter(Boolean)[0];
  if (root === "admin") return roleHomePath("SUPER_ADMIN");
  if (root === "school-head") return roleHomePath("SCHOOL_HEAD");
  if (root === "teacher") return roleHomePath("TEACHER");
  return "/";
}

export function Breadcrumbs({ className }: BreadcrumbsProps) {
  const pathname = usePathname();

  // Skip breadcrumbs on landing/login pages
  if (pathname === "/" || pathname === "/login" || pathname === "/admin/login") {
    return null;
  }

  const homeHref = roleHomeFromPath(pathname);

  // Build breadcrumb segments
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs: { label: string; href: string }[] = [];

  let currentPath = "";
  segments.forEach((segment, index) => {
    currentPath += `/${segment}`;

    // Skip ID segments, use parent label instead
    if (segment.length === 36 || /^[a-f0-9-]{36}$/.test(segment)) {
      return;
    }

    // Special handling for dynamic routes
    if (segment === "grade" && segments[index + 1]) {
      breadcrumbs.push({
        label: "Grade",
        href: currentPath,
      });
      return;
    }

    if (segment === "aral" && segments[index + 1]) {
      breadcrumbs.push({
        label: "ARAL",
        href: currentPath,
      });
      return;
    }

    if (segment === "learners" && segments[index + 1]) {
      breadcrumbs.push({
        label: "Learners",
        href: currentPath,
      });
      return;
    }

    const label =
      pathLabels[currentPath.replace(/^\//, "")] ||
      segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");

    breadcrumbs.push({
      label,
      href: currentPath,
    });
  });

  if (breadcrumbs.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center justify-start gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Link
        href={homeHref}
        prefetch={true}
        className="flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Home className="h-3.5 w-3.5" />
        <span className="sr-only">Home</span>
      </Link>

      {breadcrumbs.map((crumb, index) => (
        <div key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
          {index === breadcrumbs.length - 1 ? (
            <span className="font-medium text-foreground" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              prefetch={true}
              className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}
