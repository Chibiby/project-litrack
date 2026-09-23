"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmAction } from "@/components/confirm-action";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { UserAvatar } from "@/components/user-avatar";
import {
  clearRejectedTeacher,
  removeTeacher,
  setTeacherActive,
} from "@/lib/actions/school-head";
import { setTeacherAdvisorySection } from "@/lib/actions/teacher";
import { removeUserAvatar } from "@/lib/actions/avatar";
import { advisoryCapFor, advisoryCapReason } from "@/lib/teachers/advisory-limits";
import { FLOATING_CHIP_LABEL, UNASSIGNED_CHIP_LABEL } from "@/lib/teachers/floating-copy";
import { removalAdvisoryNote } from "@/lib/teachers/removal-copy";
import {
  resyncOverrides,
  signaturesFor,
  visibleRows,
  type RowSignatures,
} from "@/lib/teachers/row-resync";
import { TeacherRoleDialog } from "@/components/school-head/teacher-role-dialog";
import type { TeacherListFilter, TeacherListSort } from "@/lib/teachers/pagination";
import { SortSelect } from "@/components/ui/sort-select";
import type { SortOption } from "@/lib/sort/registry";
import { RefreshCw, X } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";
import {
  ListNavigationProvider,
  useListNavigate,
} from "@/components/nav/list-navigation";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";

export type TeachersListPagination = {
  page: number;
  totalPages: number;
  totalCount: number;
  q: string;
  filter: TeacherListFilter;
  basePath: string;
  searchParams: Record<string, string | undefined>;
  /**
   * "Sort by" for this table. Optional so `list` stays a safe superset —
   * `inactive/page.tsx` renders `TeachersInactiveTable` with no `list` at all
   * and must keep compiling untouched.
   */
  sort?: TeacherListSort;
  sortOptions?: readonly SortOption<TeacherListSort>[];
};

export type ActiveTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  avatarPath: string | null;
  profileCompleted: boolean;
  approvedAt: string | null;
  /**
   * Surname-first display name ("Lastname, Firstname Middlename"), built from
   * the separate name columns by `formatListingNameFromRecord` — never by
   * parsing `fullName` apart. `fullName` stays on the row for search, avatar
   * initials and every other caller that already depends on its shape.
   */
  listingName: string;
  /** Advisory learners — removal leaves them with no adviser; it does not block. */
  learnerCount: number;
  /** Learners whose designated ARAL teacher this is — blocks removal while > 0. */
  aralLearnerCount: number;
  /**
   * `TeacherProfile.designation` / `.advisoryMode`. Both `null` when the teacher
   * has no profile yet — the row then shows "Hasn't finished profiling" instead
   * of the "Edit role" button, since there is nothing yet to edit.
   */
  designation: string | null;
  /** `MULTI_GRADE` is the stored value for what the UI calls multi-advisory. */
  advisoryMode: "DEFAULT" | "FLOATING" | "MULTI_GRADE" | null;
  /**
   * The sections this teacher advises, grade derived from each, ordered by grade
   * then name. Empty when they advise none — one shape rather than a nullable
   * list, so nothing has to handle both. Archived sections are already gone.
   *
   * A teacher sets their first themselves in profiling, and a School Head can change it
   * here afterwards — see `setTeacherAdvisorySection`.
   */
  assignments: {
    sectionId: string;
    gradeName: string;
    sectionName: string;
  }[];
};

/**
 * The sections a School Head may assign, grouped by grade so the picker can use
 * `<optgroup>` instead of one flat list of every section in the school.
 *
 * Sections already held by another teacher are included rather than filtered
 * out, carrying `adviserName` so the option can say who holds it. Hiding them
 * would leave a School Head hunting for a section that simply is not in the
 * list; showing them named explains itself, and the server still refuses the
 * save.
 */
export type AdvisoryGradeOption = {
  gradeLabel: string;
  sections: {
    id: string;
    name: string;
    adviserId: string | null;
    adviserName: string | null;
  }[];
};

export type DeclinedTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  rejectedAt: string | null;
};

export type RemovedTeacherRow = {
  id: string;
  fullName: string;
  /** The address they signed in with, or null when removal did not keep it. */
  email: string | null;
  removedAt: string;
};

/**
 * The School Head's advisory picker for one teacher.
 *
 * A native `<select>` rather than the shadcn `Select`, matching the in-table
 * picker in `aral-teacher-table.tsx`: `<optgroup>` groups the sections by grade
 * for free, and a native control inside a table row stays keyboard- and
 * screen-reader-navigable without a popover fighting the row for space.
 */
