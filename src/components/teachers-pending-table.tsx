"use client";

import { useOptimistic, useTransition } from "react";
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
import { approveTeacher, rejectTeacher } from "@/lib/actions/school-head";
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
  const [pending, startTransition] = useTransition();
  const [optimisticRows, dispatchOptimistic] = useOptimistic(
    rows,
    (state: PendingTeacherRow[], op: ListOptimisticOp<PendingTeacherRow>) =>
      listOptimisticReducer(state, op)
  );

  const runApprove = (userId: string) => {
    const fd = new FormData();
    fd.set("userId", userId);
    // Grade/section assignment now happens when the teacher completes their own
    // profile, so approval no longer takes a section.
    void runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "remove", id: userId });
      const res = await approveTeacher(fd);
      await settleActionResult(res, "Teacher approved");
    }).catch(() => {
      /* toast already shown */
    });
  };

  const runReject = (userId: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "remove", id: userId });
      const fd = new FormData();
      fd.set("userId", userId);
      const res = await rejectTeacher(fd);
      await settleActionResult(res, "Registration declined");
    });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Pending requests ({optimisticRows.length})
        </div>
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
            {optimisticRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={readOnly ? 3 : 4}
                  className="py-6 text-center text-muted-foreground"
                >
                  No pending registration requests.
                </TableCell>
              </TableRow>
            ) : (
              optimisticRows.map((row) => {
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell className="text-sm">{row.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.requestedAt)}
                    </TableCell>
                    {!readOnly ? (
                      <TableCell className="space-x-1 text-right align-top">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => runApprove(row.id)}
                        >
                          Approve
                        </Button>
                        <ConfirmAction
                          title="Decline registration?"
                          description={`${row.fullName} will not be able to sign in.`}
                          confirmLabel="Decline"
                          variant="destructive"
                          disabled={pending}
                          trigger={
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={pending}
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
      </CardContent>
    </Card>
  );
}
