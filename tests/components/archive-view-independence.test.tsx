import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
 */

let searchParamsString = "";
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

import { ArchiveTeachersPanel, ArchiveLearnersPanel } from "@/components/admin/archive-view";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  push.mockClear();
  searchParamsString = "";
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

    push.mockClear();
    await pickSort("archive-learners-sort", "School");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain("learnersSort=school");
  });
});
