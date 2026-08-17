import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Root fallback — deliberately blank.
 *
 * This is the boundary above every layout in the app, so it is what shows
 * while an async *layout* resolves: `/teacher`, `/school-head` and `/admin`
 * all suspend here before their RoleShell exists. A segment's own
 * `loading.tsx` cannot cover that, because it wraps the segment's children
 * rather than the layout that renders them.
 *
 * It used to draw a teacher dashboard here — four metric cards and two chart
 * panels in a centred max-w-7xl column. That shape appeared chrome-less on the
 * first paint of every route in the app, including ones that look nothing like
 * it, and read as a broken page rather than a loading one. There is no correct
 * skeleton for this slot: the boundary cannot know which role or route is
 * arriving. It renders nothing and lets the browser hold its current paint
 * until real HTML arrives.
 *
 * The file itself must stay. It is the first fallback streamed on a post-login
 * hard navigation, and `PostLoginLoadingBridge` paints the cream cover that
 * bridges into `PostLoginSplash`; without it the login page flashes through.
 *
 * Per-route busy states belong in each segment's own `loading.tsx`, which runs
 * inside the mounted shell — the well-behaved case.
 */
export default function Loading() {
  return <PostLoginLoadingBridge>{null}</PostLoginLoadingBridge>;
}
