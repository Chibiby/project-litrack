"use client";

import { SelectItem } from "@/components/ui/select";
import { FacetSelect } from "@/components/ui/facet-select";
import { useListNavigate } from "@/components/nav/list-navigation";
import type { SortOption } from "@/lib/sort/registry";

type LinkProps<K extends string> = {
  mode?: "link";
  basePath: string;
  value: K;
  options: readonly SortOption<K>[];
  searchParams: Record<string, string | undefined>;
  /**
   * URL param name, for pages that hold two independently sortable tables
   * (e.g. `pendingSort` alongside `sort`). Defaults to `"sort"`.
   */
  paramName?: string;
  id?: string;
};

type ClientProps<K extends string> = {
  mode: "client";
  value: K;
  options: readonly SortOption<K>[];
  onSortChange: (value: K) => void;
  id?: string;
  /**
   * Optional caller-supplied pending flag (e.g. a caller managing its own
   * `startTransition`). Client mode never touches `ListNavigationProvider`
   * itself, so this is the only way a client-mode consumer can surface a
   * pending state through `SortSelect`. Defaults to `false` and is purely
   * additive: existing callers (e.g. `learner-list-toolbar.tsx`) that don't
   * pass it are unaffected.
   */
  pending?: boolean;
};

export type SortSelectProps<K extends string> = LinkProps<K> | ClientProps<K>;

/**
 * Build the "sort by" href: sets `paramName` to the chosen value and always
 * drops `page`. Page 3 of an alphabetical list is meaningless once the list
 * is reordered by date, and keeping it strands the user on an out-of-range
 * page, so re-sorting always returns to page 1. Every other existing query
 * param (search text, other filters) is preserved.
 */
function hrefFor(
  basePath: string,
  paramName: string,
  value: string,
  searchParams: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v !== undefined && v !== "" && k !== "page" && k !== paramName) {
      params.set(k, v);
    }
  }
  params.set(paramName, value);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Exported for tests and for callers that need to build the href elsewhere. */
export { hrefFor as sortSelectHrefFor };

/**
 * Shared "Sort by" control for every data table, dual-mode like
 * `LearnerPagination`: `mode: "link"` (basePath + searchParams, navigates via
 * a computed href, always dropping `page`) or `mode: "client"`
 * (`onSortChange` callback). Wraps `FacetSelect` so the label/value markup
 * and a11y match every other facet on the page.
 */
export function SortSelect<K extends string>(props: SortSelectProps<K>) {
  const { options, value, id = "sort-by" } = props;
  const navigate = useListNavigate();

  if (props.mode === "client") {
    const { onSortChange, pending = false } = props;
    return (
      <span aria-busy={pending} className="inline-block w-full">
        <FacetSelect
          id={id}
          label="Sort by"
          value={value}
          onValueChange={(v) => onSortChange(v as K)}
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </FacetSelect>
      </span>
    );
  }

  const { basePath, searchParams, paramName = "sort" } = props;
  return (
    <FacetSelect
      id={id}
      label="Sort by"
      value={value}
      onValueChange={(v) => {
        navigate(hrefFor(basePath, paramName, v, searchParams));
      }}
    >
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </FacetSelect>
  );
}
