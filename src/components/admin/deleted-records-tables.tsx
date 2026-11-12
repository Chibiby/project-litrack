"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { DeletedLearnerRestoreButton } from "@/components/admin/deleted-learners-restore-button";
import { LearnerPurgeButton, TeacherRowActions } from "@/components/admin/archive-row-actions";
import { cn } from "@/lib/utils";
// Type-only: both modules are `server-only`; type imports are erased first.
import type { ArchivedTeacherRow } from "@/lib/admin/archive";
import type { DeletedLearnerRow } from "@/lib/learners/deleted-learners";

export function formatRecordDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  });
}

/** School name, struck through when the row's own school is itself deleted. */
function SchoolCell({ name, deleted }: { name: string | null; deleted: boolean }) {
  return (
    <span className={cn(deleted && "text-muted-foreground line-through")}>{name ?? "—"}</span>
  );
}

/** Deleted teacher accounts. Restore and Delete permanently are Developer Admin actions. */
export function DeletedTeachersTable({ rows }: { rows: ArchivedTeacherRow[] }) {
  return (
    <ResponsiveTable
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>School</TableHead>
              <TableHead>Deleted on</TableHead>
              <TableHead>Original email</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((teacher) => (
              <TableRow key={teacher.id}>
                <TableCell className="max-w-[13rem] font-medium">
                  <CellText>{teacher.listingName}</CellText>
                </TableCell>
                <TableCell className="max-w-[13rem] text-sm text-muted-foreground">
                  <CellText>
                    <SchoolCell name={teacher.schoolName} deleted={teacher.schoolDeleted} />
                  </CellText>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                  {formatRecordDate(teacher.deletedAt)}
                </TableCell>
                <TableCell className="max-w-[14rem] text-sm text-muted-foreground">
                  {teacher.originalEmail ? <CellText>{teacher.originalEmail}</CellText> : "Not recoverable"}
                </TableCell>
                <TableCell>
                  <RowActions>
                    <TeacherRowActions teacher={teacher} />
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      stacked={
        <StackedList aria-label="Deleted teachers">
          {rows.map((teacher) => (
            <StackedRow
              key={teacher.id}
              className="px-0"
              title={teacher.listingName}
              value={
                <span className="text-xs font-normal text-muted-foreground">
                  {formatRecordDate(teacher.deletedAt)}
                </span>
              }
              meta={<SchoolCell name={teacher.schoolName} deleted={teacher.schoolDeleted} />}
              details={[{ label: "Original email", value: teacher.originalEmail ?? "Not recoverable" }]}
              detailActions={<TeacherRowActions teacher={teacher} labelled />}
            />
          ))}
        </StackedList>
      }
    />
  );
}

function placement(row: DeletedLearnerRow): string {
  return row.sectionName ? `${row.gradeLabel} · ${row.sectionName}` : row.gradeLabel;
}

/**
 * Deleted learners. Restore for every admin in scope; Delete permanently only
 * when `canPurge` and the row is already soft-deleted (an expired removal the
 * nightly job has not reached yet cannot be purged).
 */
export function DeletedLearnersTable({
  rows,
  showDistrict,
  canPurge = false,
  onGone,
}: {
  rows: DeletedLearnerRow[];
  showDistrict: boolean;
  canPurge?: boolean;
  /** Called after a confirmed restore or delete, to hide the row at once. */
  onGone: (id: string) => void;
}) {
  const actions = (row: DeletedLearnerRow, labelled: boolean) => (
    <div className={labelled ? "flex flex-wrap gap-2" : "flex justify-end gap-2"}>
      <DeletedLearnerRestoreButton
        id={row.id}
        name={row.name}
        schoolName={row.schoolName}
        onRestored={onGone}
        labelled={labelled}
      />
      {canPurge && row.purgeCounts ? (
        <LearnerPurgeButton
          id={row.id}
          fullName={row.name}
          purgeCounts={row.purgeCounts}
          labelled={labelled}
          onPurged={onGone}
        />
      ) : null}
    </div>
  );

  return (
    <ResponsiveTable
      // Wide roster: below ~900px of its own width the table would squeeze names.
      breakpoint={900}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>{showDistrict ? "School / District" : "School"}</TableHead>
              <TableHead>Grade / Section</TableHead>
              <TableHead>Removed on</TableHead>
              <TableHead>Deleted on</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-[12rem] font-medium">
                  <CellText>{row.name}</CellText>
                  {row.removalReason ? (
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {row.removalReason}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[12rem] text-muted-foreground">
                  <CellText>{row.schoolName}</CellText>
                  {showDistrict && row.district ? (
                    <span className="block truncate text-xs">{row.district}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{placement(row)}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatRecordDate(row.removedAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatRecordDate(row.deletedAt)}
                </TableCell>
                <TableCell>
                  <RowActions>{actions(row, false)}</RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      stacked={
        <StackedList aria-label="Deleted learners">
          {rows.map((row) => (
            <StackedRow
              key={row.id}
              className="px-0"
              title={row.name}
              value={<span className="text-sm font-medium">{placement(row)}</span>}
              meta={
                <span className="truncate">
                  {showDistrict && row.district ? `${row.schoolName} · ${row.district}` : row.schoolName}
                </span>
              }
              details={[
                ...(row.removalReason ? [{ label: "Reason", value: row.removalReason }] : []),
                { label: "Removed on", value: formatRecordDate(row.removedAt) },
                { label: "Deleted on", value: formatRecordDate(row.deletedAt) },
              ]}
              detailActions={actions(row, true)}
            />
          ))}
        </StackedList>
      }
    />
  );
}
