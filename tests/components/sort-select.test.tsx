import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SortSelect } from "@/components/ui/sort-select";
import { ListNavigationProvider, useListPending } from "@/components/nav/list-navigation";
import type { SortOption } from "@/lib/sort/registry";

/**
 * `SortSelect` is the shared "Sort by" control every data table will adopt.
 * The behaviour most likely to regress is `mode: "link"` dropping the `page`
 * param on re-sort while keeping every other existing query param, so that
 * is asserted explicitly rather than just snapshotted.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParamsString = "page=1";
});

const push = vi.fn();
let searchParamsString = "page=1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ toString: () => searchParamsString }),
}));

type Sort = "name" | "age";
const options: readonly SortOption<Sort>[] = [
  { value: "name", label: "Name (A–Z)" },
  { value: "age", label: "Age (youngest first)" },
];

async function pickAge() {
  fireEvent.click(screen.getByRole("combobox"));
  const option = await screen.findByText("Age (youngest first)");
  fireEvent.click(option);
}

describe("SortSelect", () => {
  it("link mode: sets the sort param, drops page, and keeps other params", async () => {
    render(
      <SortSelect
        mode="link"
        basePath="/teacher/learners"
        value="name"
        options={options}
        searchParams={{ q: "maria", page: "3", sort: "name" }}
      />
    );

    await pickAge();

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("sort=age");
    expect(href).not.toContain("page=");
    expect(href).toContain("q=maria");
  });

  it("link mode: honours a custom param name", async () => {
    render(
      <SortSelect
        mode="link"
        basePath="/teacher/reports"
        value="name"
        options={options}
        paramName="pendingSort"
        searchParams={{ pendingSort: "name", page: "2" }}
      />
    );

    await pickAge();

    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("pendingSort=age");
    expect(href).not.toContain("page=");
    expect(href).not.toMatch(/(?<!pending)[?&]sort=/);
  });

  it("client mode: calls onSortChange with the chosen value", async () => {
    const onSortChange = vi.fn();
    render(
      <SortSelect
        mode="client"
        value="name"
        options={options}
        onSortChange={onSortChange}
      />
    );

    await pickAge();

    expect(onSortChange).toHaveBeenCalledWith("age");
  });

  it("reflects the current value as selected", () => {
    render(
      <SortSelect
        mode="client"
        value="age"
        options={options}
        onSortChange={vi.fn()}
      />
    );

    expect(screen.getByRole("combobox").textContent).toContain("Age (youngest first)");
  });

  it("client mode: never calls router.push", async () => {
    const onSortChange = vi.fn();
    render(
      <SortSelect
        mode="client"
        value="name"
        options={options}
        onSortChange={onSortChange}
      />
    );

    await pickAge();

    expect(onSortChange).toHaveBeenCalledWith("age");
    expect(push).not.toHaveBeenCalled();
  });

  it("link mode inside a ListNavigationProvider raises the shared pending state on change", async () => {
    function PendingProbe() {
      const pending = useListPending();
      return <span data-testid="pending">{String(pending)}</span>;
    }

    render(
      <ListNavigationProvider>
        <PendingProbe />
        <SortSelect
          mode="link"
          basePath="/teacher/learners"
          value="name"
          options={options}
          searchParams={{ q: "maria", page: "3", sort: "name" }}
        />
      </ListNavigationProvider>
    );

    expect(screen.getByTestId("pending").textContent).toBe("false");

    await pickAge();

    expect(screen.getByTestId("pending").textContent).toBe("true");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("link mode without a ListNavigationProvider still navigates instead of throwing", async () => {
    expect(() =>
      render(
        <SortSelect
          mode="link"
          basePath="/schools"
          value="name"
          options={options}
          searchParams={{ page: "2" }}
        />
      )
    ).not.toThrow();

    await pickAge();

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("sort=age");
    expect(href).not.toContain("page=");
  });
});
