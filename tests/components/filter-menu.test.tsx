import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterMenu, FilterMenuField } from "@/components/ui/filter-menu";
import { SEARCH_BAR_WIDTH } from "@/components/ui/search-input";

/**
 * The one Filters button every list page with more than one filter uses.
 */

afterEach(cleanup);

describe("FilterMenu", () => {
  it("keeps its filters out of the page until opened", () => {
    render(
      <FilterMenu>
        <FilterMenuField label="Status">
          <input aria-label="Status" />
        </FilterMenuField>
      </FilterMenu>
    );
    expect(screen.queryByLabelText("Status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByLabelText("Status")).not.toBeNull();
  });

  it("names how many filters are on, and offers Clear filters then", () => {
    const onClear = vi.fn();
    render(
      <FilterMenu activeCount={2} onClear={onClear}>
        <span>fields</span>
      </FilterMenu>
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters, 2 on" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("has no Clear filters while nothing is on", () => {
    render(
      <FilterMenu activeCount={0} onClear={() => {}}>
        <span>fields</span>
      </FilterMenu>
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
  });
});

describe("SEARCH_BAR_WIDTH", () => {
  it("is full width on phones and bounded from sm up", () => {
    expect(SEARCH_BAR_WIDTH).toContain("w-full");
    expect(SEARCH_BAR_WIDTH).toContain("sm:min-w-56");
    expect(SEARCH_BAR_WIDTH).toContain("sm:max-w-sm");
  });
});
