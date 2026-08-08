"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { approveTeacher, rejectTeacher } from "@/lib/actions/school-head";
import { formatDate } from "@/lib/utils";

export type PendingTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  requestedAt: string;
};

export type SectionOption = {
  id: string;
  name: string;
  gradeLevelId: string;
  gradeLabel: string;
};

export function SectionCheckboxGroup({
  sections,
  selected,
  onToggle,
  disabled,
  idPrefix,
  emptyLabel = "Create sections under Grade Levels before approving teachers.",
  className = "max-h-40 space-y-2 overflow-y-auto rounded-md border p-2",
}: {
  sections: SectionOption[];
  selected: string[];
  onToggle: (sectionId: string, checked: boolean) => void;
  disabled?: boolean;
  idPrefix: string;
  emptyLabel?: string;
  className?: string;
}) {
  const byGrade = useMemo(() => {
    const map = new Map<string, { label: string; items: SectionOption[] }>();
    for (const s of sections) {
      const entry = map.get(s.gradeLevelId) ?? { label: s.gradeLabel, items: [] };
      entry.items.push(s);
      map.set(s.gradeLevelId, entry);
    }
    return [...map.values()];
  }, [sections]);

  if (sections.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className={className}>
      {byGrade.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
          {group.items.map((s) => {
            const checked = selected.includes(s.id);
            const inputId = `${idPrefix}-${s.id}`;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(v) => onToggle(s.id, v === true)}
                />
                <Label htmlFor={inputId} className="text-sm font-normal">
                  {s.name}
                </Label>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function TeachersPendingTable({
  rows,
  sections,
  readOnly = false,
}: {
  rows: PendingTeacherRow[];
  sections: SectionOption[];
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [sectionsByUser, setSectionsByUser] = useState<Record<string, string[]>>({});

  const toggleSection = (userId: string, sectionId: string, checked: boolean) => {
    setSectionsByUser((prev) => {
      const current = prev[userId] ?? [];
      const next = checked
        ? [...new Set([...current, sectionId])]
        : current.filter((id) => id !== sectionId);
      return { ...prev, [userId]: next };
    });
  };

  const runApprove = (userId: string) => {
    const sectionIds = sectionsByUser[userId] ?? [];
    if (sectionIds.length === 0) {
      toast.error("Choose at least one section first");
      return;
    }
    const fd = new FormData();
    fd.set("userId", userId);
    for (const id of sectionIds) {
      fd.append("sectionIds", id);
    }
    startTransition(async () => {
      const res = await approveTeacher(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Teacher approved");
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
              {!readOnly ? <TableHead>Sections</TableHead> : null}
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
                const selected = sectionsByUser[row.id] ?? [];
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell className="text-sm">{row.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.requestedAt)}
                    </TableCell>
                    {!readOnly ? (
                      <TableCell className="min-w-[14rem]">
                        <SectionCheckboxGroup
                          sections={sections}
                          selected={selected}
                          disabled={pending}
                          idPrefix={`pending-${row.id}`}
                          onToggle={(sectionId, checked) =>
                            toggleSection(row.id, sectionId, checked)
                          }
                        />
                      </TableCell>
                    ) : null}
                    {!readOnly ? (
                      <TableCell className="space-x-1 text-right align-top">
                        <Button
                          size="sm"
                          disabled={pending || selected.length === 0 || sections.length === 0}
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
                          onConfirm={async () => {
                            const fd = new FormData();
                            fd.set("userId", row.id);
                            const res = await rejectTeacher(fd);
                            if (!res.ok) {
                              toast.error(res.error);
                              throw new Error(res.error);
                            }
                            toast.success("Registration declined");
                          }}
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
