import { ContentRouteLoading } from "@/components/loading/content-route-loading";

/**
 * Content-only route fallback. Sidebar + breadcrumbs stay mounted in
 * `school-head/layout.tsx` → RoleShell.
 */
export default function SchoolHeadLoading() {
  return <ContentRouteLoading />;
}
