"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Label } from "@/components/ui/label";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListBusyRegion } from "@/components/loading/list-busy-region";
import { TableSectionSkeleton } from "@/components/loading/table-section-skeleton";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { DeletedLearnersTable } from "@/components/admin/deleted-records-tables";
import { RecordsPager } from "@/components/admin/records-pager";
import type { DeletedLearnersPage } from "@/lib/learners/deleted-learners";

const ANY_SCHOOL = "any";

/**
 * The district Deleted learners page: School / Search filters, the list, and
 * a numbered pager with rows per page. Super Admins see the same list as a
 * tab of Monitoring → Deleted Records.
 */
export function DeletedLearnersView({
  data,
  filters,
  showDistrict,
  basePath,
  pageSize,
}: {
  data: DeletedLearnersPage;
  filters: { school: string; q: string };
  /** Admins over more than one district also see each school's district. */
  showDistrict: boolean;
  basePath: string;
  pageSize: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [pushedQ, setPushedQ] = useState(filters.q);
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(() => new Set());

  const rows = data.rows.filter((row) => !goneIds.has(row.id));
  const filtered = Boolean(filters.school || filters.q);

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY_SCHOOL) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath));
  };

  const searchNow = (value: string) => {
    const term = value.trim();
    if (term === pushedQ) return;
    setPushedQ(term);
    apply({ q: term || null });
  };

  return (
    <div className="space-y-6">
      <Surface as="section" aria-label="Filters" className="rounded-lg p-3 sm:p-4">
        <form
          className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="space-y-2">
            <Label htmlFor="deleted-learners-school">School</Label>
            <Select
              value={filters.school || ANY_SCHOOL}
              onValueChange={(value) => apply({ school: value })}
              disabled={pending}
            >
              <SelectTrigger id="deleted-learners-school" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_SCHOOL}>All schools</SelectItem>
                {data.schools.map((school) => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SearchInput
            id="deleted-learners-q"
            value={query}
            onValueChange={setQuery}
            onDebouncedChange={searchNow}
            resultCount={data.total}
            label="Search name"
            labelVisible
            placeholder="Learner name"
            className="w-full sm:w-64"
          />

          {filtered ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setQuery("");
                setPushedQ("");
                apply({ school: null, q: null });
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </form>
      </Surface>

      <ListNavigationProvider>
        <Surface as="section" aria-label="Deleted learners" className="min-w-0 space-y-3 rounded-lg p-4 sm:p-5">
          <ListBusyRegion
            label="deleted learners"
            skeleton={<TableSectionSkeleton rows={8} columns={7} showToolbar={false} />}
          >
            {rows.length === 0 ? (
              <EmptyState
                title={filtered ? "No deleted learners match" : "No deleted learners"}
                description={
                  filtered
                    ? "Try a different name or school, or clear the filters."
                    : "Learners removed by teachers move here 30 days after removal."
                }
                icon={UserX}
              />
            ) : (
              <DeletedLearnersTable
                rows={rows}
                showDistrict={showDistrict}
                onGone={(id) => setGoneIds((prev) => new Set(prev).add(id))}
              />
            )}
          </ListBusyRegion>
          <RecordsPager
            basePath={basePath}
            page={data.page}
            totalPages={data.pages}
            totalCount={data.total}
            pageSize={pageSize}
            noun="deleted learners"
            idPrefix="deleted-learners"
          />
        </Surface>
      </ListNavigationProvider>
    </div>
  );
}