/**
 * The advisory picker's content, shared by the desktop table cell and the
 * below-`lg` list row so both drive the same handlers rather than each
 * re-implementing the chips/select. `idPrefix` keeps the native `<select>`'s
 * `id` unique between the two — both can be mounted at once (table hidden via
 * `hidden`, list via `lg:hidden`), and a duplicate `id` would break the
 * `<Label htmlFor>` pairing for whichever one lost the collision.
 */
function AdvisoryPicker({
  row,
  held,
  options,
  saving,
  disabled,
  onChange,
  idPrefix = "advisory-add",
}: {
  row: ActiveTeacherRow;
  /** Section ids this teacher advises, optimistic overrides already applied. */
  held: string[];
  options: AdvisoryGradeOption[];
  saving: boolean;
  disabled: boolean;
  onChange: (
    row: ActiveTeacherRow,
    sectionId: string,
    op: "add" | "remove"
  ) => void;
  idPrefix?: string;
}) {
  const selectId = `${idPrefix}-${row.id}`;
  const cap = advisoryCapFor(row.designation, row.advisoryMode);

  // A Volunteer or a Floating teacher advises no section at all — no picker to
  // offer, only the reason there isn't one.
  if (cap === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        {advisoryCapReason(row.designation, row.advisoryMode)}
      </span>
    );
  }

  // No grade has a section, so there is nothing to offer. Saying so beats a
  // dropdown with nothing in it.
  if (options.length === 0) {
    return <span className="text-sm text-muted-foreground">No sections yet</span>;
  }

  // Names for the chips, including one just added optimistically — the row this
  // component was given still describes the server state until the refresh
  // lands, so the label has to come from the option list instead.
  const labelById = new Map<string, string>();
  for (const grade of options) {
    for (const section of grade.sections) {
      labelById.set(section.id, `${grade.gradeLabel} · ${section.name}`);
    }
  }

  const atCap = held.length >= cap;
  // §5: FLOATING is a School Head's explicit choice; a teacher who merely holds
  // no section yet (still one-advisory or multi-advisory) is Unassigned instead.
  const zeroChipLabel =
    row.advisoryMode === "FLOATING" ? FLOATING_CHIP_LABEL : UNASSIGNED_CHIP_LABEL;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {held.map((sectionId) => (
          <span
            key={sectionId}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2 pr-1 text-xs"
          >
            {labelById.get(sectionId) ?? "Section"}
            {/*
              Sized down from the primitive's 44px floor, the same carve-out
              3b62b17 left for dense controls: `cn` merges className last, so a
              component that sets its own height wins. A chip inside a table row
              cannot carry a 44px hit area without the row swallowing the table.
            */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 rounded-full p-0 text-muted-foreground hover:text-destructive sm:size-5"
              disabled={disabled}
              aria-label={`Remove ${labelById.get(sectionId) ?? "section"} from ${row.fullName}`}
              onClick={() => onChange(row, sectionId, "remove")}
            >
              <X className="size-3" aria-hidden />
            </Button>
          </span>
        ))}
        {held.length === 0 ? (
          // §5: a chip, not a blank. A teacher who advises nothing is FLOATING,
          // which is a real state a School Head decides — clearing the last
          // section sets it, adding one clears it. A blank cell read as missing
          // data and left nobody sure whether an assignment had failed to save.
          <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
            {zeroChipLabel}
          </span>
        ) : null}
      </div>

      <Label htmlFor={selectId} className="sr-only">
        Add an advisory section for {row.fullName}
      </Label>
      <select
        id={selectId}
        className="mt-1.5 h-8 w-full min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50 max-lg:h-11"
        value=""
        disabled={disabled || atCap}
        onChange={(e) => {
          if (e.target.value) onChange(row, e.target.value, "add");
        }}
      >
        <option value="">
          {atCap
            ? advisoryCapReason(row.designation, row.advisoryMode)
            : held.length > 0
              ? "Add another section…"
              : "Assign a section…"}
        </option>
        {options.map((grade) => (
          <optgroup key={grade.gradeLabel} label={grade.gradeLabel}>
            {grade.sections
              // Already theirs: the chip above is how it comes off again.
              .filter((s) => !held.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {/* Named, not hidden: the server refuses an occupied section, so
                      the option has to say whose it is or the refusal is a riddle. */}
                  {!s.adviserId
                    ? `${s.name} — Unassigned`
                    : s.adviserId !== row.id
                      ? `${s.name} — ${s.adviserName || "taken"}`
                      : s.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {saving ? <p className="mt-1 text-xs text-muted-foreground">Saving…</p> : null}
    </>
  );
}

/** The desktop table's advisory cell — same picker, wrapped in a `<TableCell>`. */
function AdvisoryCell(props: {
  row: ActiveTeacherRow;
  held: string[];
  options: AdvisoryGradeOption[];
  saving: boolean;
  disabled: boolean;
  onChange: (
    row: ActiveTeacherRow,
    sectionId: string,
    op: "add" | "remove"
  ) => void;
}) {
  return (
    <TableCell>
      <AdvisoryPicker {...props} />
    </TableCell>
  );
}

type TeacherManageActionsProps = {
  row: ActiveTeacherRow;
  mode: "active" | "inactive";
  /** Which of this row's actions is in flight, or `null` when the row is idle. */
  busy: "setActive" | "remove" | "removePhoto" | null;
  onSetActive: (row: ActiveTeacherRow, isActive: boolean) => Promise<void>;
  onRemove: (row: ActiveTeacherRow) => Promise<void>;
  onRemovePhoto: (row: ActiveTeacherRow) => Promise<void>;
};

/**
 * The row's action buttons, shared by the desktop table cell and the
 * below-`lg` list row. `size="sm"` alone drops to `h-9` (36px) from 640px up
 * (`button.tsx`), which is under 40px on tablet. `sm:h-10 lg:h-9` raises the
 * 640–1023px band to 40px and then restores the original 36px at `lg` and up
 * — a plain `max-lg:h-10` will not do this: Tailwind emits `max-lg:` rules
 * before `sm:` rules, so at 640–1023px the primitive's own `sm:h-9` would
 * still win over `max-lg:h-10` by source order.
 */
function TeacherManageButtons({
  row,
  mode,
  busy,
  onSetActive,
  onRemove,
  onRemovePhoto,
}: TeacherManageActionsProps) {
  // The server blocks removal only while the teacher is someone's designated
  // ARAL teacher. Mirror it here so the button explains itself instead of
  // failing on click. Advisory learners do not block: removal releases them.
  const blockedReason =
    row.aralLearnerCount > 0
      ? `${row.fullName} is the ARAL teacher for ${row.aralLearnerCount} learner(s). Designate another ARAL teacher for them first.`
      : null;

  const removeDescription = [
    `${row.fullName} will be removed and their login deleted so the email can be used to register again. Historical records are kept.`,
    removalAdvisoryNote(row),
  ]
    .filter(Boolean)
    .join(" ");

  // This row's other action is locked while one is running; every *other* row
  // stays live, so one slow request no longer freezes the whole table.
  const rowBusy = busy !== null;

  return (
    <>
      {mode === "active" ? (
        <ConfirmAction
          title="Deactivate teacher?"
          description={`${row.fullName} will not be able to sign in until reactivated. Learners stay assigned.`}
          confirmLabel="Deactivate"
          variant="destructive"
          disabled={rowBusy}
          trigger={
            <Button
              size="sm"
              variant="outline"
              className="sm:h-10 lg:h-9"
              loading={busy === "setActive"}
              loadingText="Deactivating…"
              disabled={rowBusy}
            >
              Deactivate
            </Button>
          }
          onConfirm={() => onSetActive(row, false)}
        />
      ) : (
        <ConfirmAction
          title="Reactivate teacher?"
          description={`${row.fullName} will be able to sign in again.`}
          confirmLabel="Reactivate"
          variant="default"
          disabled={rowBusy}
          trigger={
            <Button
              size="sm"
              variant="outline"
              className="sm:h-10 lg:h-9"
              loading={busy === "setActive"}
              loadingText="Reactivating…"
              disabled={rowBusy}
            >
              Reactivate
            </Button>
          }
          onConfirm={() => onSetActive(row, true)}
        />
      )}
      {row.avatarPath ? (
        <ConfirmAction
          title="Remove profile photo?"
          description={`${row.fullName}'s current photo will be deleted. They can upload a new one from Settings → Profile.`}
          confirmLabel="Remove photo"
          variant="destructive"
          disabled={rowBusy}
          trigger={
            <Button
              size="sm"
              variant="outline"
              className="sm:h-10 lg:h-9"
              loading={busy === "removePhoto"}
              loadingText="Removing…"
              disabled={rowBusy}
            >
              Remove photo
            </Button>
          }
          onConfirm={() => onRemovePhoto(row)}
        />
      ) : null}
      <ConfirmAction
        title="Remove teacher?"
        description={blockedReason ?? removeDescription}
        confirmLabel="Remove"
        variant="destructive"
        disabled={blockedReason !== null || rowBusy}
        trigger={
          <Button
            size="sm"
            variant="ghost"
            className="sm:h-10 lg:h-9 text-destructive"
            loading={busy === "remove"}
            loadingText="Removing…"
            disabled={blockedReason !== null || rowBusy}
            title={blockedReason ?? "Remove teacher"}
          >
            Remove
          </Button>
        }
        onConfirm={() => onRemove(row)}
      />
    </>
  );
}

/** The desktop table's action cell — same buttons, wrapped in a `<TableCell>`. */
function TeacherManageActions(props: TeacherManageActionsProps) {
  return (
    <TableCell className="space-x-1 text-right">
      <TeacherManageButtons {...props} />
    </TableCell>
  );
}

function TeachersManagedTable({
  title,
  emptyLabel,
  rows,
  mode,
  readOnly = false,
  list,
  advisoryOptions,
}: {
  title: string;
  emptyLabel: string;
  rows: ActiveTeacherRow[];
  mode: "active" | "inactive";
  readOnly?: boolean;
  list?: TeachersListPagination;
  /**
   * Present only where advisory editing makes sense. Omitted for the inactive
   * table on purpose: an inactive teacher cannot sign in, and `advisorySectionId`
   * is unique, so parking a section on one would lock it away from every teacher
   * who could actually use it.
   */
  advisoryOptions?: AdvisoryGradeOption[];
}) {
  const router = useRouter();
  const navigate = useListNavigate();
  const [, startRowTransition] = useTransition();
  const [refreshing, startRefreshTransition] = useTransition();
  /**
   * `rowId:action` for the request in flight. A single table-wide pending flag
   * disabled every row's controls and spun none of them, so a School Head could
   * not tell which teacher was being changed.
   */
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState(list?.q ?? "");
  const [filterValue, setFilterValue] = useState<TeacherListFilter>(
    list?.filter ?? "all"
  );
  /**
   * Rows hidden by an in-flight (or just-confirmed) deactivate/remove.
   *
   * Deliberately plain state, not `useOptimistic`: `useOptimistic` reverts to
   * the `rows` prop the instant the transition that dispatched it settles,
   * which — once the server action is followed by a separate
   * `router.refresh()` — happens *before* the refreshed `rows` (without this
   * row) actually arrives. That produced a real production bug: the row
   * reappeared for the gap between the two, then vanished again once the
   * refresh landed, reading as "takes forever and feels broken." Plain state
   * has no such revert; `resyncOverrides` (below) prunes an entry only once
   * that row's own signature has actually moved — see `visibleRows` and the
   * "hidden-row resync" tests in `row-resync.test.ts`.
   */
  const [hiddenIds, setHiddenIds] = useState<Record<string, true>>({});
  const hideRow = (id: string) =>
    setHiddenIds((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  const unhideRow = (id: string) =>
    setHiddenIds((prev) => {
      if (!(id in prev)) return prev;
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
  /**
   * Row-local advisory sets, so the chips reflect a change before the refresh.
   * The whole list per row rather than one id: adding a second section leaves
   * the first in place, and a rollback has to restore both.
   */
  const [advisoryOverrides, setAdvisoryOverrides] = useState<
    Record<string, string[]>
  >({});
  const [savingAdvisoryId, setSavingAdvisoryId] = useState<string | null>(null);

  /**
   * The options when advisory editing is on, `undefined` when it is off — one
   * value rather than a separate boolean, because TypeScript narrows this at the
   * use site and would not narrow `advisoryOptions` from a boolean flag.
   */
  const editableAdvisory = readOnly ? undefined : advisoryOptions;

  const [prevListQ, setPrevListQ] = useState(list?.q ?? "");
  if ((list?.q ?? "") !== prevListQ) {
    setPrevListQ(list?.q ?? "");
    setSearchValue(list?.q ?? "");
  }
  const [prevListFilter, setPrevListFilter] = useState<TeacherListFilter>(
    list?.filter ?? "all"
  );
  if ((list?.filter ?? "all") !== prevListFilter) {
    setPrevListFilter(list?.filter ?? "all");
    setFilterValue(list?.filter ?? "all");
  }

  /**
   * Server data wins once it arrives for a row — but only for *that* row.
   *
   * This used to be `setAdvisoryOverrides({})` on every `[rows]` change,
   * which cleared every row's override on *any* refresh: a different row
   * saving, a search, a page turn, or the Refresh button below. If this
   * row's own save had not committed and refreshed yet, that wiped its
   * still-correct optimistic chip and snapped it back to the stale value
   * until its own refresh eventually caught up — the production "value
   * snaps back" bug. Comparing signatures per row means an unrelated
   * refresh leaves an in-flight row's override alone, and only clears it
   * once that row's own server data has actually moved.
   */
  const rowSignaturesRef = useRef<RowSignatures>(signaturesFor(rows));
  useEffect(() => {
    const nextSignatures = signaturesFor(rows);
    setAdvisoryOverrides((prev) =>
      resyncOverrides(prev, rowSignaturesRef.current, nextSignatures)
    );
    // Same rule for a hidden deactivate/remove: a row that is still in `rows`
    // (this refresh doesn't concern it) stays hidden; one whose signature has
    // moved — in practice, disappeared, since a deactivated/removed teacher
    // drops out of this query entirely — is unhidden because there is nothing
    // left to hide it from.
    setHiddenIds((prev) =>
      resyncOverrides(prev, rowSignaturesRef.current, nextSignatures)
    );
    rowSignaturesRef.current = nextSignatures;
  }, [rows]);

  const advisoryIdsFor = (row: ActiveTeacherRow): string[] =>
    row.id in advisoryOverrides
      ? advisoryOverrides[row.id]
      : row.assignments.map((a) => a.sectionId);

  const onChangeAdvisory = (
    row: ActiveTeacherRow,
    sectionId: string,
    op: "add" | "remove"
  ) => {
    const previous = advisoryIdsFor(row);
    const next =
      op === "add"
        ? previous.includes(sectionId)
          ? previous
          : [...previous, sectionId]
        : previous.filter((id) => id !== sectionId);
    if (next.length === previous.length && op === "add") return;

    setAdvisoryOverrides((prev) => ({ ...prev, [row.id]: next }));
    setSavingAdvisoryId(row.id);

    const fd = new FormData();
    fd.set("teacherId", row.id);
    fd.set("sectionId", sectionId);
    fd.set("op", op);

    startRowTransition(async () => {
      const res = await setTeacherAdvisorySection(fd);
      setSavingAdvisoryId(null);
      if (!res.ok) {
        // Roll back, so the chips never show an advisory that did not stick —
        // the cap and the occupied-section refusal both land here.
        setAdvisoryOverrides((prev) => ({ ...prev, [row.id]: previous }));
        toast.error(res.error);
        return;
      }
      toast.success(
        op === "add"
          ? `Advisory added for ${row.fullName}`
          : next.length === 0
            ? `${row.fullName} is now ${
                row.advisoryMode === "FLOATING"
                  ? FLOATING_CHIP_LABEL.toLowerCase()
                  : UNASSIGNED_CHIP_LABEL.toLowerCase()
              }`
            : `Advisory removed for ${row.fullName}`
      );
      // No `router.refresh()` here or after the other row actions: each action
      // calls `revalidatePath`, so its own response already carries the
      // re-rendered page. A follow-up refresh rendered the whole roster (and
      // every query behind it) a second time per click.
    });
  };

  const optimisticRows = visibleRows(rows, hiddenIds);
  const displayCount = list?.totalCount ?? optimisticRows.length;

  const pushListQuery = (next: {
    page?: number;
    q?: string;
    filter?: TeacherListFilter;
  }) => {
    if (!list) return;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(list.searchParams)) {
      if (
        v !== undefined &&
        v !== "" &&
        k !== "page" &&
        k !== "q" &&
        k !== "filter"
      ) {
        params.set(k, v);
      }
    }
    const q = next.q !== undefined ? next.q : list.q;
    const page = next.page !== undefined ? next.page : list.page;
    const filter = next.filter !== undefined ? next.filter : list.filter;
    if (q) params.set("q", q);
    if (filter !== "all") params.set("filter", filter);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    navigate(qs ? `${list.basePath}?${qs}` : list.basePath);
  };

  const onSetActive = (row: ActiveTeacherRow, isActive: boolean) => {
    setActingKey(`${row.id}:setActive`);
    // Hidden instantly, outside the transition — a plain state update in an
    // event handler paints before the network call even starts. See the
    // `hiddenIds` state above for why this is not `useOptimistic`.
    hideRow(row.id);
    return runOptimistic(startRowTransition, async () => {
      const fd = new FormData();
      fd.set("userId", row.id);
      fd.set("isActive", isActive ? "true" : "false");
      try {
        const res = await setTeacherActive(fd);
        await settleActionResult(
          res,
          isActive ? "Teacher reactivated" : "Teacher deactivated"
        );
      } catch (err) {
        // The action failed (or was rejected) — nothing changed server-side,
        // so put the row back rather than leave it hidden until some later,
        // unrelated refresh happens to prune it.
        unhideRow(row.id);
        throw err;
      }
    }).finally(() => setActingKey(null));
  };

  const onRemove = (row: ActiveTeacherRow) => {
    setActingKey(`${row.id}:remove`);
    hideRow(row.id);
    return runOptimistic(startRowTransition, async () => {
      const fd = new FormData();
      fd.set("userId", row.id);
      try {
        const res = await removeTeacher(fd);
        await settleActionResult(res, "Teacher removed");
      } catch (err) {
        unhideRow(row.id);
        throw err;
      }
    }).finally(() => setActingKey(null));
  };

  const onRemovePhoto = (row: ActiveTeacherRow) => {
    setActingKey(`${row.id}:removePhoto`);
    return runOptimistic(startRowTransition, async () => {
      const fd = new FormData();
      fd.set("userId", row.id);
      const res = await removeUserAvatar(fd);
      if (!res.ok) {
        toast.error(res.error);
        throw new Error(res.error);
      }
      if (res.dryRun) {
        // Test Lab: same "nothing was saved" posture as `DryRunNotice`, just
        // as a toast since this is a click action, not a persistent form.
        toast("Test Lab — no photo was actually removed.");
        return;
      }
      toast.success(`Removed ${row.fullName}'s photo`);
      router.refresh();
    }).finally(() => setActingKey(null));
  };

  // Name, Email, Role, Grade & section, ARAL, Profile, Approved (+ Actions when editable).
  const colSpan = readOnly ? 7 : 8;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-sm font-medium">
            {title} ({displayCount})
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={refreshing}
            loadingText="Refreshing…"
            onClick={() => startRefreshTransition(() => router.refresh())}
          >
            {!refreshing ? <RefreshCw className="size-4" aria-hidden /> : null}
            Refresh
          </Button>
        </div>
        {list ? (
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="teachers-filter" className="text-xs text-muted-foreground">
                Filter teachers
              </Label>
              <select
                id="teachers-filter"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={filterValue}
                onChange={(e) => {
                  const nextFilter = e.target.value as TeacherListFilter;
                  setFilterValue(nextFilter);
                  pushListQuery({ page: 1, filter: nextFilter });
                }}
              >
                <option value="all">All active teachers</option>
                <option value="non-deped-aral-volunteer">
                  Non-DepEd ARAL Volunteer
                </option>
                <option value="teacher">Teacher</option>
                <option value="floating">Floating</option>
                <option value="multi-advisory">Multi advisory</option>
                <option value="with-advisory">With advisory</option>
              </select>
            </div>
            {list.sort && list.sortOptions ? (
              <SortSelect
                mode="link"
                id="teachers-sort"
                basePath={list.basePath}
                value={list.sort}
                options={list.sortOptions}
                searchParams={{
                  ...list.searchParams,
                  q: list.q || undefined,
                  filter: list.filter === "all" ? undefined : list.filter,
                }}
              />
            ) : null}
            <div className="min-w-[12rem] flex-1 space-y-1">
              <Label htmlFor="teachers-search" className="text-xs text-muted-foreground">
                Search active teachers
              </Label>
              <Input
                id="teachers-search"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    pushListQuery({ page: 1, q: searchValue.trim() });
                  }
                }}
                placeholder="Name or email…"
                className="max-w-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => pushListQuery({ page: 1, q: searchValue.trim() })}
            >
              Search
            </Button>
            {list.q ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchValue("");
                  pushListQuery({ page: 1, q: "" });
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        ) : null}
        <ListBusyRegion
          label="teachers"
          skeleton={
            <TableSectionSkeleton
              rows={Math.min(optimisticRows.length || 8, 8)}
              columns={colSpan}
              showToolbar={false}
            />
          }
        >
        {/* `rowsWithBusy` is shared by the table below (lg and up) and the
            stacked list under it (below lg) so the two never compute the busy
            key differently. */}
        {(() => {
          const rowsWithBusy = optimisticRows.map((row) => ({
            row,
            rowBusy:
              actingKey === `${row.id}:setActive`
                ? ("setActive" as const)
                : actingKey === `${row.id}:remove`
                  ? ("remove" as const)
                  : actingKey === `${row.id}:removePhoto`
                    ? ("removePhoto" as const)
                    : null,
          }));
          return (
            <>
        {/* lg and up: the unchanged table. */}
        <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Grade &amp; section</TableHead>
              <TableHead>ARAL learners</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Approved</TableHead>
              {!readOnly ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimisticRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              rowsWithBusy.map(({ row, rowBusy }) => {
                return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        name={row.fullName}
                        avatarPath={row.avatarPath}
                        size={32}
                        variant="thumb"
                      />
                      <span>{row.listingName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{row.email}</TableCell>
                  <TableCell className="text-sm">
                    {row.designation === null ? (
                      <span className="text-muted-foreground">
                        Hasn&apos;t finished profiling
                      </span>
                    ) : readOnly ? (
                      row.designation
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{row.designation}</span>
                        <TeacherRoleDialog
                          row={row}
                          onSaved={() =>
                            setAdvisoryOverrides((prev) => {
                              if (!(row.id in prev)) return prev;
                              const next = { ...prev };
                              delete next[row.id];
                              return next;
                            })
                          }
                        />
                      </div>
                    )}
                  </TableCell>
                  {editableAdvisory ? (
                    <AdvisoryCell
                      row={row}
                      held={advisoryIdsFor(row)}
                      options={editableAdvisory}
                      saving={savingAdvisoryId === row.id}
                      disabled={savingAdvisoryId === row.id || rowBusy !== null}
                      onChange={onChangeAdvisory}
                    />
                  ) : (
                    <TableCell className="text-sm">
                      {row.assignments.length > 0 ? (
                        row.assignments
                          .map((a) => `${a.gradeName} · ${a.sectionName}`)
                          .join(", ")
                      ) : (
                        <span className="text-muted-foreground">
                          {row.advisoryMode === "FLOATING"
                            ? FLOATING_CHIP_LABEL
                            : UNASSIGNED_CHIP_LABEL}
                        </span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-sm">
                    {row.aralLearnerCount > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-violet-200 text-violet-800 dark:text-violet-200"
                      >
                        {row.aralLearnerCount}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.profileCompleted ? (
                      <Badge variant="secondary">Profiled</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-300">
                        Awaiting profiling
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.approvedAt ? formatDate(row.approvedAt) : "—"}
                  </TableCell>
                  {!readOnly ? (
                    <TeacherManageActions
                      row={row}
                      mode={mode}
                      busy={rowBusy}
                      onSetActive={onSetActive}
                      onRemove={onRemove}
                      onRemovePhoto={onRemovePhoto}
                    />
                  ) : null}
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>

        {/* Below lg: one stacked row per teacher. */}
        <ul className="divide-y divide-border/60 lg:hidden" aria-label={title}>
          {rowsWithBusy.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </li>
          ) : (
            rowsWithBusy.map(({ row, rowBusy }) => (
              <li key={row.id} className="flex flex-col gap-3 px-3 py-3 sm:px-4">
                <div className="flex items-start gap-3">
                  <UserAvatar
                    name={row.fullName}
                    avatarPath={row.avatarPath}
                    size={40}
                    variant="thumb"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium text-foreground">
                      {row.listingName}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {row.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {row.designation === null ? (
                        "Hasn't finished profiling"
                      ) : readOnly ? (
                        row.designation
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {row.designation}
                          <TeacherRoleDialog
                            row={row}
                            onSaved={() =>
                              setAdvisoryOverrides((prev) => {
                                if (!(row.id in prev)) return prev;
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              })
                            }
                          />
                        </span>
                      )}
                    </p>
                    <div className="text-sm text-muted-foreground">
                      {editableAdvisory ? (
                        <AdvisoryPicker
                          row={row}
                          held={advisoryIdsFor(row)}
                          options={editableAdvisory}
                          saving={savingAdvisoryId === row.id}
                          disabled={savingAdvisoryId === row.id || rowBusy !== null}
                          onChange={onChangeAdvisory}
                          idPrefix="advisory-add-m"
                        />
                      ) : row.assignments.length > 0 ? (
                        row.assignments
                          .map((a) => `${a.gradeName} · ${a.sectionName}`)
                          .join(", ")
                      ) : (
                        <span>
                          {row.advisoryMode === "FLOATING"
                            ? FLOATING_CHIP_LABEL
                            : UNASSIGNED_CHIP_LABEL}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.aralLearnerCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-violet-200 text-violet-800 dark:text-violet-200"
                        >
                          {row.aralLearnerCount} ARAL learner
                          {row.aralLearnerCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                      {row.profileCompleted ? (
                        <Badge variant="secondary">Profiled</Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-300 text-amber-800 dark:text-amber-300"
                        >
                          Awaiting profiling
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Approved {row.approvedAt ? formatDate(row.approvedAt) : "—"}
                    </p>
                  </div>
                </div>
                {!readOnly ? (
                  <div className="flex flex-wrap gap-2">
                    <TeacherManageButtons
                      row={row}
                      mode={mode}
                      busy={rowBusy}
                      onSetActive={onSetActive}
                      onRemove={onRemove}
                      onRemovePhoto={onRemovePhoto}
                    />
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
            </>
          );
        })()}
        </ListBusyRegion>
        {list ? (
          <LearnerPagination
            basePath={list.basePath}
            page={list.page}
            totalPages={list.totalPages}
            searchParams={{ ...list.searchParams, q: list.q || undefined }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Rendered strictly INSIDE `ListNavigationProvider` (see `TeachersActiveTable`
 * below) — `useListNavigate`/`useListPending` are read by `TeachersManagedTable`
 * and `ListBusyRegion` further down the tree, so the provider has to be an
 * ancestor of this component, never a sibling rendered from the same return.
 */
function TeachersActiveTablePanel({
  rows,
  readOnly = false,
  list,
  advisoryOptions,
}: {
  rows: ActiveTeacherRow[];
  readOnly?: boolean;
  list?: TeachersListPagination;
  advisoryOptions?: AdvisoryGradeOption[];
}) {
  return (
    <TeachersManagedTable
      title="Active teachers"
      emptyLabel={
        list?.q
          ? "No active teachers match your search."
          : "No active teachers yet."
      }
      rows={rows}
      mode="active"
      readOnly={readOnly}
      list={list}
      advisoryOptions={advisoryOptions}
    />
  );
}

export function TeachersActiveTable(props: {
  rows: ActiveTeacherRow[];
  readOnly?: boolean;
  list?: TeachersListPagination;
  advisoryOptions?: AdvisoryGradeOption[];
}) {
  return (
    <ListNavigationProvider>
      <TeachersActiveTablePanel {...props} />
    </ListNavigationProvider>
  );
}

export function TeachersInactiveTable({
  rows,
  readOnly = false,
}: {
  rows: ActiveTeacherRow[];
  readOnly?: boolean;
}) {
  return (
    <TeachersManagedTable
      title="Inactive teachers"
      emptyLabel="No inactive teachers."
      rows={rows}
      mode="inactive"
      readOnly={readOnly}
    />
  );
}

/**
 * Teachers removed from this school. Read-only: removal deleted their login and
 * released their advisory, so there is nothing to restore from here — a removed
 * teacher registers again and is approved like anyone new.
 */
export function TeachersRemovedTable({ rows }: { rows: RemovedTeacherRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Removed teachers ({rows.length})
        </div>
        <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Removed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.fullName}</TableCell>
                <TableCell className="text-sm">
                  {row.email ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(row.removedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>

        {/* Below lg: one stacked row per removed teacher. */}
        <ul className="divide-y divide-border/60 lg:hidden" aria-label="Removed teachers">
          {rows.map((row) => (
            <li key={row.id} className="px-3 py-3 sm:px-4">
              <p className="truncate font-medium text-foreground">{row.fullName}</p>
              <p className="truncate text-sm text-muted-foreground">
                {row.email ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Removed {formatDate(row.removedAt)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function TeachersDeclinedTable({
  rows,
  readOnly = false,
}: {
  rows: DeclinedTeacherRow[];
  readOnly?: boolean;
}) {
  const [, startTransition] = useTransition();
  /** The teacher being cleared, so only their row reads as busy. */
  const [actingId, setActingId] = useState<string | null>(null);

  const runClear = (userId: string, name: string) => {
    if (
      !window.confirm(
        `Allow ${name} to register again? This deletes their declined request (and auth account) so they can sign up fresh.`
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("userId", userId);
    setActingId(userId);
    startTransition(async () => {
      try {
        const res = await clearRejectedTeacher(fd);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("They can register again");
      } finally {
        setActingId(null);
      }
    });
  };

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">Declined ({rows.length})</div>
        <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rejected</TableHead>
              {!readOnly ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.fullName}</TableCell>
                <TableCell className="text-sm">{row.email}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.rejectedAt ? formatDate(row.rejectedAt) : "—"}
                </TableCell>
                {!readOnly ? (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={actingId === row.id}
                      loadingText="Allowing…"
                      onClick={() => runClear(row.id, row.fullName)}
                    >
                      Allow re-register
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>

        {/* Below lg: one stacked row per declined teacher. */}
        <ul className="divide-y divide-border/60 lg:hidden" aria-label="Declined">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 px-3 py-3 sm:px-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{row.fullName}</p>
                <p className="truncate text-sm text-muted-foreground">{row.email}</p>
                <p className="text-xs text-muted-foreground">
                  Rejected {row.rejectedAt ? formatDate(row.rejectedAt) : "—"}
                </p>
              </div>
              {!readOnly ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="sm:h-10 lg:h-9"
                  loading={actingId === row.id}
                  loadingText="Allowing…"
                  onClick={() => runClear(row.id, row.fullName)}
                >
                  Allow re-register
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
