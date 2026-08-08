import { ContentRouteLoading } from "@/components/loading";

/** Minimal busy state — avoid flashing the school-head dashboard skeleton. */
export default function SchoolHeadSettingsLoading() {
  return <ContentRouteLoading />;
}
