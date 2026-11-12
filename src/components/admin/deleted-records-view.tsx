"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { GraduationCap, SearchX, UserX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { SortSelect } from "@/components/ui/sort-select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListBusyRegion } from "@/components/loading/list-busy-region";
import { TableSectionSkeleton } from "@/components/loading/table-section-skeleton";
import {
  LinkStatusPulse,
  ListNavigationProvider,
  useListNavigate,
  useListPending,
} from "@/components/nav/list-navigation";
import { DeletedLearnersTable, DeletedTeachersTable } from "@/components/admin/deleted-records-tables";
import { RecordsPager } from "@/components/admin/records-pager";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { ARCHIVE_LEARNER_SORTS, ARCHIVE_TEACHER_SORTS } from "@/lib/admin/archive-sorts";
import { cn } from "@/lib/utils";
// Type-only: these modules are `server-only`; type imports are erased first.
import type { ArchivePage, ArchivedTeacherRow } from "@/lib/admin/archive";
import type { DeletedLearnerRow } from "@/lib/learners/deleted-learners";

const ANY_SCHOOL = "any";
const BASE = ADMIN_ROUTES.deletedRecords;

export type DeletedRecordsTab = "learners" | "teachers";

export type DeletedRecordsData = {
  tab: DeletedRecordsTab;
  /** Null for a Division Admin: deleted teachers are a Developer Admin list. */
  teacherCount: number | null;
  learnerCount: number;
  /** The open tab's rows; the other tab only has its count. */
  list:
    | { kind: "teachers"; page: ArchivePage<ArchivedTeacherRow> }
    | { kind: "learners"; page: ArchivePage<DeletedLearnerRow> };
  pageSize: number;
  sort: string;
  schools: { id: string; name: string }[];
};

/**
 * Monitoring → Deleted Records. One School / Search bar, then one card with a
 * Learners tab and (Developer Admin) a Teachers tab. Only the open tab's rows
 * are loaded; each tab shows its count, and the filters narrow both.
 *
 * URL: `?tab=teachers` (learners is the default), `?school=`, `?q=`, `?sort=`,
 * `?page=`, `?perPage=`. Switching tab drops `page` and `sort`, which belong
 * to one list; the filters stay.
 */
