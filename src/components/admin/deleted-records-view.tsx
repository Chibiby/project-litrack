"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { TableSectionSkeleton } from "@/components/loading/table-section-skeleton";
import { ArchiveTeachersPanel, ARCHIVE_TEACHERS_KEYS } from "@/components/admin/archive-view";
import { DeletedLearnersView } from "@/components/admin/deleted-learners-view";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { listKey, type ListSearchParams } from "@/lib/nav/list-params";
// Type-only: `@/lib/admin/archive` and `@/lib/learners/deleted-learners` are
// `server-only`, and type imports are erased before that guard runs.
import type { ArchivePage, ArchivedTeacherRow } from "@/lib/admin/archive";
import type { DeletedLearnersPage } from "@/lib/learners/deleted-learners";

const ANY_SCHOOL = "any";

/**
 * Monitoring → Deleted Records: one filter bar over two lists.
 *
 * - Deleted teachers: Developer Admin only (`teachers` is null otherwise),
 *   paged by `?teachers=` and sorted by `?teachersSort=`.
 * - Deleted learners: every admin, paged by `?page=`. A Developer Admin can
 *   also delete a row permanently.
 *
 * The School and Search filters narrow both lists, so changing either resets
 * both pagers.
 */
export function DeletedRecordsView({
  teachers,
  learners,
  filters,
  params,
  canPurge,
}: {
  teachers: ArchivePage<ArchivedTeacherRow> | null;
  learners: DeletedLearnersPage;
  filters: { school: string; q: string };
  params: ListSearchParams;
  canPurge: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [pushedQ, setPushedQ] = useState(filters.q);

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY_SCHOOL) next.delete(key);
      else next.set(key, value);
    }
    next.delete("teachers");
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${ADMIN_ROUTES.deletedRecords}?${qs}` : ADMIN_ROUTES.deletedRecords));
  };

  const searchNow = (value: string) => {
    const term = value.trim();
    if (term === pushedQ) return;
    setPushedQ(term);
    apply({ q: term || null });
  };

  const filtered = Boolean(filters.school || filters.q);

  return (
    <div className="space-y-6">
      <Surface as="section" className="rounded-lg p-3 sm:p-4">
        <form
          className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="space-y-2">
            <Label htmlFor="deleted-records-school">School</Label>
            <Select
              value={filters.school || ANY_SCHOOL}
              onValueChange={(value) => apply({ school: value })}
              disabled={pending}
            >
              <SelectTrigger id="deleted-records-school" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_SCHOOL}>All schools</SelectItem>
                {learners.schools.map((school) => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SearchInput
            id="deleted-records-q"
            value={query}
            onValueChange={setQuery}
            onDebouncedChange={searchNow}
            resultCount={learners.total + (teachers?.total ?? 0)}
            label="Search name"
            labelVisible
            placeholder={teachers ? "Learner or teacher name" : "Learner name"}
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
              Clear
            </Button>
          ) : null}
        </form>
      </Surface>

      {teachers ? (
        <Suspense
          key={listKey(params, ARCHIVE_TEACHERS_KEYS)}
          fallback={<TableSectionSkeleton rows={8} columns={5} showToolbar={false} />}
        >
          <ArchiveTeachersPanel data={teachers} />
        </Suspense>
      ) : null}

      <DeletedLearnersView
        data={learners}
        filters={filters}
        showDistrict
        basePath={ADMIN_ROUTES.deletedRecords}
        showFilters={false}
        showHeading
        canPurge={canPurge}
      />
    </div>
  );
}
