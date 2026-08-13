"use client";

import { PrefetchLink } from "@/components/nav/prefetch-link";
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
  "admin/settings": "Settings",
  "admin/settings/profile": "Profile",
  "admin/settings/security": "Security",
  "school-head": "Dashboard",
  "school-head/grade-levels": "Grade Levels",
  "school-head/teachers": "Teachers",
  "school-head/profiling": "Profile",
  "school-head/profile": "Profile",
  "school-head/password": "Change password",
  "school-head/settings": "Settings",
  "school-head/settings/profile": "Profile",
  "school-head/settings/security": "Security",
  teacher: "Dashboard",
  "teacher/profiling": "Profile",
  "teacher/profile": "Profile",
  "teacher/password": "Change password",
  "teacher/settings": "Settings",
  "teacher/settings/profile": "Profile",
  "teacher/settings/security": "Security",
};

function roleHomeFromPath(pathname: string): string {
  const root = pathname.split("/").filter(Boolean)[0];
  if (root === "admin") return roleHomePath("SUPER_ADMIN");
  if (root === "school-head") return roleHomePath("SCHOOL_HEAD");
  if (root === "teacher") return roleHomePath("TEACHER");
  return "/";
}

function isUuidSegment(segment: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(segment);
}

/** Real parent page for resource crumbs when the next segment is a UUID. */
function resourceHrefWithId(
  currentPath: string,
  nextSegment: string | undefined,
): string {
  if (nextSegment && isUuidSegment(nextSegment)) {
    return `${currentPath}/${nextSegment}`;
  }
  return currentPath;
}

/**
 * `/teacher/grade/{id}/learners` has no index route — point Learners at the
 * grade (or aral) page that actually exists.
 */
function learnersCrumbHref(segments: string[], currentPath: string, nextSegment: string | undefined): string {
  const gradeIdx = segments.indexOf("grade");
  if (gradeIdx >= 0 && segments[gradeIdx + 1] && isUuidSegment(segments[gradeIdx + 1])) {
    return `/${segments.slice(0, gradeIdx + 2).join("/")}`;
  }
  const aralIdx = segments.indexOf("aral");
  if (aralIdx >= 0 && segments[aralIdx + 1] && isUuidSegment(segments[aralIdx + 1])) {
    return `/${segments.slice(0, aralIdx + 2).join("/")}`;
  }
  return resourceHrefWithId(currentPath, nextSegment);
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

    // Skip ID segments (labels come from the parent resource crumb)
    if (isUuidSegment(segment)) {
      return;
    }

    const nextSegment = segments[index + 1];

    // Special handling for dynamic routes — include the UUID in href
    if (segment === "grade" && nextSegment && isUuidSegment(nextSegment)) {
      breadcrumbs.push({
        label: "Grade",
        href: resourceHrefWithId(currentPath, nextSegment),
      });
      return;
    }

    if (segment === "aral" && nextSegment && isUuidSegment(nextSegment)) {
      breadcrumbs.push({
        label: "ARAL",
        href: resourceHrefWithId(currentPath, nextSegment),
      });
      return;
    }

    if (segment === "learners" && nextSegment && isUuidSegment(nextSegment)) {
      breadcrumbs.push({
        label: "Learners",
        href: learnersCrumbHref(segments, currentPath, nextSegment),
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
        "flex items-center justify-start gap-1.5 text-sm text-muted-foreground",
        className,
      )}
    >
      <PrefetchLink
        href={homeHref}
        prefetch={true}
        className="flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Home className="h-4 w-4" />
        <span className="sr-only">Home</span>
      </PrefetchLink>

      {breadcrumbs.map((crumb, index) => (
        <div key={`${crumb.label}-${crumb.href}-${index}`} className="flex items-center gap-1.5">
          <ChevronRight className="h-4 w-4 opacity-50" aria-hidden />
          {index === breadcrumbs.length - 1 ? (
            <span className="font-medium text-foreground" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <PrefetchLink
              href={crumb.href}
              prefetch={true}
              className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {crumb.label}
            </PrefetchLink>
          )}
        </div>
      ))}
    </nav>
  );
}
