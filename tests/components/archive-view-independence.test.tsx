import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `/admin/archive` renders two independent lists (removed teachers, removed
 * learners) on one URL, each behind its own `ListNavigationProvider`/
 * `ListBusyRegion` pair (see `ArchiveTeachersPanel`/`ArchiveLearnersPanel` in
 * `archive-view.tsx`). This file is the "does it actually behave
 * independently" half of that guarantee — `archive-list-keys.test.ts` covers
 * the Suspense-key computation itself.
 *
 * Both panels are rendered with empty rows so `TeacherRowActions`/
 * `LearnerRowActions` (which pull in server actions, Prisma, Supabase) never
 * mount — the "Sort by" control, which triggers `useListNavigate`, is
 * rendered regardless of row count.
 *
 * Each panel's pending flag is DERIVED (`useTransition` for its "Sort by"
 * control's programmatic `router.push`, OR'd with a count of `<Link>`s
 * reporting in flight via `useLinkStatus`), not latched — see
 * `list-navigation.tsx`. Unlike the other `*-instant-feedback` test files,
 * this one drives that transition with a genuinely async `push` mock (a
 * `Promise` this file resolves itself) rather than reaching for
 * `useLinkStatus`/`LinkStatusPulse` — React 19's `startTransition` keeps
 * `isPending` true for as long as the callback's returned promise is
 * unsettled, which is a faithful stand-in for the real RSC round trip and
 * lets the shared flag be observed at its actual source (the "Sort by"
 * control's own `router.push`) instead of a pager link neither panel here
 * has reason to render.
 */

let searchParamsString = "";

/** Resolver for whichever `push` call is currently in flight, if any. */
let resolvePush: (() => void) | null = null;
const push = vi.fn(
  (_href: string) =>
    new Promise<void>((resolve) => {
      resolvePush = resolve;
    })
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

/**
 * Real `Link`, stubbed `useLinkStatus`. The pager-placement guard at the
 * bottom of this file needs a link that reports itself as navigating.
 */
let linkPending = false;
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => ({ pending: linkPending }) };
});

import { ArchiveTeachersPanel, ArchiveLearnersPanel } from "@/components/admin/archive-view";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(async () => {
  // Settle any still-pending navigation before the next test, so a left-open
  // transition can never bleed pending state (or an act() warning) across
  // tests.
  await act(async () => {
    resolvePush?.();
    resolvePush = null;
  });
  cleanup();
  push.mockClear();
  searchParamsString = "";
  linkPending = false;
});

const emptyTeachers = { rows: [], page: 1, pages: 1, total: 0 };
const emptyLearners = { rows: [], page: 1, pages: 1, total: 0 };

function renderBothPanels() {
  return render(
    <div>
      <ArchiveTeachersPanel data={emptyTeachers} />
      <ArchiveLearnersPanel data={emptyLearners} />
    </div>
  );
}

async function pickSort(triggerId: string, optionLabel: string) {
  const trigger = document.getElementById(triggerId);
  expect(trigger).toBeTruthy();
  fireEvent.click(trigger as HTMLElement);
  const option = await screen.findByText(optionLabel);
  fireEvent.click(option);
}

function busyRegions() {
  return Array.from(document.querySelectorAll('[data-slot="list-busy-region"]'));
}

describe("Archive page — teachers/learners busy-region independence", () => {
  it("re-sorting TEACHERS marks only the teachers region aria-busy, not learners", async () => {
    renderBothPanels();
    const [teachersRegion, learnersRegion] = busyRegions();
    expect(teachersRegion.getAttribute("aria-busy")).toBeNull();
    expect(learnersRegion.getAttribute("aria-busy")).toBeNull();

    await pickSort("archive-teachers-sort", "Alphabetical");

    expect(teachersRegion.getAttribute("aria-busy")).toBe("true");
    expect(learnersRegion.getAttribute("aria-busy")).toBeNull();
  });

  it("re-sorting LEARNERS marks only the learners region aria-busy, not teachers", async () => {
    renderBothPanels();
    const [teachersRegion, learnersRegion] = busyRegions();

    await pickSort("archive-learners-sort", "Alphabetical");

    expect(learnersRegion.getAttribute("aria-busy")).toBe("true");
    expect(teachersRegion.getAttribute("aria-busy")).toBeNull();
  });

  it("navigates via a pushed href, not history.pushState, for both buckets", async () => {
    renderBothPanels();
    await pickSort("archive-teachers-sort", "School");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain("teachersSort=school");

    await act(async () => {
      resolvePush?.();
    });
    push.mockClear();
    await pickSort("archive-learners-sort", "School");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain("learnersSort=school");
  });
});

/**
 * The pager must render OUTSIDE its `ListBusyRegion`.
 *
 * Inside it, going busy swaps the rows — and the pager with them — for the
 * skeleton. That unmounts the `LinkStatusPulse` which is the very thing
 * reporting the pending state, so its effect cleanup withdraws the report,
 * pending drops, the pager remounts, the still-navigating link reports again,
 * and React aborts the render with "Maximum update depth exceeded". It is a
 * crash, not a cosmetic problem, and it is invisible to every test that
 * drives pending through a programmatic `push` instead of a link.
 *
 * What the assertion below actually detects is the PLACEMENT — that a link
 * inside the pager reaches the shared flag while the pager itself survives
 * the swap. Moving the pager back inside the region was verified to turn this
 * red (`expected null to be 'true'`), because in there it also falls inside
 * the non-empty-rows branch and stops rendering altogether. It is a guard on
 * the structure, not a reproduction of the render loop.
 */
describe("Archive page — pager placement relative to the busy region", () => {
  it("stays mounted and stable while a pager link reports itself navigating", () => {
    linkPending = true;

    // `pages: 2` so the pager renders at all; rows stay empty so the row
    // actions (server actions, Prisma, Supabase) never mount.
    expect(() =>
      render(<ArchiveTeachersPanel data={{ rows: [], page: 1, pages: 2, total: 0 }} />)
    ).not.toThrow();

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region).toBeTruthy();
    // The link's report reached the shared flag...
    expect(region?.getAttribute("aria-busy")).toBe("true");
    // ...and the pager it came from is still on screen rather than having been
    // swapped out by the skeleton it just triggered.
    expect(screen.getByText("Next")).toBeTruthy();
    expect(region?.contains(screen.getByText("Next"))).toBe(false);
  });
});