export function DeletedRecordsView({
  data,
  filters,
  canPurge,
}: {
  data: DeletedRecordsData;
  filters: { school: string; q: string };
  canPurge: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [pushedQ, setPushedQ] = useState(filters.q);
  const showTabs = data.teacherCount !== null;

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY_SCHOOL) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${BASE}?${qs}` : BASE));
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
      <Surface as="section" aria-label="Filters" className="rounded-lg p-3 sm:p-4">
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
                {data.schools.map((school) => (
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
            resultCount={data.learnerCount + (data.teacherCount ?? 0)}
            label="Search name"
            labelVisible
            placeholder={showTabs ? "Learner or teacher name" : "Learner name"}
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
        <RecordsCard data={data} showTabs={showTabs} filtered={filtered} canPurge={canPurge} />
      </ListNavigationProvider>
    </div>
  );
}

/** The tabs, the list and its pager. A child of the provider so its hooks read it. */
function RecordsCard({
  data,
  showTabs,
  filtered,
  canPurge,
}: {
  data: DeletedRecordsData;
  showTabs: boolean;
  filtered: boolean;
  canPurge: boolean;
}) {
  const searchParams = useSearchParams();
  const navigate = useListNavigate();
  const pending = useListPending();
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(() => new Set());
  const markGone = (id: string) => setGoneIds((prev) => new Set(prev).add(id));

  const tabHref = (tab: DeletedRecordsTab) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page");
    next.delete("sort");
    if (tab === "learners") next.delete("tab");
    else next.set("tab", tab);
    const qs = next.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };

  const applySort = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("sort", value);
    next.delete("page");
    navigate(`${BASE}?${next.toString()}`);
  };

  const { list } = data;
  const page = list.page;
  const isTeachers = list.kind === "teachers";
  const noun = isTeachers ? "deleted teachers" : "deleted learners";
  const sorts = isTeachers ? ARCHIVE_TEACHER_SORTS : ARCHIVE_LEARNER_SORTS;
  const outOfRange = page.total > 0 && page.page > page.pages;

  const tabs: { id: DeletedRecordsTab; label: string; count: number; icon: typeof Users }[] = [
    { id: "learners", label: "Learners", count: data.learnerCount, icon: GraduationCap },
    ...(data.teacherCount !== null
      ? [{ id: "teachers" as const, label: "Teachers", count: data.teacherCount, icon: Users }]
      : []),
  ];

  const body = () => {
    if (outOfRange) {
      return (
        <EmptyState
          title={`Page ${page.page.toLocaleString()} is past the end`}
          description={`There ${page.pages === 1 ? "is 1 page" : `are ${page.pages.toLocaleString()} pages`} of ${noun}.`}
          actionHref={(() => {
            const next = new URLSearchParams(searchParams.toString());
            next.delete("page");
            const qs = next.toString();
            return qs ? `${BASE}?${qs}` : BASE;
          })()}
          actionLabel="Go to page 1"
          icon={SearchX}
        />
      );
    }
    if (list.kind === "teachers") {
      return list.page.rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No deleted teachers match" : "No deleted teachers"}
          description={
            filtered
              ? "Try a different name or school, or clear the filters."
              : "Teacher accounts a School Head deletes move here."
          }
          icon={Users}
        />
      ) : (
        <DeletedTeachersTable rows={list.page.rows} />
      );
    }
    const rows = list.page.rows.filter((row) => !goneIds.has(row.id));
    return rows.length === 0 ? (
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
      <DeletedLearnersTable rows={rows} showDistrict canPurge={canPurge} onGone={markGone} />
    );
  };

  return (
    <Surface as="section" aria-label={noun} className="min-w-0 rounded-lg">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-border/60 px-4 pt-3 sm:px-5">
        {showTabs ? (
          <nav aria-label="Record type" className="-mb-px flex w-full gap-1 sm:w-auto">
            {tabs.map((tab) => {
              const active = tab.id === list.kind;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.id}
                  href={tabHref(tab.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-11 flex-1 items-center justify-center gap-2 border-b-2 px-2 text-sm font-medium transition-colors sm:flex-none sm:px-4",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {tab.label}
                  <Badge variant={active ? "default" : "secondary"} className="tabular-nums">
                    {tab.count.toLocaleString()}
                  </Badge>
                  {/* Out of the flow, so the label does not shift while a tab loads. */}
                  <span className="pointer-events-none absolute right-0.5 top-1 [&>span]:ml-0 [&>span]:size-2">
                    <LinkStatusPulse />
                  </span>
                </Link>
              );
            })}
          </nav>
        ) : (
          <h2 className="flex h-11 items-center gap-2 text-lg font-semibold">
            <GraduationCap className="h-5 w-5" aria-hidden />
            Deleted learners
            <Badge variant="secondary" className="tabular-nums">
              {data.learnerCount.toLocaleString()}
            </Badge>
          </h2>
        )}
        <div className="w-full pb-3 sm:w-56">
          <SortSelect
            id="deleted-records-sort"
            mode="client"
            value={sorts.parse(data.sort)}
            options={sorts.options}
            onSortChange={applySort}
            pending={pending}
          />
        </div>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        <ListBusyRegion
          label={noun}
          skeleton={<TableSectionSkeleton rows={8} columns={isTeachers ? 5 : 7} showToolbar={false} />}
        >
          {body()}
        </ListBusyRegion>
        <RecordsPager
          basePath={BASE}
          page={page.page}
          totalPages={page.pages}
          totalCount={page.total}
          pageSize={data.pageSize}
          noun={noun}
          idPrefix="deleted-records"
        />
      </div>
    </Surface>
  );
}
