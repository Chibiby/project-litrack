"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
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
import {
  clearRejectedTeacher,
  removeTeacher,
  setTeacherActive,
} from "@/lib/actions/school-head";
import { setTeacherAdvisorySection } from "@/lib/actions/teacher";
import { formatDate } from "@/lib/utils";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

export type TeachersListPagination = {
  page: number;
  totalPages: number;
  totalCount: number;
  q: string;
  basePath: string;
  searchParams: Record<string, string | undefined>;
};

export type ActiveTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  profileCompleted: boolean;
  approvedAt: string | null;
  learnerCount: number;
  /** Learners whose designated ARAL teacher this is — blocks removal while > 0. */
  aralLearnerCount: number;
  /**
   * The teacher's advisory section (grade derived from it), or `null` when they
   * have none. `sectionId` is what the School Head's picker binds to; the two
   * names are for display.
   *
   * A teacher sets this themselves in profiling, and a School Head can change it
   * here afterwards — see `setTeacherAdvisorySection`.
   */
  assignment: {
    sectionId: string;
    gradeName: string;
    sectionName: string;
  } | null;
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

/**
 * The School Head's advisory picker for one teacher.
 *
 * A native `<select>` rather than the shadcn `Select`, matching the in-table
 * picker in `aral-teacher-table.tsx`: `<optgroup>` groups the sections by grade
 * for free, and a native control inside a table row stays keyboard- and
 * screen-reader-navigable without a popover fighting the row for space.
 */
