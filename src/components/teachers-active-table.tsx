"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { clearRejectedTeacher } from "@/lib/actions/school-head";
import { formatDate } from "@/lib/utils";

export type ActiveTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  grades: string[];
  profileCompleted: boolean;
  approvedAt: string | null;
};

export type DeclinedTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  rejectedAt: string | null;
};

export function TeachersActiveTable({ rows }: { rows: ActiveTeacherRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Active teachers ({rows.length})
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Assigned grades</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Approved</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No active teachers yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.fullName}</TableCell>
                  <TableCell className="text-sm">{row.email}</TableCell>
                  <TableCell>
                    {row.grades.length === 0 ? (
                      <Badge variant="outline">Unassigned</Badge>
                    ) : (
                      row.grades.map((g) => (
                        <Badge key={g} variant="secondary" className="mr-1">
                          {g}
                        </Badge>
                      ))
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
