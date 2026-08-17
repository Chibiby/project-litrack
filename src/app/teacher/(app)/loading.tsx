import { ContentRouteLoading } from "@/components/loading";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Shell-level busy state for the whole `/teacher` tree.
 *
 * This boundary wraps the layout's *children*, so it runs inside a mounted
 * RoleShell — and it covers every teacher route at once: dashboard, roster,
 * ARAL, reports. It therefore cannot know which page is arriving, and there is
 * no skeleton that is correct for all of them. Drawing a table here put a table
 * on top of the dashboard, then handed over to the dashboard's own skeleton —
 * two different skeletons in a row, which reads as a broken page rather than a
 * loading one.
 *
 * So it stays shape-neutral: a progress hint and nothing that pretends to be
 * the page. Each route that knows its own shape ships a `loading.tsx` that
 * mirrors its page's first paint — see `(dashboard)/loading.tsx` and
 * `learners/loading.tsx`.
 *
 * `PostLoginLoadingBridge` must stay: it paints the cream cover that bridges
 * into `PostLoginSplash` on a hard navigation.
 */
export default function TeacherLoading() {
  return (
    <PostLoginLoadingBridge>
      <ContentRouteLoading />
    </PostLoginLoadingBridge>
  );
}
