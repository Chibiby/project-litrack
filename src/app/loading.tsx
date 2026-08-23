import { BookLoader } from "@/components/loading";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Root fallback — the book shelf, and nothing route-shaped.
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
 * it, and read as a broken page rather than a loading one. The objection was
 * never to *drawing* something, it was that no route-shaped drawing can be
 * right here: the boundary cannot know which role or route is arriving.
 *
 * The shelf answers that, which is why the slot is no longer blank. It carries
 * no layout of its own to be wrong about — no cards, no columns, no table — so
 * it cannot mispredict the page behind it, and it is the same animation the
 * post-login splash already spends three seconds on, so it reads as this
 * product waiting rather than as a generic spinner. Blank was the right call
 * only while the alternative was a guess at someone else's page.
 *
 * The file itself must stay regardless. It is the first fallback streamed on a
 * post-login hard navigation, and `PostLoginLoadingBridge` paints the cream
 * cover that bridges into `PostLoginSplash`; without it the login page flashes
 * through. That path never reaches the shelf below — the bridge drops its
 * children in `cover` and `boot` mode — so the two do not compete.
 *
 * Per-route busy states still belong in each segment's own `loading.tsx`, which
 * runs inside the mounted shell and can afford a shape-matched skeleton.
 */
export default function Loading() {
  return (
    <PostLoginLoadingBridge>
      <div
        className="flex min-h-[100svh] w-full items-center justify-center"
        aria-busy="true"
      >
        <BookLoader />
      </div>
    </PostLoginLoadingBridge>
  );
}
