"use client";

import { Suspense, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  Trash2,
  Users,
} from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { removeSchoolLearners, removeSchoolTeachers } from "@/lib/actions/admin-school";
import { CONFIRM_PHRASES } from "@/lib/constants/confirm-phrases";
import { removeAllTeachers, resetOperationalData } from "@/lib/actions/database";
import { SortSelect } from "@/components/ui/sort-select";
import { compareNames } from "@/lib/sort/compare";
import { defineSort, type SortOption } from "@/lib/sort/registry";
import {
  ListNavigationProvider,
  LinkStatusPulse,
  useListNavigate,
  useListPending,
} from "@/components/nav/list-navigation";
import { ListBusyRegion } from "@/components/loading/list-busy-region";
import { TableSectionSkeleton } from "@/components/loading/table-section-skeleton";
import { listKey, type ListSearchParams } from "@/lib/nav/list-params";
import type {
  LearnerRow,
  SchoolDetail,
  SchoolLearnerSort,
  TeacherRow,
} from "@/lib/admin/school-detail";

/**
 * Client-side mirror of `SCHOOL_LEARNER_SORTS` (`src/lib/admin/school-detail.ts`).
 * That module is `server-only` (it runs Prisma queries), so its runtime
 * registry cannot be imported here — only its `SchoolLearnerSort` type is
 * (type-only imports are erased, so `server-only`'s import guard never runs).
 * This option list must stay identical to the server's; a test in
 * `tests/components/school-detail-view-sort.test.tsx` imports this array
 * directly and asserts it against `SCHOOL_LEARNER_SORTS.options`, so drift on
 * either side fails loudly. Exported (rather than module-private) for that
 * reason.
 */
export const LEARNER_SORT_OPTIONS = [
  { value: "alphabetical", label: "Alphabetical" },
  { value: "grade-level", label: "Grade level" },
  { value: "section", label: "Section" },
  { value: "date-added", label: "Date added" },
] as const satisfies readonly SortOption<SchoolLearnerSort>[];

const LEARNER_SORTS = defineSort(LEARNER_SORT_OPTIONS, "alphabetical");

/**
 * "Sort by" for the (unpaginated, client-sorted) teachers roster. No "Grade
 * level" option: a teacher can advise 0-3 sections that need not share a
 * grade (`advisoryMode: "MULTI_GRADE"` — see CLAUDE.md's domain notes on
 * `resolveAdvisoryGradeScope`), so there is no single "the teacher's grade"
 * to sort by without guessing. "Section" sorts by the same joined
 * `advisorySection` string already shown in its column.
 */
export const TEACHER_SORTS = defineSort(
  [
    { value: "alphabetical", label: "Alphabetical" },
    { value: "section", label: "Section" },
    { value: "date-added", label: "Date added" },
  ] as const,
  "alphabetical"
);

type TeacherSort = (typeof TEACHER_SORTS.options)[number]["value"];

/**
 * Pure comparator for the client-sorted teachers table. Exported for tests.
 * Alphabetical orders by `lastName`/`firstName` — never `fullName`, which is
 * "Firstname Middlename Lastname" and would silently disagree with the
 * surname-first `listingName` every row displays. Every branch tie-breaks on
 * the same alphabetical key for a deterministic order. Uses `compareNames`
 * (case- and accent-insensitive, `sensitivity: "base"`) rather than raw
 * `localeCompare`, so this client-sorted table collates the same way every
 * server-sorted table does — e.g. "Ñuñez" and "Nunez" land next to each
 * other here too, not just elsewhere.
 */
export function compareTeacherRows(sort: TeacherSort, a: TeacherRow, b: TeacherRow): number {
  const alphabetical = compareNames(a.lastName, b.lastName) || compareNames(a.firstName, b.firstName);
  switch (sort) {
    case "section":
      return compareNames(a.advisorySection ?? "", b.advisorySection ?? "") || alphabetical;
    case "date-added":
      return b.createdAt.localeCompare(a.createdAt) || alphabetical;
    case "alphabetical":
    default:
      return alphabetical;
  }
}

/**
 * The Super Admin view of one school.
 *
 * Selection lives in each roster's own component rather than one shared
 * place, so the two never bleed into each other: ticking a teacher must
 * never carry over into the learner submission.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  });
}

/** A labelled fact on the profile card. Renders an em dash rather than nothing. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{value?.trim() || "—"}</dd>
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

/**
 * The typed-phrase gate the whole-school clear sits behind.
 *
 * Same bar as the Danger zone on `/admin/database`, because it is the same
 * operation: type the phrase exactly, and the phrase is re-checked server-side.
 */
