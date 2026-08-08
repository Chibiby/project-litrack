"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmAction } from "@/components/confirm-action";
import {
  assignTeachersToSections,
  clearRejectedTeacher,
  removeTeacher,
  setTeacherActive,
  setTeacherSectionAssignments,
} from "@/lib/actions/school-head";
import {
  SectionCheckboxGroup,
  type SectionOption,
} from "@/components/teachers-pending-table";
import { formatDate } from "@/lib/utils";

export type ActiveTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  grades: string[];
  sections: string[];
  sectionIds: string[];
  profileCompleted: boolean;
  approvedAt: string | null;
  learnerCount: number;
};

export type DeclinedTeacherRow = {
  id: string;
  fullName: string;
  email: string;
  rejectedAt: string | null;
};

function ManageSectionsButton({
  row,
  sections,
}: {
  row: ActiveTeacherRow;
  sections: SectionOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(row.sectionIds);

  const byGrade = useMemo(() => {
    const map = new Map<string, { label: string; items: SectionOption[] }>();
    for (const s of sections) {
      const entry = map.get(s.gradeLevelId) ?? { label: s.gradeLabel, items: [] };
      entry.items.push(s);
      map.set(s.gradeLevelId, entry);
    }
    return [...map.values()];
  }, [sections]);

  const onOpenChange = (next: boolean) => {
    if (next) setSelected(row.sectionIds);
    setOpen(next);
  };

  const save = () => {
    if (selected.length === 0) {
      toast.error("Select at least one section");
      return;
    }
    const fd = new FormData();
    fd.set("userId", row.id);
    for (const id of selected) fd.append("sectionIds", id);
    startTransition(async () => {
      const res = await setTeacherSectionAssignments(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sections updated");
      setOpen(false);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          Sections
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Sections for {row.fullName}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sections yet. Create them under Grade Levels first.
            </p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {byGrade.map((group) => (
                <div key={group.label} className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                  {group.items.map((s) => {
                    const checked = selected.includes(s.id);
                    const inputId = `manage-${row.id}-${s.id}`;
                    return (
                      <div key={s.id} className="flex items-center gap-2">
                        <Checkbox
                          id={inputId}
                          checked={checked}
                          disabled={pending}
                          onCheckedChange={(v) => {
                            setSelected((prev) =>
                              v === true
                                ? [...new Set([...prev, s.id])]
                                : prev.filter((id) => id !== s.id)
                            );
                          }}
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
          )}
          <Button
            onClick={save}
            disabled={pending || selected.length === 0 || sections.length === 0}
          >
            {pending ? "Saving…" : "Save assignments"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TeacherManageActions({
  row,
  mode,
  sections,
}: {
  row: ActiveTeacherRow;
  mode: "active" | "inactive";
  sections: SectionOption[];
}) {
  return (
    <TableCell className="space-x-1 text-right">
      <ManageSectionsButton row={row} sections={sections} />
      {mode === "active" ? (
        <ConfirmAction
          title="Deactivate teacher?"
          description={`${row.fullName} will not be able to sign in until reactivated. Learners stay assigned.`}
          confirmLabel="Deactivate"
          variant="destructive"
          trigger={
            <Button size="sm" variant="outline">
              Deactivate
            </Button>
          }
          onConfirm={async () => {
            const fd = new FormData();
            fd.set("userId", row.id);
            fd.set("isActive", "false");
            const res = await setTeacherActive(fd);
            if (!res.ok) {
              toast.error(res.error);
              throw new Error(res.error);
            }
            toast.success("Teacher deactivated");
          }}
        />
      ) : (
        <ConfirmAction
          title="Reactivate teacher?"
          description={`${row.fullName} will be able to sign in again.`}
          confirmLabel="Reactivate"
          variant="default"
          trigger={
            <Button size="sm" variant="outline">
              Reactivate
            </Button>
          }
          onConfirm={async () => {
            const fd = new FormData();
            fd.set("userId", row.id);
            fd.set("isActive", "true");
            const res = await setTeacherActive(fd);
            if (!res.ok) {
              toast.error(res.error);
              throw new Error(res.error);
            }
            toast.success("Teacher reactivated");
          }}
        />
      )}
      <ConfirmAction
        title="Remove teacher?"
        description={
          row.learnerCount > 0
            ? `${row.fullName} still has ${row.learnerCount} learner(s). Reassign or transfer them first, then try again.`
            : `${row.fullName} will be removed and their login deleted so the email can be used to register again. Historical records are kept.`
        }
        confirmLabel="Remove"
        variant="destructive"
        disabled={row.learnerCount > 0}
        trigger={
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={row.learnerCount > 0}
            title={
              row.learnerCount > 0
                ? "Reassign learners before removing"
                : "Remove teacher"
            }
          >
            Remove
          </Button>
        }
        onConfirm={async () => {
          const fd = new FormData();
          fd.set("userId", row.id);
          const res = await removeTeacher(fd);
          if (!res.ok) {
            toast.error(res.error);
            throw new Error(res.error);
          }
          toast.success("Teacher removed");
        }}
      />
    </TableCell>
  );
}

function TeachersManagedTable({
  title,
  emptyLabel,
  rows,
  mode,
  sections,
  readOnly = false,
}: {
  title: string;
  emptyLabel: string;
  rows: ActiveTeacherRow[];
  mode: "active" | "inactive";
  sections: SectionOption[];
  readOnly?: boolean;
}) {
  const bulkEnabled = mode === "active" && !readOnly;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSections, setBulkSections] = useState<string[]>([]);
  const [bulkPending, startBulkTransition] = useTransition();

  const selectedVisible = selectedIds.filter((id) => rows.some((r) => r.id === id));
  const allVisibleSelected =
    rows.length > 0 && rows.every((r) => selectedVisible.includes(r.id));
  const someVisibleSelected =
    rows.some((r) => selectedVisible.includes(r.id)) && !allVisibleSelected;

  const colSpan = (readOnly ? 5 : 6) + (bulkEnabled ? 1 : 0);

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)
    );
  };

  const toggleAllVisible = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...new Set([...prev, ...rows.map((r) => r.id)])]);
    } else {
      const visible = new Set(rows.map((r) => r.id));
      setSelectedIds((prev) => prev.filter((id) => !visible.has(id)));
    }
  };

  const onBulkOpenChange = (next: boolean) => {
    if (next) setBulkSections([]);
    setBulkOpen(next);
  };

  const saveBulk = () => {
    if (selectedVisible.length === 0) {
      toast.error("Select at least one teacher");
      return;
    }
    if (bulkSections.length === 0) {
      toast.error("Select at least one section");
      return;
    }
    const fd = new FormData();
    for (const id of selectedVisible) fd.append("userIds", id);
    for (const id of bulkSections) fd.append("sectionIds", id);
    startBulkTransition(async () => {
      const res = await assignTeachersToSections(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Assigned ${bulkSections.length} section(s) to ${selectedVisible.length} teacher(s)`
      );
      setSelectedIds([]);
      setBulkSections([]);
      setBulkOpen(false);
    });
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-sm font-medium">
            {title} ({rows.length})
          </div>
          {bulkEnabled && selectedVisible.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {selectedVisible.length} teacher
                {selectedVisible.length === 1 ? "" : "s"} selected
              </span>
              <Button size="sm" variant="outline" onClick={() => onBulkOpenChange(true)}>
                Assign sections…
              </Button>
            </div>
          ) : null}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {bulkEnabled ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all visible teachers"
                    checked={
                      allVisibleSelected
                        ? true
                        : someVisibleSelected
                          ? "indeterminate"
                          : false
                    }
                    disabled={rows.length === 0}
                    onCheckedChange={(v) => toggleAllVisible(v === true)}
                  />
                </TableHead>
              ) : null}
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Assigned sections</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Approved</TableHead>
              {!readOnly ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const checked = selectedVisible.includes(row.id);
                return (
                  <TableRow key={row.id} data-state={checked ? "selected" : undefined}>
                    {bulkEnabled ? (
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${row.fullName}`}
                          checked={checked}
                          onCheckedChange={(v) => toggleRow(row.id, v === true)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell className="text-sm">{row.email}</TableCell>
                    <TableCell>
                      {row.sections.length === 0 ? (
                        <Badge variant="outline">Unassigned</Badge>
                      ) : (
                        row.sections.map((label) => (
                          <Badge key={label} variant="secondary" className="mr-1 mb-1">
                            {label}
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
                    {!readOnly ? (
                      <TeacherManageActions row={row} mode={mode} sections={sections} />
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {bulkEnabled ? (
          <Sheet open={bulkOpen} onOpenChange={onBulkOpenChange}>
            <SheetContent className="sm:max-w-md">
              <SheetHeader>
                <SheetTitle>
                  Assign sections to {selectedVisible.length} teacher
                  {selectedVisible.length === 1 ? "" : "s"}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Selected sections are added to each teacher without removing their
                  existing assignments.
                </p>
                <SectionCheckboxGroup
                  sections={sections}
                  selected={bulkSections}
                  disabled={bulkPending}
                  idPrefix="bulk-assign"
                  emptyLabel="No sections yet. Create them under Grade Levels first."
                  className="max-h-[60vh] space-y-3 overflow-y-auto rounded-md border p-2"
                  onToggle={(sectionId, checked) => {
                    setBulkSections((prev) =>
                      checked
                        ? [...new Set([...prev, sectionId])]
                        : prev.filter((id) => id !== sectionId)
                    );
                  }}
                />
                <Button
                  onClick={saveBulk}
                  disabled={
                    bulkPending ||
                    bulkSections.length === 0 ||
                    selectedVisible.length === 0 ||
                    sections.length === 0
                  }
                >
                  {bulkPending ? "Assigning…" : "Assign sections"}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TeachersActiveTable({
  rows,
  sections,
  readOnly = false,
}: {
  rows: ActiveTeacherRow[];
  sections: SectionOption[];
  readOnly?: boolean;
}) {
  return (
    <TeachersManagedTable
      title="Active teachers"
      emptyLabel="No active teachers yet."
      rows={rows}
      mode="active"
      sections={sections}
      readOnly={readOnly}
    />
  );
}

export function TeachersInactiveTable({
  rows,
  sections,
  readOnly = false,
}: {
  rows: ActiveTeacherRow[];
  sections: SectionOption[];
  readOnly?: boolean;
}) {
  return (
    <TeachersManagedTable
      title="Inactive teachers"
      emptyLabel="No inactive teachers."
      rows={rows}
      mode="inactive"
      sections={sections}
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
