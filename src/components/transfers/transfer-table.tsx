"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { CellText, NoValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SCHOOL_TRANSFER_STATUS_LABELS } from "@/lib/constants/enum-labels";
import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";
import type { TransferCandidate, TransferRow } from "@/lib/transfers/queries";
import { cn } from "@/lib/utils";

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: SCHOOL_TIME_ZONE });
}

/** One row of either list: who, what, and the facts beside them. */
type Item = {
  id: string;
  name: string;
  detail: string;
  /** Status cell: a badge, or nothing. */
  state: ReactNode;
  /** Extra columns, by header. */
  facts: { label: string; value: string | null }[];
  /** Ticking it is refused (a waiting transfer, an answered row). */
  locked: boolean;
};

function SelectionTable({
  items,
  selectable,
  selected,
  onToggle,
  onToggleAll,
  label,
  factHeaders,
}: {
  items: Item[];
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  label: string;
  factHeaders: string[];
}) {
  const open = items.filter((i) => !i.locked);
  const pickedCount = open.filter((i) => selected.has(i.id)).length;
  const all = open.length > 0 && pickedCount === open.length;
  const headerChecked = all ? true : pickedCount > 0 ? "indeterminate" : false;

  const box = (item: Item, where: string) =>
    selectable ? (
      <Checkbox
        checked={selected.has(item.id)}
        disabled={item.locked}
        onCheckedChange={(v) => onToggle(item.id, v === true)}
        aria-label={`Select ${item.name}${where}`}
        className="size-5 lg:size-4"
      />
    ) : null;

  return (
    <ResponsiveTable
      breakpoint={900}
      table={
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              {selectable ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={headerChecked}
                    disabled={open.length === 0}
                    onCheckedChange={(v) => onToggleAll(v === true)}
                    aria-label={`Select all ${label.toLowerCase()}`}
                  />
                </TableHead>
              ) : null}
              <TableHead>Name</TableHead>
              <TableHead>Details</TableHead>
              {factHeaders.map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                {selectable ? <TableCell>{box(item, "")}</TableCell> : null}
                <TableCell className="max-w-[16rem] font-medium">
                  <CellText title={item.name}>{item.name}</CellText>
                </TableCell>
                <TableCell className="max-w-[18rem] text-muted-foreground">
                  {item.detail ? <CellText title={item.detail}>{item.detail}</CellText> : <NoValue />}
                </TableCell>
                {item.facts.map((f) => (
                  <TableCell key={f.label} className="max-w-[16rem]">
                    {f.value ? <CellText title={f.value}>{f.value}</CellText> : <NoValue />}
                  </TableCell>
                ))}
                <TableCell>{item.state ?? <NoValue />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      stacked={
        <div className="space-y-2">
          {selectable && open.length > 0 ? (
            <label className="flex min-h-11 items-center gap-3 px-1 text-sm text-muted-foreground">
              <Checkbox
                checked={headerChecked}
                onCheckedChange={(v) => onToggleAll(v === true)}
                aria-label={`Select all ${label.toLowerCase()} (list)`}
                className="size-5"
              />
              Select all
            </label>
          ) : null}
          <StackedList aria-label={label}>
            {items.map((item) => (
              <StackedRow
                key={item.id}
                leading={box(item, " (list)")}
                title={item.name}
                titleText={item.name}
                state={item.state}
                meta={item.detail || undefined}
                details={item.facts.map((f) => ({ label: f.label, value: f.value ?? "—" }))}
              />
            ))}
          </StackedList>
        </div>
      }
    />
  );
}

/** Send tab: people of this school who could be sent. */
export function CandidateTable({
  candidates,
  selected,
  onToggle,
  onToggleAll,
  label,
}: {
  candidates: TransferCandidate[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  label: string;
}) {
  const items: Item[] = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    detail: c.detail,
    locked: c.pendingTo !== null,
    state: c.pendingTo ? (
      <Badge variant="outline" className="whitespace-nowrap border-warning-300 text-warning-800 dark:text-warning-300">
        Pending → {c.pendingTo}
      </Badge>
    ) : null,
    facts: [],
  }));
  return (
    <SelectionTable
      items={items}
      selectable
      selected={selected}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
      label={label}
      factHeaders={[]}
    />
  );
}

const STATUS_TONE: Record<TransferRow["status"], string> = {
  PENDING: "border-warning-300 text-warning-800 dark:text-warning-300",
  ACCEPTED: "border-success-300 text-success-800 dark:text-success-300",
  DECLINED: "border-destructive/40 text-destructive",
  CANCELLED: "text-muted-foreground",
  EXPIRED: "text-muted-foreground",
};

/** Outgoing, Incoming and History tabs. */
export function TransferRowTable({
  rows,
  view,
  selected,
  onToggle,
  onToggleAll,
  label,
}: {
  rows: TransferRow[];
  view: "outgoing" | "incoming" | "history";
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  label: string;
}) {
  const history = view === "history";
  const items: Item[] = rows.map((r) => {
    const school = history ? `${r.direction === "outgoing" ? "To" : "From"} ${r.otherSchoolName}` : r.otherSchoolName;
    const note = r.decisionNote ?? r.reason;
    return {
      id: r.id,
      name: r.personName,
      detail: r.detail,
      locked: r.status !== "PENDING",
      state: (
        <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_TONE[r.status])}>
          {history ? SCHOOL_TRANSFER_STATUS_LABELS[r.status] : `Expires ${shortDate(r.expiresAt)}`}
        </Badge>
      ),
      facts: [
        { label: view === "incoming" ? "From" : view === "outgoing" ? "To" : "School", value: school },
        { label: "Sent", value: `${shortDate(r.createdAt)}${r.requestedByName ? ` by ${r.requestedByName}` : ""}` },
        { label: "Note", value: note },
      ],
    };
  });
  return (
    <SelectionTable
      items={items}
      selectable={!history}
      selected={selected}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
      label={label}
      factHeaders={[view === "incoming" ? "From" : view === "outgoing" ? "To" : "School", "Sent", "Note"]}
    />
  );
}
