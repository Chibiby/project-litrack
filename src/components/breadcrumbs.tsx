"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbsProps {
  className?: string;
}

// Map paths to readable labels
const pathLabels: Record<string, string> = {
  admin: "Admin",
  "admin/schools": "Schools",
  "admin/schools/new": "New School",
  "school-head": "Dashboard",
  "school-head/grade-levels": "Grade Levels",
  "school-head/teachers": "Teachers",
  "school-head/profiling": "Profile",
  teacher: "Dashboard",
  "teacher/profiling": "Profile",
};

export function Breadcrumbs({ className }: BreadcrumbsProps) {
  const pathname = usePathname();
  
  // Skip breadcrumbs on landing/login pages
  if (pathname === "/" || pathname === "/login" || pathname === "/admin/login") {
    return null;
  }

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
    
    const label = pathLabels[currentPath.replace(/^\//, "")] || 
      segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
    
    breadcrumbs.push({
      label,
      href: currentPath,
    });
  });

  if (breadcrumbs.length === 0) return null;

  return (
    <nav className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", className)}>
      <Link
        href="/"
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
        <span className="sr-only">Home</span>
      </Link>
      
      {breadcrumbs.map((crumb, index) => (
        <div key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-4 w-4" />
          {index === breadcrumbs.length - 1 ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : (
            <Link
              href={crumb.href}
              className="hover:text-foreground transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}
