"use client";

import { Suspense, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive as ArchiveIcon, ChevronLeft, ChevronRight, GraduationCap, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LearnerRowActions, TeacherRowActions } from "@/components/admin/archive-row-actions";
import { SortSelect } from "@/components/ui/sort-select";
import {
  ListNavigationProvider,
  LinkStatusPulse,
  useListNavigate,
  useListPending,
} from "@/components/nav/list-navigation";
import { ListBusyRegion } from "@/components/loading/list-busy-region";
import { TableSectionSkeleton } from "@/components/loading/table-section-skeleton";
import { listKey, type ListSearchParams } from "@/lib/nav/list-params";
// The registries come from the Prisma-free `archive-sorts` module: this is a
// client component, and `@/lib/admin/archive` is `server-only`, so importing
// their runtime values from there pulls Prisma and `pg` into the browser
// bundle. Only the `Archive`-family types may come from the server module —
// type-only imports are erased before the `server-only` guard can run.
import {
  ARCHIVE_LEARNER_SORTS,
  ARCHIVE_TEACHER_SORTS,
} from "@/lib/admin/archive-sorts";
import type {
  Archive,
  ArchivedLearnerRow,
  ArchivedTeacherRow,
  ArchivePage,
} from "@/lib/admin/archive";
import { cn } from "@/lib/utils";

export interface ArchiveSchoolOption {
  id: string;
  name: string;
}

const ANY_SCHOOL = "any";

/**
 * Params that change which rows the archived-TEACHERS bucket shows, for the
 * `<Suspense key>` on that panel. Deliberately disjoint from
 * `ARCHIVE_LEARNERS_KEYS` on the pager/sort param names, so paging or
 * re-sorting one bucket never re-keys — and therefore never re-suspends — the
 * other. The shared `school`/`q` filters intentionally appear in BOTH lists:
 * narrowing either legitimately changes what both buckets show, so both
 * panels are meant to re-suspend together on those two params.
 */
export const ARCHIVE_TEACHERS_KEYS = ["school", "q", "teachers", "teachersSort"] as const;
/** Same reasoning as `ARCHIVE_TEACHERS_KEYS`, for the learners panel. */
export const ARCHIVE_LEARNERS_KEYS = ["school", "q", "learners", "learnersSort"] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  });
}

/** School name, struck through when the row's own school is itself removed. */
function SchoolCell({ name, deleted }: { name: string | null; deleted: boolean }) {
  return (
    <span className={cn(deleted && "text-muted-foreground line-through")}>
      {name ?? "—"}
    </span>
  );
}

/**
 * Prev/Next for one bucket's paginator. Used once inside `ArchiveTeachersPanel`
 * and once inside `ArchiveLearnersPanel` — each call site already sits inside
 * its OWN `ListNavigationProvider` (see those components), so the
 * `LinkStatusPulse` rendered inside each `Link` reports into whichever
 * provider is nearest, never a shared one. Navigation itself stays plain
 * `<Link>` (not `useListNavigate`/`router.push`): the href is the source of
 * truth and `LinkStatusPulse` is what feeds the pending flag at t=0.
 */
