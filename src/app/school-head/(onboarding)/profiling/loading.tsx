import { ContentRouteLoading } from "@/components/loading";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/** Minimal busy state — avoid flashing the school-head dashboard skeleton. */
export default function SchoolHeadProfilingLoading() {
  return (
    <PostLoginLoadingBridge>
      <ContentRouteLoading />
    </PostLoginLoadingBridge>
  );
}
