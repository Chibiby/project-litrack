import { ContentRouteLoading } from "@/components/loading/content-route-loading";

/**
 * Content-only route fallback. Sidebar + breadcrumbs stay mounted in
 * `admin/layout.tsx` → RoleShell.
 */
export default function AdminLoading() {
  return <ContentRouteLoading />;
}