function Paginator({
  page,
  pages,
  hrefFor,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <span className="text-sm text-muted-foreground">
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
          {page > 1 ? (
            <Link href={hrefFor(page - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
              Previous
              <LinkStatusPulse />
            </Link>
          ) : (
            <span>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
              Previous
            </span>
          )}
        </Button>
        <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>
          {page < pages ? (
            <Link href={hrefFor(page + 1)}>
              Next
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
              <LinkStatusPulse />
            </Link>
          ) : (
            <span>
              Next
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * The shared filters card (School / Search name), plus whatever the caller
 * renders below it — the two independently-keyed Suspense panels, passed in
 * plus two independently-keyed `<Suspense>` panels below it — one per bucket,
 * each wrapping its own `ListNavigationProvider`/`ListBusyRegion` pair (see
 * `ArchiveTeachersPanel`/`ArchiveLearnersPanel` below), so paging or
 * re-sorting one bucket never shows a skeleton over the other.
 *
 * `params` is the page's raw (already-`await`ed) `searchParams` object,
 * threaded through only to compute each panel's `listKey` — everything else
 * this component needs comes from `data`/`schools`/`filters`.
 *
 * Filter navigation stays outside `ListNavigationProvider`: a school/search
 * change legitimately re-suspends BOTH panels below (their Suspense keys both
 * include `school`/`q`), and this card has no single provider to report a
 * shared pending flag into — see the file-level note in
 * `list-navigation.tsx` on why `useListNavigate` degrades to a no-op instead
 * of throwing when a provider isn't present. The Search button's own
 * `loading` state already gives immediate feedback for this control.
 */
export function ArchiveView({
  data,
  schools,
  filters,
  params,
}: {
  data: Archive;
  schools: ArchiveSchoolOption[];
  filters: { school: string; q: string };
  params: ListSearchParams;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);

  // `schools` only lists ids present in *this* filtered result, so narrowing
  // the search can make the currently selected school disappear from the
  // option list — which would blank the Select even though it still has a
  // value. Accumulate every school id/name this session has seen (across
  // filter changes) in state so a selection never falls out of its own
  // dropdown; adjusted during render (React docs "Adjusting state when a
  // prop changes") rather than a ref or an effect, so it is visible in the
  // same pass that reads it.
  const [seenSchools, setSeenSchools] = useState<Map<string, string>>(() => new Map());
  const mergedSchools = useMemo(() => {
    const next = new Map(seenSchools);
    let changed = false;
    for (const school of schools) {
      if (next.get(school.id) !== school.name) {
        next.set(school.id, school.name);
        changed = true;
      }
    }
    if (filters.school && !next.has(filters.school)) {
      next.set(filters.school, filters.school);
      changed = true;
    }
    return changed ? next : seenSchools;
  }, [schools, filters.school, seenSchools]);
  if (mergedSchools !== seenSchools) setSeenSchools(mergedSchools);
  const schoolOptions = useMemo(
    () =>
      Array.from(mergedSchools, ([id, name]) => ({ id, name })).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [mergedSchools]
  );

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY_SCHOOL) next.delete(key);
      else next.set(key, value);
    }
    // A filter change invalidates both paginators' current pages.
    if ("school" in changes || "q" in changes) {
      next.delete("teachers");
      next.delete("learners");
    }
    startTransition(() => router.push(`/admin/archive?${next.toString()}`));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ q: query.trim() || null });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="archive-school">School</Label>
              <Select
                value={filters.school || ANY_SCHOOL}
                onValueChange={(value) => apply({ school: value })}
                disabled={pending}
              >
                <SelectTrigger id="archive-school" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SCHOOL}>All schools</SelectItem>
                  {schoolOptions.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="archive-q">Search name</Label>
              <Input
                id="archive-q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Learner or teacher name"
                className="w-56"
                disabled={pending}
              />
            </div>

            <Button type="submit" loading={pending} loadingText="Searching…">
              Search
            </Button>
            {filters.school || filters.q ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setQuery("");
                  apply({ school: null, q: null });
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Suspense
        key={listKey(params, ARCHIVE_TEACHERS_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={5} showToolbar={false} />}
      >
        <ArchiveTeachersPanel data={data.teachers} />
      </Suspense>
      <Suspense
        key={listKey(params, ARCHIVE_LEARNERS_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={7} showToolbar={false} />}
      >
        <ArchiveLearnersPanel data={data.learners} />
      </Suspense>
    </div>
  );
}

/**
 * Removed-teachers panel: its own `ListNavigationProvider` (so its pager and
 * "Sort by" report pending independently of the learners panel below) wrapped
 * around its own `ListBusyRegion` (so a teachers-only page/sort change swaps
 * straight to a skeleton without touching the learners table at all).
 *
 * Deliberately a thin wrapper: the hooks that read the provider
 * (`useListNavigate`/`useListPending`) are called one level down, in
 * `ArchiveTeachersPanelBody` — a component calling those hooks in the SAME
 * function that renders the provider would read the OUTER (parent) context
 * instead, since React context is only visible to descendants. That failure
 * mode degrades silently (`useListNavigate`/`useListPending` never throw when
 * unwrapped — see `list-navigation.tsx`), so the split here isn't optional.
 */
export function ArchiveTeachersPanel({ data }: { data: ArchivePage<ArchivedTeacherRow> }) {
  return (
    <ListNavigationProvider>
      <ArchiveTeachersPanelBody data={data} />
    </ListNavigationProvider>
  );
}

function ArchiveTeachersPanelBody({ data }: { data: ArchivePage<ArchivedTeacherRow> }) {
  const searchParams = useSearchParams();
  const navigate = useListNavigate();
  const pending = useListPending();
  const sort = ARCHIVE_TEACHER_SORTS.parse(searchParams.get("teachersSort") ?? undefined);

  const teacherHref = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("teachers", String(page));
    return `/admin/archive?${next.toString()}`;
  };

  // Re-sorting drops the teachers page — page 3 of "recently deleted" is
  // meaningless once the bucket is reordered alphabetically — and never
  // touches `learners`/`learnersSort`, so the learners panel's own Suspense
  // key (and therefore its rows) is untouched by this navigation.
  const applyTeachersSort = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("teachersSort", value);
    next.delete("teachers");
    navigate(`/admin/archive?${next.toString()}`);
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5" aria-hidden />
            Removed teachers
            <Badge variant="secondary">{data.total}</Badge>
          </h2>
          <SortSelect
            id="archive-teachers-sort"
            mode="client"
            value={sort}
            options={ARCHIVE_TEACHER_SORTS.options}
            onSortChange={applyTeachersSort}
            pending={pending}
          />
        </div>

        <ListBusyRegion
          label="removed teachers"
          skeleton={<TableSectionSkeleton rows={8} columns={5} showToolbar={false} />}
        >
          {data.rows.length === 0 ? (
            <EmptyState
              title="No removed teachers"
              description="Teacher accounts that have been removed will appear here."
              icon={ArchiveIcon}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>Removed on</TableHead>
                      <TableHead>Original email</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((teacher) => (
                      <TableRow key={teacher.id}>
                        <TableCell className="font-medium">{teacher.listingName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <SchoolCell name={teacher.schoolName} deleted={teacher.schoolDeleted} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(teacher.deletedAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {teacher.originalEmail ?? "Not recoverable"}
                        </TableCell>
                        <TableCell className="text-right">
                          <TeacherRowActions teacher={teacher} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </ListBusyRegion>
        {/*
          The pager stays OUTSIDE the busy region, matching every other list in
          the app. Inside it, the skeleton unmounts the pager while pending —
          which unmounts the `LinkStatusPulse` that is reporting the pending
          state, so its cleanup withdraws the report, pending drops, the pager
          remounts, reports again, and React aborts with "Maximum update depth
          exceeded". Keeping it outside also means the reader can still see
          which page they are on while the rows load.
        */}
        <Paginator page={data.page} pages={data.pages} hrefFor={teacherHref} />
      </CardContent>
    </Card>
  );
}

/**
 * Removed-learners panel — the mirror of `ArchiveTeachersPanel`, with its own
 * `ListNavigationProvider`/`ListBusyRegion` pair so paging or re-sorting this
 * bucket never shows a skeleton over the teachers table above it. Same thin
 * wrapper/body split as `ArchiveTeachersPanel`, for the same reason — see its
 * comment.
 */
export function ArchiveLearnersPanel({ data }: { data: ArchivePage<ArchivedLearnerRow> }) {
  return (
    <ListNavigationProvider>
      <ArchiveLearnersPanelBody data={data} />
    </ListNavigationProvider>
  );
}

function ArchiveLearnersPanelBody({ data }: { data: ArchivePage<ArchivedLearnerRow> }) {
  const searchParams = useSearchParams();
  const navigate = useListNavigate();
  const pending = useListPending();
  const sort = ARCHIVE_LEARNER_SORTS.parse(searchParams.get("learnersSort") ?? undefined);

  const learnerHref = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("learners", String(page));
    return `/admin/archive?${next.toString()}`;
  };

  const applyLearnersSort = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("learnersSort", value);
    next.delete("learners");
    navigate(`/admin/archive?${next.toString()}`);
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <GraduationCap className="h-5 w-5" aria-hidden />
            Removed learners
            <Badge variant="secondary">{data.total}</Badge>
          </h2>
          <SortSelect
            id="archive-learners-sort"
            mode="client"
            value={sort}
            options={ARCHIVE_LEARNER_SORTS.options}
            onSortChange={applyLearnersSort}
            pending={pending}
          />
        </div>

        <ListBusyRegion
          label="removed learners"
          skeleton={<TableSectionSkeleton rows={8} columns={7} showToolbar={false} />}
        >
          {data.rows.length === 0 ? (
            <EmptyState
              title="No removed learners"
              description="Learners that have been removed will appear here."
              icon={ArchiveIcon}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>Removed on</TableHead>
                      <TableHead>ARAL</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((learner) => (
                      <TableRow key={learner.id}>
                        <TableCell className="font-medium">{learner.listingName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <SchoolCell name={learner.schoolName} deleted={learner.schoolDeleted} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.gradeLevel}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.section ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(learner.deletedAt)}
                        </TableCell>
                        <TableCell>
                          {learner.isAralLearner ? (
                            <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300">
                              ARAL
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <LearnerRowActions learner={learner} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </ListBusyRegion>
        {/* Outside the busy region — see the teachers bucket above for why. */}
        <Paginator page={data.page} pages={data.pages} hrefFor={learnerHref} />
      </CardContent>
    </Card>
  );
}
