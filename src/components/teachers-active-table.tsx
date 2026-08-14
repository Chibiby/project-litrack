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
   * Read-only mirror of the teacher's advisory section (grade derived from it).
   * Teachers set this themselves in profiling — the School Head cannot edit it
   * here; this column exists only so the roster is legible.
   */
  assignment: { gradeName: string; sectionName: string } | null;
};

export type DeclinedTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  rejectedAt: string | null;
};

function TeacherManageActions({
  row,
  mode,
  pending,
  onSetActive,
  onRemove,
}: {
  row: ActiveTeacherRow;
  mode: "active" | "inactive";
  pending: boolean;
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

  return (
    <TableCell className="space-x-1 text-right">
      {mode === "active" ? (
        <ConfirmAction
          title="Deactivate teacher?"
          description={`${row.fullName} will not be able to sign in until reactivated. Learners stay assigned.`}
          confirmLabel="Deactivate"
          variant="destructive"
          disabled={pending}
          trigger={
            <Button size="sm" variant="outline" disabled={pending}>
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
          disabled={pending}
          trigger={
            <Button size="sm" variant="outline" disabled={pending}>
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
        disabled={blockedReason !== null || pending}
        trigger={
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={blockedReason !== null || pending}
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
}: {
  title: string;
  emptyLabel: string;
  rows: ActiveTeacherRow[];
  mode: "active" | "inactive";
  readOnly?: boolean;
  list?: TeachersListPagination;
}) {
  const router = useRouter();
  const [rowPending, startRowTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(list?.q ?? "");
  const [optimisticRows, dispatchOptimistic] = useOptimistic(
    rows,
    (state: ActiveTeacherRow[], op: ListOptimisticOp<ActiveTeacherRow>) =>
      listOptimisticReducer(state, op)
  );

  useEffect(() => {
    setSearchValue(list?.q ?? "");
  }, [list?.q]);

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

  const onSetActive = (row: ActiveTeacherRow, isActive: boolean) =>
    runOptimistic(startRowTransition, async () => {
      dispatchOptimistic({ type: "remove", id: row.id });
      const fd = new FormData();
      fd.set("userId", row.id);
      fd.set("isActive", isActive ? "true" : "false");
      const res = await setTeacherActive(fd);
      await settleActionResult(
        res,
        isActive ? "Teacher reactivated" : "Teacher deactivated"
      );
    });

  const onRemove = (row: ActiveTeacherRow) =>
    runOptimistic(startRowTransition, async () => {
      dispatchOptimistic({ type: "remove", id: row.id });
      const fd = new FormData();
      fd.set("userId", row.id);
      const res = await removeTeacher(fd);
      await settleActionResult(res, "Teacher removed");
    });

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
              optimisticRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.fullName}</TableCell>
                  <TableCell className="text-sm">{row.email}</TableCell>
                  <TableCell className="text-sm">
                    {row.assignment ? (
                      `${row.assignment.gradeName} — ${row.assignment.sectionName}`
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.aralLearnerCount > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-violet-200 text-violet-800"
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
                      <Badge variant="outline" className="border-amber-300 text-amber-800">
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
                      pending={rowPending}
                      onSetActive={onSetActive}
                      onRemove={onRemove}
                    />
                  ) : null}
                </TableRow>
              ))
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
}: {
  rows: ActiveTeacherRow[];
  readOnly?: boolean;
  list?: TeachersListPagination;
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
  const [pending, startTransition] = useTransition();

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
    startTransition(async () => {
      const res = await clearRejectedTeacher(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("They can register again");
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
                      disabled={pending}
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
