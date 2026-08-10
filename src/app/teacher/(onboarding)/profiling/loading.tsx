import { ContentRouteLoading } from "@/components/loading";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/** Minimal busy state — avoid flashing the teacher dashboard skeleton. */
export default function TeacherProfilingLoading() {
  return (
    <PostLoginLoadingBridge>
      <ContentRouteLoading />
    </PostLoginLoadingBridge>
  );
}
