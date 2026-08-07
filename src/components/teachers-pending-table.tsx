"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { approveTeacher, rejectTeacher } from "@/lib/actions/school-head";
import { formatDate } from "@/lib/utils";

export type PendingTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  requestedAt: string;
};

export type GradeOption = { id: string; label: string };

export function TeachersPendingTable({
  rows,
  grades,
  readOnly = false,
}: {
  rows: PendingTeacherRow[];
  grades: GradeOption[];
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [gradeByUser, setGradeByUser] = useState<Record<string, string>>({});

  const runApprove = (userId: string) => {
    const gradeLevelId = gradeByUser[userId];
    if (!gradeLevelId) {
      toast.error("Choose a grade level first");
      return;
    }
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("gradeLevelId", gradeLevelId);
    startTransition(async () => {
      const res = await approveTeacher(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Teacher approved");
    });
  };

  const runReject = (userId: string, name: string) => {
    if (!window.confirm(`Reject registration for ${name}? They will not be able to sign in.`)) {
      return;
    }
    const fd = new FormData();
    fd.set("userId", userId);
    startTransition(async () => {
      const res = await rejectTeacher(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Registration declined");
    });
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Pending requests ({rows.length})
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Requested</TableHead>
              {!readOnly ? <TableHead>Grade</TableHead> : null}
              {!readOnly ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={readOnly ? 3 : 5}
                  className="py-6 text-center text-muted-foreground"
                >
                  No pending registration requests.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const selectedGrade = gradeByUser[row.id] ?? "";
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell className="text-sm">{row.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.requestedAt)}
                    </TableCell>
                    {!readOnly ? (
                      <TableCell className="min-w-[10rem]">
                        <Select
                          value={selectedGrade || undefined}
                          onValueChange={(value) =>
                            setGradeByUser((prev) => ({ ...prev, [row.id]: value }))
                          }
                          disabled={pending}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose grade" />
                          </SelectTrigger>
                          <SelectContent>
                            {grades.map((g) => (
                              <SelectItem key={g.id} value={g.id}>
                                {g.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    ) : null}
                    {!readOnly ? (
                      <TableCell className="space-x-1 text-right">
                        <Button
                          size="sm"
                          disabled={pending || !selectedGrade}
                          onClick={() => runApprove(row.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={pending}
                          onClick={() => runReject(row.id, row.fullName)}
                        >
                          Reject
                        </Button>
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
