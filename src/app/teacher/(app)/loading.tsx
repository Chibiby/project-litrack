import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Shell-level busy state for the whole `/teacher` tree — deliberately blank.
 *
 * This boundary sits above the layout, so whatever it renders appears without
 * the sidebar or header and on every teacher route at once. Any skeleton here
 * is therefore a guess at a page it cannot know, and on a hard refresh it read
 * as a broken page rather than a loading one. Rendering nothing lets the
 * browser hold the current paint until the real HTML arrives.
 *
 * The file still exists for `PostLoginLoadingBridge`: post-login hard
 * navigations need its cream cover to bridge into `PostLoginSplash`. Deleting
 * the route would drop that cover and flash the login page instead.
 *
 * Per-route busy states live in each segment's own `loading.tsx`, inside the
 * mounted shell, which is the well-behaved case.
 */
export default function TeacherLoading() {
  return <PostLoginLoadingBridge>{null}</PostLoginLoadingBridge>;
}
