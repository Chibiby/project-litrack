import { ContentRouteLoading } from "@/components/loading/content-route-loading";

/**
 * Root fallback for first paint only. Role layouts replace this with RoleShell;
 * avoid a full-screen dashboard skeleton that feels like a second layout pass.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <ContentRouteLoading />
    </div>
  );
}
