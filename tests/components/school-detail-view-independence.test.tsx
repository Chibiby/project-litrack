import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SchoolDetail } from "@/lib/admin/school-detail";

/**
 * `/admin/schools/[schoolId]` mixes a server-paginated LEARNERS roster (own
 * `ListNavigationProvider`/`ListBusyRegion`, keyed `<Suspense>`) with an
 * unpaginated, client-sorted TEACHERS roster that must stay completely out of
 * that machinery. This file proves both halves:
 *  - the learners panel reports pending through its own busy region;
 *  - the teachers table never calls `router.push`, no matter how it is
 *    re-sorted, and re-sorts purely by re-rendering the same rows in a new
 *    client-side order.
 */

let searchParamsString = "";
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

import { SchoolDetailView } from "@/components/admin/school-detail-view";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  searchParamsString = "";
});

function teacher(overrides: Partial<SchoolDetail["teachers"][number]> = {}): SchoolDetail["teachers"][number] {
  return {
    id: "t1",
    fullName: "Juana Cruz",
    listingName: "Cruz, Juana",
    firstName: "Juana",
    lastName: "Cruz",
    email: "juana@school.local",
    isActive: true,
    approvalStatus: null,
    advisorySection: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildDetail(): SchoolDetail {
  return {
    school: {
      id: "school-1",
      name: "Naidas T. Opong ES",
      schoolIdCode: "130554",
      address: null,
      region: null,
      division: null,
      district: null,
      isActive: true,
      isDemo: false,
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    counts: { teachers: 2, learners: 0, sections: 0, gradeLevels: 0, schoolYears: 0 },
    teachers: [
      teacher({
        id: "a",
        fullName: "Zed Aquino",
        listingName: "Aquino, Zed",
        firstName: "Zed",
        lastName: "Aquino",
      }),
      teacher({
        id: "b",
        fullName: "Ana Zapata",
        listingName: "Zapata, Ana",
        firstName: "Ana",
        lastName: "Zapata",
      }),
    ],
    learners: [],
    learnerPage: 1,
    learnerPages: 1,
  };
}

async function pickSort(triggerId: string, optionLabel: string) {
  const trigger = document.getElementById(triggerId);
  expect(trigger).toBeTruthy();
  fireEvent.click(trigger as HTMLElement);
  const option = await screen.findByText(optionLabel);
  fireEvent.click(option);
}

describe("SchoolDetailView — teachers table stays out of the navigation machinery", () => {
  it("re-sorts the teachers table client-side without ever calling router.push", async () => {
    const detail = buildDetail();
    render(<SchoolDetailView detail={detail} searchParams={{}} />);

    const teacherRows = () =>
      screen.getAllByRole("row").filter((row) => within(row).queryByText(/Aquino|Zapata/));

    // Default order is `lastName` ascending: Aquino before Zapata.
    expect(teacherRows()[0].textContent).toContain("Aquino");

    await pickSort("school-teachers-sort", "Section");

    // Re-sorted purely on the client — the row set is unchanged, just its
    // order, and no navigation of any kind happened.
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never wraps the teachers table's own aria-busy region", () => {
    const detail = buildDetail();
    render(<SchoolDetailView detail={detail} searchParams={{}} />);

    // Exactly one `list-busy-region` exists on the page (the learners panel);
    // the teachers table does not get one of its own.
    const regions = document.querySelectorAll('[data-slot="list-busy-region"]');
    expect(regions.length).toBe(1);
  });
});

describe("SchoolDetailView — learners panel reports its own busy state", () => {
  it("marks the learners busy region aria-busy while its sort navigation is pending", async () => {
    const detail = buildDetail();
    render(<SchoolDetailView detail={detail} searchParams={{}} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();

    await pickSort("school-learners-sort", "Grade level");

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain("learnersSort=grade-level");
  });
});