function ClearEverything({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === CONFIRM_PHRASES.resetOperational;

  const run = () => {
    startTransition(async () => {
      const data = new FormData();
      data.set("confirm", CONFIRM_PHRASES.resetOperational);
      data.set("schoolId", schoolId);

      const cleared = await resetOperationalData(data);
      if (!cleared.ok) {
        toast.error(cleared.error);
        return;
      }

      const teachers = new FormData();
      teachers.set("confirm", CONFIRM_PHRASES.removeTeachers);
      teachers.set("schoolId", schoolId);
      const removed = await removeAllTeachers(teachers);
      if (!removed.ok) {
        // The records are already gone; say so rather than implying nothing ran.
        toast.error(`Records cleared, but the teacher accounts were not: ${removed.error}`);
      } else {
        toast.success(`${schoolName} cleared`);
      }

      setTyped("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 font-medium">
            <Trash2 className="h-4 w-4" aria-hidden />
            Clear everything for this school
          </p>
          <p className="text-sm text-muted-foreground">
            Deletes every learner and record belonging to {schoolName}, then removes its teacher
            accounts. The school, its school years, grade levels and sections stay. No other school
            is touched.
          </p>
        </div>
        {!open ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            Clear school
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-2 border-t border-destructive/20 pt-3">
          <label className="block text-sm font-medium" htmlFor="clear-school-confirm">
            Type{" "}
            <code className="rounded bg-muted px-1 font-mono">
              {CONFIRM_PHRASES.resetOperational}
            </code>{" "}
            to confirm
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="clear-school-confirm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full sm:w-56"
              aria-label={`Type ${CONFIRM_PHRASES.resetOperational} to confirm`}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!matches}
              loading={pending}
              loadingText="Clearing…"
              onClick={run}
            >
              Clear school
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setTyped("");
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Shared header cell for a roster's select-all box. */
function SelectAll({
  ids,
  selected,
  onChange,
  label,
}: {
  ids: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  label: string;
}) {
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <Checkbox
      checked={all}
      disabled={ids.length === 0}
      aria-label={label}
      onCheckedChange={(v) => onChange(v === true ? new Set(ids) : new Set())}
    />
  );
}

function toggleId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Params that change which rows the school-detail LEARNERS panel shows, for
 * its `<Suspense key>`. The (unpaginated, client-sorted) teachers table has
 * no equivalent — it never re-suspends, because it never re-fetches; see the
 * Teachers card's own comment below.
 */
export const SCHOOL_LEARNERS_KEYS = ["learners", "learnersSort"] as const;

/**
 * The Super Admin view of one school: profile, teachers, learners, danger
 * zone.
 *
 * `searchParams` is the page's raw (already-`await`ed) `?learners=`/
 * `?learnersSort=` object, threaded through only so this component can build
 * the Learners panel's `<Suspense key>` itself — `AdminSchoolDetailPage`
 * doesn't need to know about that key at all. The Teachers card below is
 * untouched by any of this: it is unpaginated and sorted entirely
 * client-side (`compareTeacherRows`), so it never calls `router.push` or
 * touches `ListNavigationProvider` — see that card's own comment.
 */
export function SchoolDetailView({
  detail,
  searchParams,
}: {
  detail: SchoolDetail;
  searchParams: ListSearchParams;
}) {
  const { school, counts, teachers } = detail;

  const [pickedTeachers, setPickedTeachers] = useState<Set<string>>(new Set());
  const [removingTeachers, startTeacherRemoval] = useTransition();
  const router = useRouter();

  // Teachers: unpaginated, so sorting the whole array client-side is enough —
  // no round trip needed for a roster that already lives entirely in this
  // component's props. Deliberately NOT wrapped in `ListNavigationProvider`
  // or `ListBusyRegion`, and `setTeacherSort` never calls `router.push` or
  // `useListNavigate`: there is no server round trip to give feedback for.
  const [teacherSort, setTeacherSort] = useState<TeacherSort>(TEACHER_SORTS.fallback);
  const sortedTeachers = useMemo(
    () => [...teachers].sort((a, b) => compareTeacherRows(teacherSort, a, b)),
    [teachers, teacherSort]
  );

  const removeTeachers = (ids: string[]) => {
    startTeacherRemoval(async () => {
      const fd = new FormData();
      fd.set("schoolId", school.id);
      for (const id of ids) fd.append("teacherIds", id);

      const res = await removeSchoolTeachers(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { removed = 0, failed = 0 } = res.data ?? {};
      toast.success(
        `${removed} teacher account${removed === 1 ? "" : "s"} removed${failed ? `, ${failed} failed` : ""}`
      );
      setPickedTeachers(new Set());
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Profile */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{school.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant={school.isActive ? "default" : "secondary"}>
                  {school.isActive ? "Active" : "Inactive"}
                </Badge>
                {school.isDemo ? (
                  <Badge className="border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                    Demo
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  Added {formatDate(school.createdAt)}
                </span>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`${SCHOOL_HEAD_ROUTES.dashboard}?schoolId=${school.id}`} prefetch>
                <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                Open as School Head
              </Link>
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Fact label="School ID" value={school.schoolIdCode} />
            <Fact label="Region" value={school.region} />
            <Fact label="Division" value={school.division} />
            <Fact label="District" value={school.district} />
            <Fact label="Address" value={school.address} />
          </dl>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <CountTile label="Teachers" value={counts.teachers} />
            <CountTile label="Learners" value={counts.learners} />
            <CountTile label="Sections" value={counts.sections} />
            <CountTile label="Grade levels" value={counts.gradeLevels} />
            <CountTile label="School years" value={counts.schoolYears} />
          </div>
        </CardContent>
      </Card>

      {/* Teachers — unpaginated, client-sorted only. No provider, no
          `router.push`, no `useListNavigate`: there is no server round trip
          for this table, so it stays outside the list-navigation machinery
          entirely. */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5" aria-hidden />
              Teachers
              <Badge variant="secondary">{counts.teachers}</Badge>
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <SortSelect
                id="school-teachers-sort"
                mode="client"
                value={teacherSort}
                options={TEACHER_SORTS.options}
                onSortChange={setTeacherSort}
              />
              {pickedTeachers.size > 0 ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  loading={removingTeachers}
                  loadingText="Removing…"
                  onClick={() => removeTeachers([...pickedTeachers])}
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                  Remove {pickedTeachers.size} selected
                </Button>
              ) : null}
            </div>
          </div>

          {teachers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No teacher accounts in this school.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <SelectAll
                        ids={sortedTeachers.map((t) => t.id)}
                        selected={pickedTeachers}
                        onChange={setPickedTeachers}
                        label="Select every teacher"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Advisory</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTeachers.map((teacher: TeacherRow) => (
                    <TableRow key={teacher.id}>
                      <TableCell>
                        <Checkbox
                          checked={pickedTeachers.has(teacher.id)}
                          aria-label={`Select ${teacher.listingName}`}
                          onCheckedChange={() =>
                            setPickedTeachers((s) => toggleId(s, teacher.id))
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">{teacher.listingName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {teacher.email}
                      </TableCell>
                      <TableCell>
                        {teacher.approvalStatus === "PENDING" ? (
                          <Badge variant="outline">Pending</Badge>
                        ) : teacher.isActive ? (
                          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {teacher.advisorySection ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={removingTeachers}
                          aria-label={`Remove ${teacher.listingName}`}
                          onClick={() => removeTeachers([teacher.id])}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Learners — server-paginated, own keyed Suspense so paging/sorting it
          never touches the teachers table above. */}
      <Suspense
        key={listKey(searchParams, SCHOOL_LEARNERS_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={6} showToolbar={false} />}
      >
        <SchoolLearnersPanel
          schoolId={school.id}
          totalLearners={counts.learners}
          learners={detail.learners}
          learnerPage={detail.learnerPage}
          learnerPages={detail.learnerPages}
        />
      </Suspense>

      {/* Danger zone, scoped to this school */}
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 pt-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden />
              Danger zone
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Removing rows above is reversible by support — the records are hidden, not deleted.
              This is not: it empties the tables. A safety point is saved first if backup storage
              is connected, and “Undo last operation” on the Database page restores it.
            </p>
          </div>
          <ClearEverything schoolId={school.id} schoolName={school.name} />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Learners panel: its own `ListNavigationProvider` wrapped around its own
 * `ListBusyRegion`, mirroring `ArchiveTeachersPanel`/`ArchiveLearnersPanel`
 * in `archive-view.tsx`. Server-paginated with skip/take, so its order comes
 * from the query (`schoolLearnerOrderBy` in `getSchoolDetail`) rather than a
 * client-side re-sort of just the current page — the opposite of the
 * teachers card above.
 *
 * Thin wrapper + inner body, same reason as `ArchiveTeachersPanel`: the hooks
 * that read the provider (`useListNavigate`/`useListPending`) are called one
 * level down, in `SchoolLearnersPanelBody`, never in the component that
 * renders the provider itself — React context is only visible to
 * descendants, and calling those hooks here would silently read the OUTER
 * context (or the no-provider fallback) instead.
 */
export function SchoolLearnersPanel({
  schoolId,
  totalLearners,
  learners,
  learnerPage,
  learnerPages,
}: {
  schoolId: string;
  totalLearners: number;
  learners: LearnerRow[];
  learnerPage: number;
  learnerPages: number;
}) {
  return (
    <ListNavigationProvider>
      <SchoolLearnersPanelBody
        schoolId={schoolId}
        totalLearners={totalLearners}
        learners={learners}
        learnerPage={learnerPage}
        learnerPages={learnerPages}
      />
    </ListNavigationProvider>
  );
}

function SchoolLearnersPanelBody({
  schoolId,
  totalLearners,
  learners,
  learnerPage,
  learnerPages,
}: {
  schoolId: string;
  totalLearners: number;
  learners: LearnerRow[];
  learnerPage: number;
  learnerPages: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigate = useListNavigate();
  const pending = useListPending();

  const [pickedLearners, setPickedLearners] = useState<Set<string>>(new Set());
  const [removingLearners, startLearnerRemoval] = useTransition();

  const learnerSort = LEARNER_SORTS.parse(searchParams.get("learnersSort") ?? undefined);
  const applyLearnerSort = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("learnersSort", value);
    next.delete("learners");
    navigate(`/admin/schools/${schoolId}?${next.toString()}`);
  };

  const removeLearners = (ids: string[]) => {
    startLearnerRemoval(async () => {
      const fd = new FormData();
      fd.set("schoolId", schoolId);
      for (const id of ids) fd.append("learnerIds", id);

      const res = await removeSchoolLearners(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const removed = res.data?.removed ?? 0;
      toast.success(`${removed} learner${removed === 1 ? "" : "s"} removed`);
      setPickedLearners(new Set());
      router.refresh();
    });
  };

  const learnerHref = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("learners", String(page));
    return `/admin/schools/${schoolId}?${next.toString()}`;
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <GraduationCap className="h-5 w-5" aria-hidden />
            Learners
            <Badge variant="secondary">{totalLearners}</Badge>
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <SortSelect
              id="school-learners-sort"
              mode="client"
              value={learnerSort}
              options={LEARNER_SORTS.options}
              onSortChange={applyLearnerSort}
              pending={pending}
            />
            {pickedLearners.size > 0 ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={removingLearners}
                loadingText="Removing…"
                onClick={() => removeLearners([...pickedLearners])}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                Remove {pickedLearners.size} selected
              </Button>
            ) : null}
          </div>
        </div>

        <ListBusyRegion
          label="learners"
          skeleton={<TableSectionSkeleton rows={8} columns={6} showToolbar={false} />}
        >
          {learners.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No learners in this school.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <SelectAll
                          ids={learners.map((l) => l.id)}
                          selected={pickedLearners}
                          onChange={setPickedLearners}
                          label="Select every learner on this page"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>ARAL</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {learners.map((learner: LearnerRow) => (
                      <TableRow key={learner.id}>
                        <TableCell>
                          <Checkbox
                            checked={pickedLearners.has(learner.id)}
                            aria-label={`Select ${learner.listingName}`}
                            onCheckedChange={() =>
                              setPickedLearners((s) => toggleId(s, learner.id))
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium">{learner.listingName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.gradeLevel}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.section ?? "—"}
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
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={removingLearners}
                            aria-label={`Remove ${learner.listingName}`}
                            onClick={() => removeLearners([learner.id])}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
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
          Outside the busy region on purpose. Inside it, the skeleton unmounts
          the pager while pending, which unmounts the LinkStatusPulse that is
          reporting that pending state; its cleanup withdraws the report,
          pending drops, the pager remounts and reports again, and React aborts
          with "Maximum update depth exceeded".
        */}
        {learnerPages > 1 ? (
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-sm text-muted-foreground">
              Page {learnerPage} of {learnerPages}
            </span>
            <div className="flex gap-2">
              <Button asChild={learnerPage > 1} variant="outline" size="sm" disabled={learnerPage <= 1}>
                {learnerPage > 1 ? (
                  <Link href={learnerHref(learnerPage - 1)}>
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
              <Button
                asChild={learnerPage < learnerPages}
                variant="outline"
                size="sm"
                disabled={learnerPage >= learnerPages}
              >
                {learnerPage < learnerPages ? (
                  <Link href={learnerHref(learnerPage + 1)}>
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
        ) : null}
      </CardContent>
    </Card>
  );
}
