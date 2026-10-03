"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { isActionFailure } from "@/lib/errors/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmAction } from "@/components/confirm-action";
import { toast } from "sonner";
import { approveTeacher, rejectTeacher } from "@/lib/actions/school-head";
import type { ActionFailure } from "@/lib/errors/result";
import { callAction } from "@/lib/ui/call-action";
import { formatDate } from "@/lib/utils";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

export type PendingTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  requestedAt: string;
};

export function TeachersPendingTable({
  rows,
  readOnly = false,
}: {
  rows: PendingTeacherRow[];
  readOnly?: boolean;
}) {
  const [, startTransition] = useTransition();
  /**
   * `rowId:action` for the request in flight. One shared `pending` flag would
   * disable every other teacher's buttons and spin Approve and Decline together
   * — the reviewer could not tell which decision was being sent.
   */
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [optimisticRows, dispatchOptimistic] = useOptimistic(
    rows,
    (state: PendingTeacherRow[], op: ListOptimisticOp<PendingTeacherRow>) =>
      listOptimisticReducer(state, op)
  );

  /** Rows the server has confirmed as approved; hidden until the refreshed list arrives. */
  const [approvedIds, setApprovedIds] = useState<ReadonlySet<string>>(new Set());
  const visibleRows = optimisticRows.filter((r) => !approvedIds.has(r.id));

  const [announcement, setAnnouncement] = useState("");
  /** Where focus goes once the approved row is gone: a row's Approve button, or the heading when `rowId` is null. */
  const [focusRequest, setFocusRequest] = useState<{ rowId: string | null } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.rowId !== null) {
      const candidates = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-approve-for]"
        ) ?? []
      ).filter((b) => b.dataset.approveFor === focusRequest.rowId);
      // The table and the stacked list both render; only one is displayed.
      const target = candidates.find((b) => b.offsetParent !== null) ?? candidates[0];
      if (target) {
        target.focus();
        setFocusRequest(null);
        return;
      }
    }
    headingRef.current?.focus();
    setFocusRequest(null);
  }, [focusRequest]);

  // Not optimistic: the row stays until the server confirms. A failure is
  // returned so ConfirmAction toasts it and keeps the dialog open for a retry.
  // Grade/section assignment happens when the teacher completes their own
  // profile, so approval takes no section.
  const runApprove = async (userId: string): Promise<void | ActionFailure> => {
    const fd = new FormData();
    fd.set("userId", userId);
    setActingKey(`${userId}:approve`);
    try {
      const res = await callAction(() => approveTeacher(fd));
      if (isActionFailure(res)) return res;
      if (!res.ok) return;
      toast.success("Teacher approved");
      const index = visibleRows.findIndex((r) => r.id === userId);
      const neighbour = visibleRows[index + 1] ?? visibleRows[index - 1];
      const approvedName = visibleRows[index]?.fullName ?? "Teacher";
      setAnnouncement(`${approvedName} approved`);
      setFocusRequest({ rowId: neighbour?.id ?? null });
      setApprovedIds((prev) => new Set(prev).add(userId));
    } finally {
      setActingKey(null);
    }
  };

  const approveControl = (row: PendingTeacherRow, className?: string) => (
    <ConfirmAction
      title="Approve this teacher?"
      description={`${row.fullName} (${row.email}) will be able to sign in and see this school's learners.`}
      confirmLabel="Approve teacher"
      variant="default"
      disabled={actingKey?.startsWith(`${row.id}:`) ?? false}
      trigger={
        <Button
          size="sm"
          className={className}
          data-approve-for={row.id}
          loading={actingKey === `${row.id}:approve`}
          loadingText="Approving…"
          disabled={actingKey?.startsWith(`${row.id}:`) ?? false}
        >
          Approve
        </Button>
      }
      onConfirm={() => runApprove(row.id)}
    />
  );

  const runReject = (userId: string) => {
    setActingKey(`${userId}:reject`);
    return runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "remove", id: userId });
      const fd = new FormData();
      fd.set("userId", userId);
      const res = await rejectTeacher(fd);
      await settleActionResult(res, "Registration declined");
    }).finally(() => setActingKey(null));
  };

  return (
    <Card ref={rootRef}>
      <CardContent className="p-0">
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="border-b px-4 py-3 text-sm font-medium focus:outline-none"
        >
          Pending requests ({visibleRows.length})
        </h2>
        <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Requested</TableHead>
              {!readOnly ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={readOnly ? 3 : 4}
                  className="py-6 text-center text-muted-foreground"
                >
                  No pending registration requests.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row) => {
                const rowBusy = actingKey?.startsWith(`${row.id}:`) ?? false;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell className="text-sm">{row.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.requestedAt)}
                    </TableCell>
                    {!readOnly ? (
                      <TableCell className="space-x-1 text-right align-top">
                        {approveControl(row)}
                        <ConfirmAction
                          title="Decline registration?"
                          description={`${row.fullName} will not be able to sign in. You can allow them to register again later from the Declined tab.`}
                          confirmLabel="Decline"
                          variant="destructive"
                          disabled={rowBusy}
                          trigger={
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              loading={actingKey === `${row.id}:reject`}
                              loadingText="Declining…"
                              disabled={rowBusy}
                            >
                              Decline
                            </Button>
                          }
                          onConfirm={() => runReject(row.id)}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>

        {/* Below lg: one stacked row per pending request. */}
        <ul className="divide-y divide-border/60 lg:hidden" aria-label="Pending requests">
          {visibleRows.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No pending registration requests.
            </li>
          ) : (
            visibleRows.map((row) => {
              const rowBusy = actingKey?.startsWith(`${row.id}:`) ?? false;
              return (
                <li key={row.id} className="flex flex-col gap-2 px-3 py-3 sm:px-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{row.fullName}</p>
                    <p className="truncate text-sm text-muted-foreground">{row.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Requested {formatDate(row.requestedAt)}
                    </p>
                  </div>
                  {!readOnly ? (
                    <div className="flex flex-wrap gap-2">
                      {approveControl(row, "lg:h-9")}
                      <ConfirmAction
                        title="Decline registration?"
                        description={`${row.fullName} will not be able to sign in. You can allow them to register again later from the Declined tab.`}
                        confirmLabel="Decline"
                        variant="destructive"
                        disabled={rowBusy}
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="lg:h-9 text-destructive"
                            loading={actingKey === `${row.id}:reject`}
                            loadingText="Declining…"
                            disabled={rowBusy}
                          >
                            Decline
                          </Button>
                        }
                        onConfirm={() => runReject(row.id)}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