function AdvisoryCell({
  row,
  value,
  options,
  saving,
  disabled,
  onChange,
}: {
  row: ActiveTeacherRow;
  value: string | null;
  options: AdvisoryGradeOption[];
  saving: boolean;
  disabled: boolean;
  onChange: (row: ActiveTeacherRow, sectionId: string | null) => void;
}) {
  const selectId = `advisory-${row.id}`;

  // No grade has a section, so there is nothing to offer. Saying so beats a
  // dropdown whose only entry is "Unassigned".
  if (options.length === 0) {
    return (
      <TableCell className="text-sm text-muted-foreground">
        No sections yet
      </TableCell>
    );
  }

  return (
    <TableCell>
      <Label htmlFor={selectId} className="sr-only">
        Advisory section for {row.fullName}
      </Label>
      <select
        id={selectId}
        className="h-8 w-full min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) =>
          onChange(row, e.target.value === "" ? null : e.target.value)
        }
      >
        <option value="">Unassigned</option>
        {options.map((grade) => (
          <optgroup key={grade.gradeLabel} label={grade.gradeLabel}>
            {grade.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {/* Named, not hidden: the server refuses an occupied section, so
                    the option has to say whose it is or the refusal is a riddle. */}
                {s.adviserId && s.adviserId !== row.id
                  ? `${s.name} — ${s.adviserName || "taken"}`
                  : s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {saving ? <p className="mt-1 text-xs text-muted-foreground">Saving…</p> : null}
    </TableCell>
  );
}

function TeacherManageActions({
  row,
  mode,
  busy,
  onSetActive,
  onRemove,
}: {
  row: ActiveTeacherRow;
  mode: "active" | "inactive";
  /** Which of this row's actions is in flight, or `null` when the row is idle. */
  busy: "setActive" | "remove" | null;
  onSetActive: (row: ActiveTeacherRow, isActive: boolean) => Promise<void>;
  onRemove: (row: ActiveTeacherRow) => Promise<void>;
}) {
  // The server blocks removal while the teacher still holds learners on EITHER
  // axis: advisory learners (Learner.teacherId is ON DELETE RESTRICT) and ARAL
  // designations (ON DELETE SET NULL, which would silently wipe them). Mirror
  // both here so the button explains itself instead of failing on click.
  const blockedReason =
    row.learnerCount > 0
      ? `${row.fullName} still has ${row.learnerCount} learner(s). Reassign or transfer them first, then try again.`
      : row.aralLearnerCount > 0
        ? `${row.fullName} is the ARAL teacher for ${row.aralLearnerCount} learner(s). Designate another ARAL teacher for them first.`
        : null;

  // This row's other action is locked while one is running; every *other* row
  // stays live, so one slow request no longer freezes the whole table.
  const rowBusy = busy !== null;

  return (
    <TableCell className="space-x-1 text-right">
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
      <ConfirmAction
        title="Remove teacher?"
        description={
          blockedReason ??
          `${row.fullName} will be removed and their login deleted so the email can be used to register again. Historical records are kept.`
        }
        confirmLabel="Remove"
        variant="destructive"
        disabled={blockedReason !== null || rowBusy}
        trigger={
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
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
  const [, startRowTransition] = useTransition();
  /**
   * `rowId:action` for the request in flight. A single table-wide pending flag
   * disabled every row's controls and spun none of them, so a School Head could
   * not tell which teacher was being changed.
   */
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState(list?.q ?? "");
  const [optimisticRows, dispatchOptimistic] = useOptimistic(
    rows,
    (state: ActiveTeacherRow[], op: ListOptimisticOp<ActiveTeacherRow>) =>
      listOptimisticReducer(state, op)
  );
  /** Row-local advisory picks, so a select reflects the change before the refresh. */
  const [advisoryOverrides, setAdvisoryOverrides] = useState<
    Record<string, string | null>
  >({});
  const [savingAdvisoryId, setSavingAdvisoryId] = useState<string | null>(null);

  /**
   * The options when advisory editing is on, `undefined` when it is off — one
   * value rather than a separate boolean, because TypeScript narrows this at the
   * use site and would not narrow `advisoryOptions` from a boolean flag.
   */
  const editableAdvisory = readOnly ? undefined : advisoryOptions;

  useEffect(() => {
    setSearchValue(list?.q ?? "");
  }, [list?.q]);

  // Server data wins once it arrives; drop stale overrides.
  useEffect(() => {
    setAdvisoryOverrides({});
  }, [rows]);

  const advisoryValueFor = (row: ActiveTeacherRow): string | null =>
    row.id in advisoryOverrides
      ? advisoryOverrides[row.id]
      : row.assignment?.sectionId ?? null;

  const onChangeAdvisory = (
    row: ActiveTeacherRow,
    sectionId: string | null
  ) => {
    const previous = advisoryValueFor(row);
    if (previous === sectionId) return;

    setAdvisoryOverrides((prev) => ({ ...prev, [row.id]: sectionId }));
    setSavingAdvisoryId(row.id);

    const fd = new FormData();
    fd.set("teacherId", row.id);
    // Empty string clears the advisory — the action maps "" to null.
    fd.set("sectionId", sectionId ?? "");

    startRowTransition(async () => {
      const res = await setTeacherAdvisorySection(fd);
      setSavingAdvisoryId(null);
      if (!res.ok) {
        // Roll back, so the select never shows an advisory that did not stick.
        setAdvisoryOverrides((prev) => ({ ...prev, [row.id]: previous }));
        toast.error(res.error);
        return;
      }
      toast.success(
        sectionId
          ? `Advisory updated for ${row.fullName}`
          : `${row.fullName} is now unassigned`
      );
      router.refresh();
    });
  };

  const displayCount = list?.totalCount ?? optimisticRows.length;

  const pushListQuery = (next: { page?: number; q?: string }) => {
    if (!list) return;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(list.searchParams)) {
      if (v !== undefined && v !== "" && k !== "page" && k !== "q") {
        params.set(k, v);
      }
    }
    const q = next.q !== undefined ? next.q : list.q;
    const page = next.page !== undefined ? next.page : list.page;
    if (q) params.set("q", q);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    router.push(qs ? `${list.basePath}?${qs}` : list.basePath);
  };

  const onSetActive = (row: ActiveTeacherRow, isActive: boolean) => {
    setActingKey(`${row.id}:setActive`);
    return runOptimistic(startRowTransition, async () => {
      dispatchOptimistic({ type: "remove", id: row.id });
      const fd = new FormData();
      fd.set("userId", row.id);
      fd.set("isActive", isActive ? "true" : "false");
      const res = await setTeacherActive(fd);
      await settleActionResult(
        res,
        isActive ? "Teacher reactivated" : "Teacher deactivated"
      );
    }).finally(() => setActingKey(null));
  };

  const onRemove = (row: ActiveTeacherRow) => {
    setActingKey(`${row.id}:remove`);
    return runOptimistic(startRowTransition, async () => {
      dispatchOptimistic({ type: "remove", id: row.id });
      const fd = new FormData();
      fd.set("userId", row.id);
      const res = await removeTeacher(fd);
      await settleActionResult(res, "Teacher removed");
    }).finally(() => setActingKey(null));
  };

  // Name, Email, Grade & section, ARAL, Profile, Approved (+ Actions when editable).
  const colSpan = readOnly ? 6 : 7;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-sm font-medium">
            {title} ({displayCount})
          </div>
        </div>
        {list ? (
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3">
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
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
              optimisticRows.map((row) => {
                const rowBusy =
                  actingKey === `${row.id}:setActive`
                    ? ("setActive" as const)
                    : actingKey === `${row.id}:remove`
                      ? ("remove" as const)
                      : null;
                return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.fullName}</TableCell>
                  <TableCell className="text-sm">{row.email}</TableCell>
                  {editableAdvisory ? (
                    <AdvisoryCell
                      row={row}
                      value={advisoryValueFor(row)}
                      options={editableAdvisory}
                      saving={savingAdvisoryId === row.id}
                      disabled={savingAdvisoryId === row.id || rowBusy !== null}
                      onChange={onChangeAdvisory}
                    />
                  ) : (
                    <TableCell className="text-sm">
                      {row.assignment ? (
                        `${row.assignment.gradeName} · ${row.assignment.sectionName}`
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
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
                    />
                  ) : null}
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
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

export function TeachersActiveTable({
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
      </CardContent>
    </Card>
  );
}
