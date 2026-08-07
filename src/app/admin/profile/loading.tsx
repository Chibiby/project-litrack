import { ContentRouteLoading } from "@/components/loading";

/** Minimal busy state — avoid flashing the admin dashboard skeleton. */
export default function AdminProfileLoading() {
  return <ContentRouteLoading />;
}
