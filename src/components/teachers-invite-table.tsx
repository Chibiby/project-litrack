"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resendTeacherInvite, revokeTeacherInvite } from "@/lib/actions/school-head";
import { AlertTriangle, CheckCircle2, Copy } from "lucide-react";

export type TeacherListRow = {
  id: string;
  fullName: string;
  username: string;
  grades: string[];
  status: "active" | "pending_activation" | "revoked" | "inactive";
  inviteId: string | null;
  inviteStatus: "pending" | "expired" | "revoked" | "consumed" | null;
};

function statusBadge(row: TeacherListRow) {
  switch (row.status) {
    case "active":
      return <Badge variant="secondary">Active</Badge>;
    case "pending_activation":
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-800">
          {row.inviteStatus === "expired" ? "Expired invite" : "Pending activation"}
        </Badge>
      );
    case "revoked":
      return <Badge variant="destructive">Revoked</Badge>;
    default:
      return <Badge variant="outline">Inactive</Badge>;
  }
}

export function TeachersInviteTable({ rows }: { rows: TeacherListRow[] }) {
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const runResend = (inviteId: string) => {
    const fd = new FormData();
    fd.set("inviteId", inviteId);
    startTransition(async () => {
      const res = await resendTeacherInvite(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data) {
        setCredentials({ username: res.data.username, password: res.data.tempPassword });
        toast.success("New credentials generated");
      }
    });
  };

  const runRevoke = (inviteId: string) => {
    if (!window.confirm("Revoke this invite and deactivate the teacher until re-invited?")) return;
    const fd = new FormData();
    fd.set("inviteId", inviteId);
    startTransition(async () => {
      const res = await revokeTeacherInvite(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Invite revoked");
    });
  };

  return (
    <div className="space-y-4">
      {credentials ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center gap-2 font-semibold text-amber-950">
              <AlertTriangle className="h-5 w-5" />
              New credentials (shown once)
            </div>
            <div className="space-y-2 text-sm">
              <div className="rounded border bg-white p-2">
                <strong>Username:</strong> {credentials.username}
              </div>
              <div className="rounded border bg-white p-2">
                <strong>Temp password:</strong> {credentials.password}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `Username: ${credentials.username}\nTemp password: ${credentials.password}`
                );
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 text-sm font-medium">Teachers ({rows.length})</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Grades</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No teachers yet. Add one above.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell className="font-mono text-xs">{row.username}</TableCell>
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
                    <TableCell>{statusBadge(row)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      {row.inviteId &&
                      (row.status === "pending_activation" || row.inviteStatus === "expired") ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => runResend(row.inviteId!)}
                          >
                            Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={pending}
                            onClick={() => runRevoke(row.inviteId!)}
                          >
                            Revoke
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
