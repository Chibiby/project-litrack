/**
 * Isolates the exact React semantic a design decision rests on: does a
 * `<Suspense>` boundary that keeps the same `key` across a search-param
 * navigation re-show its `fallback`, or does React's transition machinery
 * keep the previously committed content on screen instead?
 *
 * Next.js App Router wraps same-route navigations (e.g. clicking "Next" on a
 * paginated list, which only changes `?page=`) in a transition. React's rule
 * for a transition that causes an *already-revealed* Suspense boundary to
 * suspend again is to keep the stale committed content visible rather than
 * fall back — that is a deliberate feature (avoids flicker), but it also
 * means a route's list-table skeleton silently never appears on `?page=`
 * changes if the boundary's identity (position + key) does not change
 * between the two pages of data.
 *
 * The fix under test: giving the boundary a `key` derived from the search
 * params makes the *next* page's boundary a distinct component identity, so
 * React discards the old committed tree and mounts a fresh boundary that
 * has nothing to preserve — which suspends into its fallback immediately,
 * transition or not.
 *
 * This file proves both halves without a server, a browser, or app code:
 *   1. same key across a transition-wrapped suspend -> fallback does NOT return
 *   2. different key across a transition-wrapped suspend -> fallback DOES return
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  Suspense,
  startTransition,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { act, cleanup, render, screen } from "@testing-library/react";

/** A minimal suspending resource, in the shape React's `use`-less Suspense expects: throw a promise while pending, throw the error or return the value once settled. */
function makeResource<T>() {
  let status: "pending" | "success" | "error" = "pending";
  let result: T;
  let error: unknown;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  }).then(
    (value) => {
      status = "success";
      result = value;
    },
    (err) => {
      status = "error";
      error = err;
    }
  );

  return {
    read(): T {
      if (status === "pending") throw promise;
      if (status === "error") throw error;
      return result;
    },
    settle(value: T) {
      resolve(value);
      // Let the internal `.then` above run so `read()` reflects "success"
      // the next time this resource is read.
      return promise;
    },
  };
}

type Resource = ReturnType<typeof makeResource<string>>;

function Content({ resource }: { resource: Resource }) {
  return <div data-testid="content">{resource.read()}</div>;
}

interface HarnessHandle {
  /** Swap in a new suspending resource, optionally under a new boundary key, inside startTransition — mirroring a Next.js searchParam navigation. */
  transitionTo: (resource: Resource, key: string) => void;
}

const Harness = forwardRef<HarnessHandle, { initialResource: Resource; initialKey: string }>(
  function Harness({ initialResource, initialKey }, ref) {
    const [state, setState] = useState({
      resource: initialResource,
      key: initialKey,
    });

    useImperativeHandle(ref, () => ({
      transitionTo(resource, key) {
        startTransition(() => {
          setState({ resource, key });
        });
      },
    }));

    return (
      <Suspense key={state.key} fallback={<div data-testid="fallback">Loading…</div>}>
        <Content resource={state.resource} />
      </Suspense>
    );
  }
);

afterEach(cleanup);

describe("keyed Suspense boundary across a transition-wrapped suspend", () => {
  it("same key: the fallback does NOT return, stale content is kept on screen", async () => {
    const resourceA = makeResource<string>();
    const ref = { current: null as HarnessHandle | null };

    render(<Harness ref={ref} initialResource={resourceA} initialKey="page-1" />);

    // Initial mount suspends -> fallback shows.
    expect(screen.getByTestId("fallback")).not.toBeNull();

    await act(async () => {
      await resourceA.settle("first page");
    });
    expect(screen.getByTestId("content").textContent).toBe("first page");
    expect(screen.queryByTestId("fallback")).toBeNull();

    // Same key, new suspending resource, wrapped in startTransition — this is
    // the shape of a same-route `?page=` navigation with an UNkeyed boundary.
    const resourceB = makeResource<string>();
    act(() => {
      ref.current!.transitionTo(resourceB, "page-1");
    });

    // The claim under test: the boundary does not fall back. The first
    // page's content is still what is on screen.
    expect(screen.queryByTestId("fallback")).toBeNull();
    expect(screen.getByTestId("content").textContent).toBe("first page");

    await act(async () => {
      await resourceB.settle("second page");
    });
    expect(screen.getByTestId("content").textContent).toBe("second page");
    expect(screen.queryByTestId("fallback")).toBeNull();
  });

  it("different key: the fallback DOES return, even inside the same transition", async () => {
    const resourceA = makeResource<string>();
    const ref = { current: null as HarnessHandle | null };

    render(<Harness ref={ref} initialResource={resourceA} initialKey="page-1" />);
    await act(async () => {
      await resourceA.settle("first page");
    });
    expect(screen.getByTestId("content").textContent).toBe("first page");
    expect(screen.queryByTestId("fallback")).toBeNull();

    // Different key (e.g. derived from the new searchParams), still wrapped
    // in startTransition. This is the fix: the boundary's identity changes,
    // so React has nothing committed under the new instance to preserve.
    const resourceB = makeResource<string>();
    act(() => {
      ref.current!.transitionTo(resourceB, "page-2");
    });

    expect(screen.getByTestId("fallback")).not.toBeNull();
    expect(screen.queryByTestId("content")).toBeNull();

    await act(async () => {
      await resourceB.settle("second page");
    });
    expect(screen.getByTestId("content").textContent).toBe("second page");
    expect(screen.queryByTestId("fallback")).toBeNull();
  });
});
